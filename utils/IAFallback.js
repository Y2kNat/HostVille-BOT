/**
 * Cliente de IA com fallback automatico, parametrizado por prefixo do .env.
 *
 * Existe um factory (criarIA) para nao duplicar a mecanica: cada subsystem
 * (tickets, taskrunner) aponta para um prefixo proprio e ganha seu proprio
 * modelo de fallback, timeout e orcamento de tokens.
 *
 * O objeto `cliente` tem a MESMA interface do KiloClient (.chat), entao
 * qualquer chamador continua funcionando sem saber da existencia do fallback.
 *
 * PROVEDOR: Kilo Code (AI Gateway). O "fallback" aqui é o MESMO gateway com
 * OUTRO MODELO (o prefixo do .env escolhe qual): cobre o caso do modelo
 * principal cair ou estourar cota, sem sair do provedor.
 */
const kilo = require('../managers/KiloClient');
const { logInfo, logWarn, logError } = require('./logger');
const { chat: kiloChat } = require('./kiloChat');

/** Promise que perde se a outra nao resolver a tempo. */
function comTimeout(promise, ms, rotulo) {
    let timer;
    const limite = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const e = new Error(`${rotulo} nao respondeu em ${ms}ms`);
            e.timeout = true;
            reject(e);
        }, ms);
    });
    return Promise.race([promise, limite]).finally(() => clearTimeout(timer));
}

/**
 * @param {Object} cfg
 * @param {string} cfg.prefixo            prefixo das chaves no .env (ex.: 'FALLBACK_')
 * @param {string} cfg.modeloPadrao       modelo do fallback se o .env nao definir
 * @param {string} [cfg.basePadrao]       base da API
 * @param {number} [cfg.esperaMsPadrao]   tempo maximo do principal antes de trocar
 * @param {number} [cfg.timeoutMsPadrao]  timeout da chamada de fallback
 * @param {number} [cfg.maxTokensPadrao]  teto de tokens do fallback
 * @param {number} [cfg.minTokensPadrao]  piso de tokens (ver nota sobre raciocinio)
 * @param {string} [cfg.reasoningEffortPadrao]     reasoning_effort padrao
 * @param {string} [cfg.contextoPadrao]   rotulo nos logs
 * @param {boolean} [cfg.ativoPadrao]     se false, o fallback nem e montado
 */
function criarIA(cfg) {
    const P = cfg.prefixo;
    /**
     * Modelo do fallback, em ordem de preferencia:
     *   1) o prefixo do .env (ex.: FALLBACK_MODEL=) — escolha explicita
     *   2) o modeloPadrao do subsystem (ticket / taskrunner)
     *   3) o modelo principal (KILO_DEFAULT_MODEL) — ultimo recurso
     *
     * O passo 3 e o fallback de verdade: se o fallback usasse o MESMO modelo
     * do principal, cair um significaria cair os dois, e a "segunda
     * camada" nao cobriria nada.
     */
    const modeloPadrao = () => (typeof cfg.modeloPadrao === 'function' ? cfg.modeloPadrao() : cfg.modeloPadrao);
    const modelo = () => process.env[P + 'MODEL'] || modeloPadrao() || process.env.KILO_DEFAULT_MODEL || '';
    /** Base do gateway (sem /chat/completions: quem completa é o kiloChat). */
    const base = () => (process.env[P + 'BASE_URL'] || cfg.basePadrao || process.env.KILO_BASE_URL || 'https://ai-gateway.kilo.ai/api/v1').replace(/\/+$/, '');

    /** Chave vazia = herda a principal, para nao duplicar segredo no .env. */
    const apiKey = () => process.env[P + 'API_KEY'] || process.env.MODERATION_API_KEY || process.env.KILO_API_KEY || '';

    const esperaMs = () => parseInt(process.env[P + 'APOS_MS'] || cfg.esperaMsPadrao || '25000', 10);
    const timeoutMs = () => parseInt(process.env[P + 'TIMEOUT_MS'] || cfg.timeoutMsPadrao || '45000', 10);
    const maxTokens = () => parseInt(process.env[P + 'MAX_TOKENS'] || cfg.maxTokensPadrao || '4000', 10);
    const minTokens = () => parseInt(process.env[P + 'MIN_TOKENS'] || cfg.minTokensPadrao || '1500', 10);
    const effort = () => process.env[P + 'REASONING_EFFORT'] || cfg.reasoningEffortPadrao || 'none';

    const ativo = () => {
        if (process.env[P + 'IA'] === 'false') return false;
        if (process.env.P === 'FALLBACK_' && process.env.FALLBACK_IA === 'false') return false;
        return !!apiKey();
    };

    /**
     * Fallback no gateway Kilo com OUTRO modelo. Assinatura identica a do
     * KiloClient.chat().
     *
     * NOTA SOBRE O MINIMO DE TOKENS: modelos de RACIOCINIO gastam tokens
     * escondidos em `reasoning` antes de escrever `content`. Medido: com
     * max_tokens=5 o finish_reason vem "length" e o content volta VAZIO,
     * mesmo gastando so 3 tokens. Por isso o piso. Quem chama com
     * max_tokens=5 (o classificador do TaskRunner) continua funcionando.
     *
     * NOTA SOBRE `reasoning_effort`: o Gateway nao lista o campo no contrato
     * e alguns modelos respondem 400 com ele. Por isso o padrao e 'none' e o
     * campo so e enviado quando o .env pede um esforco concreto.
     */
    const Kilo = {
        get modelo() { return modelo(); },
        get enabled() { return ativo(); },

        async chat({ messages, temperature = 0.3, max_tokens, ..._rest } = {}) {
            if (!ativo()) {
                const e = new Error(`${P}fallback indisponivel (desligado ou sem chave)`);
                e.fallbackDown = true;
                throw e;
            }

            const teto = Math.max(minTokens(), max_tokens || 0);
            const ef = effort();

            // O kiloChat centraliza o dispatcher (connect timeout > 10s),
            // o retry de falha TRANSITORIA e a auto-cura do
            // `reasoning_effort`. Sem ele, uma oscilação de rede derrubava o
            // fallback inteiro — que é justamente o caminho que existe para
            // quando a rede cai.
            const r = await kiloChat({
                model: modelo(),
                messages,
                temperature,
                max_tokens: teto,
                reasoning_effort: ef || null,
                timeoutMs: timeoutMs(),
                apiKey: apiKey(),
                baseUrl: base(),
            });

            const texto = String(r.content || '').trim();
            const finish = r.finish_reason;

            if (texto) return texto;

            // Content vazio: se o orcamento acabou, o modelo NAO chegou a
            // responder. Nao devolvemos o raciocinio como se fosse resposta:
            // o classificador do TaskRunner leria aquilo e decideria errado.
            if (finish === 'length') {
                const e = new Error(`Kilo gastou o orcamento (${teto} tokens) pensando e nao respondeu — aumente ${P}MAX_TOKENS ou ${P}MIN_TOKENS`);
                e.fallbackEmpty = true;
                throw e;
            }
            const e = new Error(`Kilo devolveu resposta vazia (finish=${finish})`);
            e.fallbackEmpty = true;
            throw e;
        },
    };

    /**
     * Gera usando o principal; se cair, travar ou responder vazio, usa o fallback.
     * @returns {Promise<{texto:string, via:'kilo'|'kilo-fallback'}>}
     */
    async function comFallback({ gerar, contexto = cfg.contextoPadrao || 'ticket' }) {
        const t0 = Date.now();
        let ultimoErro = null;

        try {
            const r = await comTimeout(gerar(kilo), esperaMs(), 'modelo principal');
            if (r && String(r).trim()) {
                const ms = Date.now() - t0;
                if (ms > esperaMs() * 0.6) logWarn(`🐢 ${contexto}: principal demorou ${ms}ms`);
                else logInfo(`⚡ ${contexto}: principal respondeu em ${ms}ms`);
                return { texto: r, via: 'kilo' };
            }
            ultimoErro = new Error('principal devolveu resposta vazia');
        } catch (e) {
            ultimoErro = e;
        }

        const causa = ultimoErro?.timeout
            ? `travou por mais de ${esperaMs()}ms`
            : ultimoErro?.message || 'erro desconhecido';
        logWarn(`⚠️ ${contexto}: modelo principal indisponivel (${causa})`);

        if (!ativo()) {
            logError(`🚫 ${contexto}: principal falhou e o fallback esta desligado (${P}IA=false ou sem chave)`);
            throw ultimoErro || new Error('sem modelo disponivel');
        }

        const t1 = Date.now();
        try {
            const r = await gerar(Kilo);
            if (r && String(r).trim()) {
                logWarn(`🔁 ${contexto}: respondi com o fallback ${modelo()} (${Date.now() - t1}ms) | causa: ${causa}`);
                return { texto: r, via: 'kilo-fallback' };
            }
            throw new Error('fallback devolveu vazio');
        } catch (e) {
            logError(`💀 ${contexto}: principal E fallback falharam | principal: ${causa} | fallback: ${e.message}`);
            throw e;
        }
    }

    /** Drop-in do KiloClient. */
    const cliente = {
        async chat(opts) {
            const { texto } = await comFallback({
                // A cadeia de rotas do KiloClient tem uma rota alternativa com
                // um modelo generico. Se ela respondesse aqui, o IAFallback
                // NUNCA chegaria no seu proprio fallback, e um ticket que
                // deveria usar um modelo de suporte acabaria respondido pelo
                // modelo generico — mais fraco, sem ninguem avisar.
                //
                // Por isso os caminhos IAFallback param a cadeia ANTES da
                // rota alternativa (ateRota='principal'), deixando a escolha
                // de modelo para o IAFallback, que sabe o contexto (tarefa,
                // ticket).
                gerar: (modelo) => {
                    const o = { ...opts };
                    if (modelo === kilo) o.ateRota = 'principal';
                    return modelo.chat(o);
                },
                contexto: opts.contexto || cfg.contextoPadrao || 'ticket',
            });
            return texto;
        },
        isCloud: true,
        get model() { return kilo.model; },
    };

    return { Kilo, comFallback, cliente, get ESPERA_MS() { return esperaMs(); } };
}

module.exports = { criarIA, comTimeout };
