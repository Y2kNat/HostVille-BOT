const config = require('../config');
const { logInfo, logWarn, logError } = require('../utils/logger');
const { fetch: httpFetch } = require('../utils/httpDispatcher');

/**
 * Timeout do GET/HEAD /models. Precisa ser MAIOR que o connect timeout do
 * dispatcher (KILO_CONNECT_TIMEOUT_MS, 45s): MEDIDO neste aparelho, o TLS
 * do gateway leva 15-26s e uma chamada com abort de 15s morria antes do
 * handshake — o bot reportava "gateway fora do ar" com a IA funcionando.
 */
const MODELS_TIMEOUT_MS = 60000;

/**
 * TTL do cache da lista de modelos. O /models devolve ~540KB (401 modelos)
 * e leva 15-26s: baixar isso a cada ciclo do watchdog é desperdício de
 * banda e de bateria. 10 minutos basta — o catálogo muda raramente.
 */
const MODELS_TTL_MS = 10 * 60 * 1000;

/**
 * Cliente centralizado para o Kilo Code (AI Gateway).
 *
 * Única camada responsável pela comunicação com o gateway.
 * Todos os managers devem chamar `kilo.chat(...)` sem conhecer
 * URL, HTTP, headers, modelo, timeout ou detalhes do provider.
 *
 * O Gateway fala o protocolo OpenAI (POST /chat/completions) e autentica
 * com `Authorization: Bearer <KILO_API_KEY>`. Os modelos são identificados
 * no formato `provedor/nome-do-modelo`.
 *
 * DIFERENÇA IMPORTANTE PRO OLLAMA (o gateway NÃO é o Ollama):
 *   - `options` {top_k, repeat_penalty, num_ctx} é NATIVO do Ollama. O
 *     gateway (OpenRouter por baixo) rejeita propriedade desconhecida com
 *     400 "property 'options' is unsupported". NUNCA é enviado aqui.
 *   - `keep_alive` também é nativo do Ollama. Não é enviado.
 *   - `reasoning_effort` não está no contrato do gateway. Só é enviado
 *     quando o .env pede (KILO_REASONING=low|medium|high), e se o gateway
 *     recusar o campo a chamada é repetida sem ele (auto-cura).
 */
class KiloClient {

    constructor() {
        this.baseUrl = String(config.KILO_BASE_URL || 'https://ai-gateway.kilo.ai/api/v1').replace(/\/+$/, '');
        this.model = config.KILO_DEFAULT_MODEL || '';
        this.timeoutMs = config.KILO_TIMEOUT_MS || 300000;
        this.maxConcurrency = config.KILO_MAX_CONCURRENCY || 2;
        this.maxRetries = config.KILO_MAX_RETRIES || 1;
        // defaults de geração (podem ser sobrescritos por chamada)
        this.maxTokens = config.KILO_MAX_TOKENS || 1500;
        this.temperature = config.KILO_TEMPERATURE ?? 0.7;
        this.topP = config.KILO_TOP_P ?? 0.9;
        // Modelos de raciocínio (campo "reasoning" na resposta) gastam o
        // orçamento de max_tokens ANTES de responder. Medido: com 220 tokens
        // o modelo devolve content vazio. Daí o piso.
        this.minTokens = config.KILO_MIN_TOKENS || 1200;
        // Esforço de raciocínio enviado ao gateway: 'none' (sem raciocínio),
        // 'low', 'medium', 'high'. O valor vai como está — MEDIDO no gateway:
        // `reasoning_effort: 'none'` devolve reasoning_tokens=0 e a resposta
        // sai direto (o modelo para de queimar orçamento pensando).
        // Se um modelo recusar o campo (400), a chamada é repetida sem ele.
        this.reasoning = config.KILO_REASONING || 'none';
        // Autenticação: o gateway sempre exige a chave.
        this.apiKey = config.KILO_API_KEY || '';
        if (!this.apiKey) {
            console.warn('[KiloClient] KILO_API_KEY vazia — todas as chamadas ao gateway vão falhar com 401. Configure no .env.');
        }
        if (!this.model) {
            console.warn('[KiloClient] KILO_DEFAULT_MODEL vazia — configure no .env para o bot saber qual modelo usar.');
        }

        // Rotas alternativas (cadeia). Vazio = desligado.
        this.cadeia = this._montarCadeia();
        // Mantido por compatibilidade (o fallback único virou a 1a da cadeia).
        this.fallback = this.cadeia[0] || null;
        // Cache da lista de modelos (ver _listarModelos).
        this._cacheModelos = { ok: false, models: [], ts: 0 };
        this.active = 0;
        this.queue = [];
    }

    /**
     * Monta a cadeia de rotas alternativas, na ordem em que devem ser
     * tentadas. Só entram as que têm modelo configurado.
     *
     * Com um provedor só (o gateway), a alternativa é o MESMO endpoint com
     * OUTRO MODELO: cobre o caso do modelo principal cair (modelo removido
     * do catálogo, cota esgotada no provedor dele) sem trocar de gateway.
     *
     * @returns {Array<{nome:string, baseUrl:string, apiKey:string, model:string, timeoutMs:number, provider:string}>}
     */
    _montarCadeia() {
        const rotas = [];
        const add = (nome, baseUrl, apiKey, model, timeoutMs, provider) => {
            const b = String(baseUrl || '').replace(/\/+$/, '');
            const k = String(apiKey || '').trim();
            const m = String(model || '').trim();
            if (!k || !b || !m) return; // rota incompleta = desligada
            rotas.push({ nome, baseUrl: b, apiKey: k, model: m, timeoutMs: timeoutMs || 60000, provider });
        };
        add('kilo-alternativa', this.baseUrl, this.apiKey,
            config.KILO_FALLBACK_MODEL, config.KILO_FALLBACK_TIMEOUT_MS, 'kilo');
        return rotas;
    }

    /** A rota principal, normalizada no mesmo formato das alternativas. */
    _rotaPrincipal() {
        return {
            nome: 'principal',
            provider: 'kilo',
            baseUrl: this.baseUrl,
            apiKey: this.apiKey,
            model: this.model,
            timeoutMs: this.timeoutMs,
        };
    }

    /**
     * Fila simples de concorrência: impede que várias inferências
     * simultâneas estourem a cota do gateway.
     */
    _acquireSlot() {
        if (this.active < this.maxConcurrency) {
            this.active++;
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.queue.push(resolve);
        });
    }

    _releaseSlot() {
        const next = this.queue.shift();
        if (next) {
            next();
        } else {
            this.active--;
        }
    }

    /**
     * Headers da requisição.
     * O gateway exige `Authorization: Bearer <KILO_API_KEY>` sempre.
     */
    _headers(rota) {
        const r = rota || this._rotaPrincipal();
        const h = { 'Content-Type': 'application/json' };
        if (r.apiKey) h['Authorization'] = `Bearer ${r.apiKey}`;
        return h;
    }

    /**
     * Faz UMA chamada HTTP a uma rota e devolve o JSON bruto.
     * Lança em erro de transporte (fetch rejeita, abort, 5xx, 429) e em
     * 4xx (com .status). Não interpreta o corpo: quem chama decide.
     *
     * @param {{baseUrl:string,apiKey:string,model:string,timeoutMs:number}} rota
     * @param {object} body
     * @returns {Promise<object>} JSON da resposta
     */
    async _request(rota, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), rota.timeoutMs);
        try {
            const response = await httpFetch(`${rota.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: this._headers(rota),
                body: JSON.stringify(body),
                signal: controller.signal,
                // Connect timeout próprio: o do undici (10s) é menor que o
                // TLS de uma rota lenta e matava a chamada antes do
                // handshake. Vazio = sem undici no projeto = comportamento
                // antigo.
            });

            if (!response.ok) {
                const text = await response.text().catch(() => '');
                const erro = new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
                erro.status = response.status;
                throw erro;
            }
            return await response.json();
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Decide se vale tentar a rota de fallback.
     *
     * Só erro de TRANSPORTE ou de AUTENTICAÇÃO aciona:
     * sem conexão, 5xx, 429, timeout, e também 401/403.
     *
     * 401/403 entram de propósito: chave expirada, cota cortada ou política
     * de organização mudando no gateway. Tratar 401 como "não aciona" deixa o
     * bot sem IA mesmo com a rota alternativa configurada.
     *
     * Erro de CONTEÚDO (resposta vazia, finish_reason=load, prompt
     * degenerado) NÃO aciona: repetir no outro modelo devolve o mesmo
     * resultado e só gasta cota duas vezes.
     */
    _valeFallback(erro) {
        if (!this.cadeia || !this.cadeia.length) return false;
        if (!erro) return false;
        // abort/timeout/fetch rejeitado
        if (erro.name === 'AbortError') return true;
        if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|socket|network|getaddrinfo/i.test(erro.message || '')) return true;
        const st = erro.status;
        if (st && st >= 500) return true;
        if (st === 429 || st === 408) return true;
        // Chave expirada / sem saldo / modelo bloqueado: a rota alternativa
        // (outro modelo) é justamente o que resolve.
        if (st === 401 || st === 403) return true;
        return false;
    }

    /**
     * O gateway recusou o campo `reasoning_effort`?
     *
     * MEDIDO no gateway: os modelos discordam sobre o campo.
     *   - dots-studio/dots-3-note-preview:free → ACEITA 'none'
     *   - minimax/minimax-m3.1-flash:free      → EXIGE raciocínio: 400
     *     "Reasoning is mandatory for this endpoint and cannot be disabled."
     *
     * Nos dois casos a saída é a mesma: repetir sem o campo e deixar o
     * modelo usar o raciocínio padrão dele.
     *
     * @param {Error} erro
     * @returns {boolean}
     */
    _rejeitouRaciocinio(erro) {
        if (!erro || erro.status !== 400) return false;
        const m = String(erro.message || '');
        return /reasoning[_-]?effort/i.test(m)
            || /reasoning is mandatory/i.test(m)
            || /cannot be disabled/i.test(m);
    }

    /**
     * @param {object} opts
     * @param {Array} opts.messages
     * @param {number} [opts.temperature]
     * @param {number} [opts.max_tokens]
     * @param {'principal'|null} [opts.ateRota] limita a cadeia de fallback ao
     *   PRIMEIRO modelo (a rota principal). Usado pelo IAFallback, que tem
     *   o próprio fallback com o modelo certo do contexto (tarefa, ticket).
     * @param {string} [opts.contexto] rotulo interno (ex.: 'duvidas'), so
     *   para os logs. NUNCA vai para o corpo HTTP.
     *
     * Os campos internos ficam FORA de `extra` de propósito: `extra` é
     * espalhado no corpo HTTP e a API rejeita propriedade desconhecida com
     * 400 "property 'X' is unsupported".
     */
    async chat({ messages, temperature, max_tokens, ateRota = null, contexto = null, __retry = false, __semRaciocinio = false, ...extra }) {
        const _t0 = Date.now();
        const _preview = String(messages && messages[messages.length - 1] && messages[messages.length - 1].content || '').substring(0, 60);
        const teto = Math.max(max_tokens ?? this.maxTokens, this.minTokens);
        logInfo(`🧠 KILO ENVIADO | modelo=${this.model} temp=${temperature ?? this.temperature} max=${teto} fila=${this.active}/${this.maxConcurrency}${contexto ? ` contexto=${contexto}` : ''} pergunta="${_preview}"`);

        // Rede de segurança: `extra` é o que vai cru no corpo, então nada
        // com prefixo `__` (convenção de campo interno) pode passar. Um
        // `__retry` esquecido aqui derrubaria a chamada com 400.
        const interno = Object.keys(extra).filter(k => k.startsWith('__'));
        for (const k of interno) {
            logWarn(`⚠ campo interno "${k}" removido do corpo HTTP da rota`);
            delete extra[k];
        }

        const montarBody = (rota) => {
            const body = {
                model: rota.model,
                messages,
                max_tokens: teto,
                temperature: temperature ?? this.temperature,
                top_p: this.topP,
                ...extra
            };
            // `reasoning_effort` é enviado como está. O contrato do Gateway
            // não lista o parâmetro, mas MEDIDO no gateway ele funciona
            // (HTTP 200, reasoning_tokens=0 com 'none'). Se um modelo
            // recusar o campo, a auto-cura abaixo repete sem ele.
            //
            // `__semRaciocinio` é o_bandeira_ da auto-cura: na repetição o
            // campo NÃO vai, senão a segunda chamada leva o mesmo erro.
            if (this.reasoning && !__semRaciocinio) {
                body.reasoning_effort = this.reasoning;
            }
            return body;
        };
        const comOptions = (rota) => montarBody(rota);

        // -----------------------------------------------
        // TENTATIVA 1: rota principal
        // -----------------------------------------------
        let errors = [];
        let attempts = Math.max(1, this.maxRetries + 1);
        let feitos = 0;
        let rotaAtual = this._rotaPrincipal();
        let usarFallback = false;
        let data = null;

        let repetirSemRaciocinio = false;
        for (let attempt = 0; attempt < attempts; attempt++) {
            feitos++;
            await this._acquireSlot();
            try {
                data = await this._request(rotaAtual, comOptions(rotaAtual));
                break;
            } catch (error) {
                // AUTO-CURA: o Gateway (OpenRouter por baixo) pode rejeitar
                // `reasoning_effort` com 400 "property 'reasoning_effort' is
                // unsupported" em um modelo que nao aceita o campo. Nao faz
                // sentido deixar o bot sem IA por causa de um parametro
                // opcional: repete a MESMA rota sem ele e segue.
                if (!__semRaciocinio && this._rejeitouRaciocinio(error)) {
                    logWarn(`⚠ KILO recusou reasoning_effort (${error.status}) — repetindo sem o campo`);
                    repetirSemRaciocinio = true;
                    break;
                }
                errors.push(error);
                // 4xx (exceto 408/429) não é transitório NA MESMA ROTA: não
                // insiste. Mas o erro fica em errors[] e data continua null,
                // então o bloco de fallback abaixo ainda avalia se vale trocar
                // de rota (é o caso do 401, coberto por _valeFallback).
                const st = error.status;
                const clienteFinal = st && st >= 400 && st < 500 && st !== 408 && st !== 429;
                if (clienteFinal) break;
            } finally {
                this._releaseSlot();
            }
        }

        // O slot já foi devolvido pelo finally acima: a nova chamada volta a
        // fazer aaquisição por conta própria.
        if (repetirSemRaciocinio) {
            return this.chat({
                messages, temperature, max_tokens, ateRota, contexto,
                ...extra, __retry: true, __semRaciocinio: true,
            });
        }

        // Se a principal falhou por transporte/autenticacao, percorre a CADEIA
        // de rotas ate uma responder. Cada rota e tentada uma vez; a primeira
        // que der certo encerra.
        //
        // `ateRota` (opcional) limita ate onde a cadeia anda. O IAFallback
        // passa 'principal' para parar antes da rota alternativa, porque ele
        // tem o proprio fallback com o modelo certo do contexto — e nao quer
        // que a cadeia responda antes dele.
        if (data === null && this._valeFallback(errors[errors.length - 1])) {
            for (const rota of this.cadeia) {
                // Para ANTES de entrar numa rota proibida (ex.: parar antes
                // da alternativa quando ateRota='principal').
                if (ateRota === 'principal' && rota.nome !== 'principal') break;
                usarFallback = true;
                rotaAtual = rota;
                const tRota = Date.now();
                logWarn(`⚠ KILO principal indisponivel (${errors[errors.length - 1].message}) — tentando rota ${rota.nome}`);
                await this._acquireSlot();
                try {
                    data = await this._request(rota, comOptions(rota));
                    logInfo(`🔁 KILO respondeu pela rota ${rota.nome} em ${((Date.now() - tRota) / 1000).toFixed(1)}s`);
                    errors = [];
                    break; // deu certo, nao tenta a proxima
                } catch (error) {
                    errors.push(error);
                    logWarn(`⚠ rota ${rota.nome} tambem falhou (${error.message.substring(0, 120)})`);
                } finally {
                    this._releaseSlot();
                }
            }
        }

        // -----------------------------------------------
        // INTERPRETAÇÃO da resposta
        // -----------------------------------------------
        if (data !== null) {
            // Alguns erros voltam com HTTP 200 e o motivo no corpo.
            const erroNoCorpo = data?.error || data?.message?.error;
            if (erroNoCorpo) {
                errors.push(new Error('Kilo: ' + (typeof erroNoCorpo === 'string' ? erroNoCorpo : (erroNoCorpo.message || JSON.stringify(erroNoCorpo).slice(0, 180)))));
            } else {
                const msg = data?.choices?.[0]?.message || {};
                const reasoning = String(msg.reasoning || msg.reasoning_content || '');
                // 'reasoning' NUNCA e a resposta: e o raciocinio interno do modelo.
                const content = typeof msg.content === 'string' ? msg.content : '';
                if (content.trim()) {
                    logInfo(`✅ KILO RESPOSTA | ${((Date.now() - _t0) / 1000).toFixed(1)}s | "${String(content).replace(/\n/g, ' ').substring(0, 70)}"`);
                    return content.trim();
                }
                // Content vazio: request degenerado ou orçamento de raciocínio.
                const degenerado = data?.choices?.[0]?.finish_reason === 'load'
                    || data?.usage?.total_tokens === 0;
                if (degenerado && !reasoning) {
                    errors.push(new Error(`Kilo: request sem turno de 'user' (finish_reason=${data?.choices?.[0]?.finish_reason || '?'}) — o modelo nao chegou a gerar`));
                } else if (reasoning && !__retry) {
                    // Gastou o orçamento pensando: retry com mais tokens.
                    return this._escalarPorRaciocinio({ messages, temperature, max_tokens, extra, reasoning });
                } else if (reasoning) {
                    // Já estamos no retry (__retry) e ainda assim vazio: para
                    // aqui, senão a escalação vira recursão infinita.
                    errors.push(new Error(`Kilo: content vazio mesmo apos retry (raciocinio=${reasoning.length}ch)`));
                } else {
                    errors.push(new Error('Kilo: resposta sem conteudo valido'));
                }
            }
        }

        const erroFinal = errors[errors.length - 1] || new Error('Kilo: falha desconhecida');
        logError(`❌ KILO FALHOU | ${((Date.now() - _t0) / 1000).toFixed(1)}s | tentativas=${feitos}${usarFallback ? '+fallback' : ''} | ${erroFinal.message}`);
        throw erroFinal;
    }

    /**
     * Content vazio COM raciocínio: o modelo consumiu o orçamento de
     * max_tokens pensando. Repete com o dobro (sem regredir abaixo do que foi
     * pedido). Só executa na rota principal, como antes.
     */
    _escalarPorRaciocinio({ messages, temperature, max_tokens, extra, reasoning, _t0 }) {
        const big = Math.max(this.minTokens * 2, 2400, max_tokens ?? 0);
        logWarn(`↻ KILO sem resposta (raciocinio=${reasoning.length}ch) -> repete com ${big} tokens`);
        return this.chat({
            messages,
            temperature,
            max_tokens: big,
            ...extra,
            __retry: true
        });
    }

    /**
     * Lista de modelos do gateway (GET /models).
     *
     * MEDIDO neste aparelho: essa chamada leva 15-26s e devolve ~540KB
     * (401 modelos). Duas consequências:
     *
     *   - o abort precisa ser MAIOR que o connect timeout do dispatcher
     *     (45s), senão a chamada morre com UND_ERR_CONNECT_TIMEOUT;
     *   - o watchdog não pode baixar o catálogo inteiro a cada ciclo. Por
     *     isso o resultado é cacheado por MODELS_TTL_MS.
     *
     * @returns {Promise<{ok:boolean, models:Array}>}
     */
    async _listarModelos(forcar = false) {
        const agora = Date.now();
        if (!forcar && agora - this._cacheModelos.ts < MODELS_TTL_MS) {
            return this._cacheModelos;
        }
        let ultimoErro = null;
        for (let tentativa = 0; tentativa < 5; tentativa++) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), MODELS_TIMEOUT_MS);
                // O dispatcher é OBRIGATÓRIO aqui: sem ele o undici aborta o
                // connect em 10s e, nesta rede, o TLS do gateway leva 15-26s —
                // a chamada morria com UND_ERR_CONNECT_TIMEOUT.
                const response = await httpFetch(`${this.baseUrl}/models`, {
                    headers: this._headers(),
                    method: 'GET',
                    signal: controller.signal,
                });
                clearTimeout(timer);
                if (!response.ok) return { ok: false, models: [] };
                const data = await response.json();
                const models = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []);
                this._cacheModelos = { ok: true, models, ts: agora };
                return this._cacheModelos;
            } catch (e) {
                // Falha não cacheia: o próximo ciclo tenta de novo. A rede
                // daqui oscila (EAI_AGAIN, ECONNRESET) e uma única tentativa
                // derruba o health check.
                ultimoErro = e;
                if (tentativa === 4) break;
                logWarn(`⚠ health check do gateway falhou (${e.message}) — repetindo`);
                await new Promise(r => setTimeout(r, 3000 * (tentativa + 1)));
            }
        }
        logWarn(`⚠ health check do gateway falhou: ${ultimoErro && ultimoErro.message}`);
        return { ok: false, models: [] };
    }

    /**
     * O gateway está no ar?
     *
     * Usa HEAD: o gateway responde 200 com o MESMO status do GET, mas sem
     * baixar o corpo (0 bytes em vez de 540KB). O /models não exige
     * autenticação, então isto checa só a rede e o serviço.
     *
     * A rede do Termux oscila (EAI_AGAIN, ECONNRESET, "fetch failed"), e o
     * health check é justamente o que roda quando a rede está ruim. Sem
     * retentativa, UMA oscilação de 2s fazia o bot declarar "IA
     * indisponível" no console — um alarme falso.
     *
     * @returns {Promise<boolean>}
     */
    async isServeRunning() {
        for (let tentativa = 0; tentativa < 3; tentativa++) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), MODELS_TIMEOUT_MS);
                const response = await httpFetch(`${this.baseUrl}/models`, {
                    method: 'HEAD',
                    signal: controller.signal,
                });
                clearTimeout(timer);
                return response.ok;
            } catch (e) {
                if (tentativa === 2) {
                    logWarn(`⚠ health check do gateway falhou: ${e.message}`);
                    return false;
                }
                logWarn(`⚠ health check do gateway falhou (${e.message}) — repetindo`);
                await new Promise(r => setTimeout(r, 3000 * (tentativa + 1)));
            }
        }
        return false;
    }

    /**
     * O modelo configurado existe no gateway?
     * (Equivalente ao antigo "modelo carregado em memória" do Ollama:
     * para um provider cloud, o que importa é o modelo existir.)
     * @returns {Promise<boolean>}
     */
    async isModelLoaded() {
        if (!this.model) return true;
        const { ok, models } = await this._listarModelos();
        if (!ok) return false;
        return models.some(m => (m.id || m.name || m.model) === this.model);
    }

    /**
     * Verificar se o gateway está disponível e o modelo configurado existe.
     * O /models do gateway não exige autenticação.
     * @returns {Promise<boolean>}
     */
    async isAvailable() {
        const { ok, models } = await this._listarModelos();
        if (!ok) return false;
        if (!this.model) return models.length > 0;
        return models.some(m => (m.id || m.name || m.model) === this.model);
    }

    /**
     * Aquecer o caminho com uma chamada mínima (abre a conexão, valida a
     * chave e o modelo antes do primeiro prompt do Discord).
     * @returns {Promise<boolean>}
     */
    async warmUp() {
        if (!this.model || !this.apiKey) return false;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await httpFetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: this._headers(),
                body: JSON.stringify({
                    model: this.model,
                    messages: [{ role: 'user', content: 'ok' }],
                    max_tokens: 16,
                }),
                signal: controller.signal,
            });
            return response.ok;
        } catch (e) {
            return false;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Retornar um resumo do status da IA (gateway no ar, modelo disponível).
     *
     * Duas fontes: HEAD /models (barato, 0 bytes) para o gateway no ar, e o
     * GET /models cacheado para a lista de modelos. Assim o watchdog não
     * baixa 540KB a cada ciclo.
     *
     * @returns {Promise<Object>}
     */
    async getStatus() {
        const [online, { ok, models }] = await Promise.all([
            this.isServeRunning(),
            this._listarModelos(),
        ]);
        const temModelo = !this.model || models.some(m => (m.id || m.name || m.model) === this.model);
        return {
            serveRunning: online,
            modelInstalled: ok && temModelo,
            modelLoaded: ok && temModelo,
        };
    }
}

module.exports = new KiloClient();
