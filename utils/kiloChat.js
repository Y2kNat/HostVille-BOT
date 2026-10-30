/**
 * Uma única porta de entrada para o gateway do Kilo Code.
 *
 * POR QUE ISTO EXISTE
 *
 * Até aqui, quatro arquivos faziam a MESMA chamada HTTP na mão:
 * InjectionGuard, TierJudge, ModerationClassifier e ResumoIA. Cada um tinha
 * a sua cópia do fetch — e cada cópia tinha o seu bug:
 *
 *   - NENHUM deles usava o dispatcher do httpDispatcher. O undici aborta o
 *     connect em 10s e, nesta rede, o TLS do gateway leva mais que isso: a
 *     chamada morria com UND_ERR_CONNECT_TIMEOUT. Pior: ela só "funcionava"
 *     quando outra chamada anterior tinha deixado a conexão aquecida no
 *     pool do undici. Um bot recém-iniciado não teria essa sorte.
 *
 *   - NENHUM deles respeitava o `reasoning_effort` de forma consistente, e
 *     o `max_tokens` de cada um era fixo num valor que não sobrava espaço
 *     para a RESPOSTA depois do raciocínio do modelo.
 *
 *   - NENHUM deles tinha a auto-cura do 400 "property 'reasoning_effort' is
 *     unsupported".
 *
 * O KiloClient (models/KiloClient.js) faz a chamada principal e tem a
 * cadeia de rotas; este arquivo cobre os CHAMADORES AVULSOS (classificadores
 * e o resumo), que têm base/chave/timeout próprios.
 */
const config = require('../config');
const { fetch: httpFetch } = require('./httpDispatcher');

/**
 * Quantas vezes repetir uma chamada que falhou por motivo TRANSITÓRIO.
 *
 * MEDIDO no gateway: o provedor de baixo (AtlasCloud, por trás do
 * dots-3-note-preview) às vezes responde 400 "text content parts must carry
 * a string \"text\" (got undefined)" para uma requisição PERFEITAMENTE
 * válida. O gateway repassou um payload serializado errado — é glitch do
 * provedor, não pedido ruim. Sem retry, o resumo do ticket saía vazio
 * "do nada" uma em cada N chamadas.
 */
const MAX_RETRIES = 2;
const BACKOFF_MS = [1500, 4000];

/**
 * O erro é transitório (vale repetir)?
 *
 *  - 429 (cota), 5xx, 408: sim, são o caso clássico.
 *  - 400 com mensagem de SERIALIZAÇÃO do provedor: sim, é o glitch acima.
 *  - 400 normal (modelo inválido, campo rejeitado): NÃO. Repetir só gasta
 *    cota e devolve o mesmo erro.
 */
function _eTransitorio(erro) {
    if (!erro) return false;
    const st = erro.status;
    if (st === 429 || st === 408 || (st && st >= 500)) return true;
    // Erro de serialização do provedor: o gateway repassou um payload
    // quebrado. A requisição é válida — repetir funciona.
    if (st === 400 && /content parts must carry|malformed|invalid_request/i.test(String(erro.message || ''))) {
        return true;
    }
    // Erro de REDE (status 0): o mesmo pedido funciona na tentativa seguinte.
    // São os erros que o crashLogger do projeto já classifica como
    // "operacionais" — a rede do aparelho oscila o tempo todo.
    if (!st && /fetch failed|ECONNRESET|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|UND_ERR/i.test(String(erro.message || ''))) {
        return true;
    }
    return false;
}

/**
 * O gateway recusou o `reasoning_effort`?
 *
 * MEDIDO: os modelos do MESMO gateway discordam sobre o campo.
 *   - dots-studio/dots-3-note-preview:free  → ACEITA 'none' (reasoning_tokens=0)
 *   - minimax/minimax-m3.1-flash:free       → EXIGE raciocínio: 400
 *     "Reasoning is mandatory for this endpoint and cannot be disabled."
 *   - meta-llama/llama-prompt-guard-2-86m   → não lista o campo
 *
 * Nos dois casos de 400 a saída é a MESMA: repetir SEM o campo e deixar o
 * modelo usar o raciocínio padrão dele.
 */
function _recusouRaciocinio(texto) {
    const t = String(texto || '');
    return /reasoning[_-]?effort/i.test(t)
        || /reasoning is mandatory/i.test(t)
        || /cannot be disabled/i.test(t);
}

/**
 * Erro de resposta do gateway, com o status em `.status` para o chamador
 * decidir (fail-open, retry, etc.).
 */
class ErroKilo extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'ErroKilo';
        this.status = status || 0;
    }
}

/**
 * Chamada de chat completion no gateway.
 *
 * @param {Object} opts
 * @param {string} opts.model                  modelo (provedor/nome-do-modelo)
 * @param {Array}  opts.messages               [{role, content}]
 * @param {number} [opts.temperature=0]
 * @param {number} [opts.max_tokens=512]
 * @param {string|null} [opts.reasoning_effort] enviado como está. 'none'
 *   DESLIGA o raciocínio do modelo (medido: reasoning_tokens=0 e a resposta
 *   sai direto). Use nos classificadores: eles não devem pensar, devem
 *   responder.
 * @param {number} [opts.timeoutMs=30000]      timeout de CADA tentativa
 * @param {number} [opts.deadlineMs]            orçamento TOTAL da operação
 *   (tentativas + esperas). Sem ele, 3 tentativas de 30s dariam 90s de
 *   espera — e o guard segura a mensagem do Discord esse tempo todo.
 * @param {string} [opts.apiKey]               padrão: KILO_API_KEY
 * @param {string} [opts.baseUrl]              padrão: KILO_BASE_URL
 * @param {Object} [opts.extra]                campos extras no corpo
 * @param {Function} [opts.fetchImpl]          fetch alternativo (teste)
 * @returns {Promise<{content:string, reasoning:string, finish_reason:string, usage:object, raw:object}>}
 */
async function chat(opts) {
    const {
        model,
        messages,
        temperature = 0,
        max_tokens = 512,
        reasoning_effort = null,
        timeoutMs = 30000,
        deadlineMs = null,
        apiKey = null,
        baseUrl = null,
        extra = {},
        fetchImpl = null,
    } = opts;

    const base = String(baseUrl || config.KILO_BASE_URL || 'https://ai-gateway.kilo.ai/api/v1').replace(/\/+$/, '');
    const key = String(apiKey || config.KILO_API_KEY || '');

    if (!model) throw new ErroKilo('Kilo: modelo nao informado', 0);
    if (!key) throw new ErroKilo('Kilo: KILO_API_KEY vazia', 401);

    const corpo = {
        model,
        messages,
        temperature,
        max_tokens,
        ...extra,
    };
    if (reasoning_effort) corpo.reasoning_effort = reasoning_effort;

    const inicio = Date.now();
    const sobra = () => (deadlineMs ? deadlineMs - (Date.now() - inicio) : Infinity);

    let ultimo = null;
    for (let tentativa = 0; tentativa <= MAX_RETRIES; tentativa++) {
        const restante = sobra();
        if (restante <= 0) {
            throw ultimo || new ErroKilo('Kilo: deadline de ' + deadlineMs + 'ms estourado', 408);
        }
        try {
            const resposta = await _post(
                `${base}/chat/completions`, corpo, key,
                Math.min(timeoutMs, restante), !!reasoning_effort, fetchImpl
            );
            const msg = resposta?.choices?.[0]?.message || {};
            return {
                content: typeof msg.content === 'string' ? msg.content : '',
                reasoning: String(msg.reasoning || msg.reasoning_content || ''),
                finish_reason: resposta?.choices?.[0]?.finish_reason || null,
                usage: resposta?.usage || {},
                raw: resposta,
            };
        } catch (e) {
            ultimo = e;
            if (!_eTransitorio(e) || tentativa === MAX_RETRIES) throw e;
            const espera = BACKOFF_MS[Math.min(tentativa, BACKOFF_MS.length - 1)];
            // A espera tambem conta no orçamento: nao adianta repetir se ja
            // nao ha mais tempo.
            if (sobra() <= espera) throw e;
            console.warn(`[kilo] falha transitoria (${e.status || 'rede'}): ${String(e.message).slice(0, 90)} — repetindo em ${espera}ms`);
            await new Promise(r => setTimeout(r, espera));
        }
    }
    throw ultimo;
}

/**
 * POST com timeout, dispatcher e auto-cura do `reasoning_effort`.
 *
 * @private
 */
async function _post(url, corpo, key, timeoutMs, temRaciocinio, fetchImpl) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // `httpFetch` é o fetch do undici INSTALADO, que é coerente com o Agent
    // dele. O `fetch` GLOBAL do Node usa o undici EMBUTIDO (v7 no Node 24,
    // v8 no 26) e recusa o Agent do undici instalado com
    // UND_ERR_INVALID_ARG — era o que matava toda chamada de IA.
    // `fetchImpl` existe só para os testes trocarem o transporte.
    const doFetch = fetchImpl || httpFetch;
    try {
        const res = await doFetch(url, {
            method: 'POST',
            signal: ctrl.signal,
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(corpo),
        });

        if (!res.ok) {
            const t = await res.text().catch(() => '');
            // AUTO-CURA: o gateway recusou o `reasoning_effort` (o modelo não
            // suporta o campo, ou EXIGE raciocínio e não aceita 'none').
            // Nos dois casos a saída é a mesma: repetir sem o campo e deixar
            // o modelo usar o padrão dele.
            if (temRaciocinio && res.status === 400 && _recusouRaciocinio(t)) {
                const sem = { ...corpo };
                delete sem.reasoning_effort;
                return _post(url, sem, key, timeoutMs, false, fetchImpl);
            }
            throw new ErroKilo(`Kilo ${res.status}: ${t.slice(0, 200)}`, res.status);
        }

        return await res.json();
    } catch (e) {
        if (e instanceof ErroKilo) throw e;
        if (e.name === 'AbortError') throw new ErroKilo(`Kilo: timeout de ${timeoutMs}ms`, 408);
        throw new ErroKilo(`Kilo: ${e.message}`, 0);
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { chat, ErroKilo };
