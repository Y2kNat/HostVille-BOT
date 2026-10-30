/**
 * HTTP com CONNECT timeout maior que o do undici.
 *
 * ══════════════════════════════════════════════════════════════════════
 * POR QUE ISTO EXISTE
 * ══════════════════════════════════════════════════════════════════════
 * O undici (fetch do Node) aborta o connect em 10s. Medido neste aparelho:
 * o TLS com o host do gateway leva 15-26s e a chamada inteira 21s — então a
 * rota MORRIA SEMPRE com `UND_ERR_CONNECT_TIMEOUT`, sem ser problema de
 * chave nem de modelo (a mesma rota com connect de 45s responde HTTP 200
 * em 20,9s). No log isso aparecia como "This operation was aborted".
 *
 * O timeout por rota (KILO_TIMEOUT_MS etc.) protege o TEMPO TOTAL da
 * chamada; o connect timeout é outro relógio, do TCP, e o undici não
 * expõe em variável de ambiente. Por isso o Agent.
 *
 * ══════════════════════════════════════════════════════════════════════
 * POR QUE O FETCH É O DO UNDICI INSTALADO (e não o global do Node)
 * ══════════════════════════════════════════════════════════════════════
 * O `fetch` GLOBAL do Node usa o undici EMBUTIDO nele:
 *
 *   Node 24 → undici 7.29.1     Node 26 → undici 8.5.0
 *
 * O undici INSTALADO no projeto é o 6.24.1. Um Agent do v6 passado para
 * o fetch global é RECUSADO na hora:
 *
 *   fetch failed | UND_ERR_INVALID_ARG
 *
 * E isso não é teoria: era o que acontecia em TODA chamada de IA no
 * aparelho (o bot roda no Node 26 do Termux). O sintoma era o health check
 * dizer "Gateway do Kilo NÃO está respondendo" com a IA funcionando
 * perfectly — a chamada nem saía.
 *
 * A saída é usar o fetch DO PRÓPRIO undici instalado, que é coerente com
 * o Agent dele:
 *
 *   const { Agent, fetch: undiciFetch } = require('undici');
 *   undiciFetch(url, { dispatcher: agent })   // ← funciona nos dois Node
 *
 * Medido: Node 26 → 0,5s; Node 24 → 20,8s (sem o Agent, estouraria o
 * timeout de 10s).
 *
 * Sem `undici` no projeto, `dispatcher()` devolve null e o fetch segue
 * normal — só volta o timeout de 10s, ou seja, o comportamento de antes.
 */
const config = require('../config');
const { logWarn } = require('./logger');

let _agent = null;
let _tentou = false;
// O fetch do undici instalado. `null` quando o undici não está no projeto
// (aí o chamador cai no fetch global, sem dispatcher).
let _fetchUndici = null;
// Transporte injetado (só teste). Ver setFetchImpl().
let _fetchImpl = null;

// O fetch global "de verdade", capturado uma única vez por PROCESSO.
//
// Por que global e não local: os testes trocam `global.fetch` para
// controlar o transporte sem tocar na rede, e o httpDispatcher é
// recarregado por eles (o cache é limpo para pegar o singleton limpo).
// Um snapshot local seria recapturado já com o duble instalado, e a
// detecção de "o fetch global foi trocado" nunca dispararia — a chamada
// escaparia para a rede de verdade.
//
// Guardar num Symbol.for() faz o snapshot sobreviver ao recarregamento
// do módulo.
const _KEY_FETCH_ORIGINAL = Symbol.for('hostville.httpDispatcher.fetchOriginal');
if (!globalThis[_KEY_FETCH_ORIGINAL]) {
    globalThis[_KEY_FETCH_ORIGINAL] = globalThis.fetch;
}
const _fetchGlobalOriginal = globalThis[_KEY_FETCH_ORIGINAL];

/**
 * Agent compartilhado (conexão reutilizada entre chamadas) ou null se o
 * undici não estiver disponível.
 * @returns {object|null}
 */
function dispatcher() {
    if (_tentou) return _agent;
    _tentou = true;
    try {
        // eslint-disable-next-line global-require
        const undici = require('undici');
        const ms = Number(config.KILO_CONNECT_TIMEOUT_MS) || 45000;
        _agent = new undici.Agent({ connect: { timeout: ms } });
        _fetchUndici = undici.fetch;
    } catch (e) {
        logWarn(`[http] undici ausente (${e.code || e.message}) — connect segue no timeout padrão de 10s do fetch`);
        _agent = null;
        _fetchUndici = null;
    }
    return _agent;
}

/**
 * O fetch a usar: o do undici instalado, COM o Agent.
 *
 *IMPORTANTE: não usar o `fetch` global aqui. O global usa o undici
 * EMBUTIDO no Node (v7 no 24, v8 no 26) e recusa o Agent do undici
 * instalado (v6) com UND_ERR_INVALID_ARG — o que matava toda chamada de
 * IA no aparelho.
 *
 * @param {string} url
 * @param {object} [opts] opções do fetch (method, headers, body, signal...)
 * @returns {Promise<Response>}
 */
function fetch(url, opts = {}) {
    // Transporte injetado (teste): o duble controla a resposta e não
    // conhece `dispatcher`.
    if (_fetchImpl) return _fetchImpl(url, opts);
    // Alguém trocou o `global.fetch` (os testes fazem isso): usa o
    // substituto. Ele não conhece `dispatcher` — e é justamente o que o
    // teste quer, controlar o transporte sem tocar na rede.
    if (globalThis.fetch !== _fetchGlobalOriginal) {
        return globalThis.fetch(url, opts);
    }
    const d = dispatcher();
    if (!_fetchUndici || !d) {
        // Sem undici: fetch global, sem dispatcher (comportamento antigo).
        return globalThis.fetch(url, opts);
    }
    return _fetchUndici(url, { ...opts, dispatcher: d });
}

/**
 * Troca o transporte HTTP (só para teste).
 *
 * POR QUE EXISTE: o `fetch` global do Node não aceita o Agent do undici
 * instalado, então a produção usa o fetch do próprio undici. Um teste que
 * trocasse `global.fetch` NÃO interceptaria nada — e, pior, a chamada
 * escaping para a rede de verdade (o teste passou a bater no gateway
 * real). Com injeção explícita, o teste hermético continua hermético.
 *
 * @param {Function|null} fn null = volta ao transporte real
 */
function setFetchImpl(fn) {
    _fetchImpl = fn || null;
}

/** Volta ao transporte real. */
function clearFetchImpl() {
    _fetchImpl = null;
}

/**
 * Opções de fetch com o dispatcher quando ele existe.
 *
 * @deprecated Use `fetch()` deste módulo: o `fetch` global do Node recusa
 * o Agent do undici instalado (UND_ERR_INVALID_ARG). Esta função só
 * continua existindo para compatibilidade com quem passa as opções a um
 * `fetch` qualquer.
 * @returns {object} objeto para espalhar no fetch() — vazio sem undici
 */
function fetchOpts() {
    const d = dispatcher();
    return d ? { dispatcher: d } : {};
}

/** Fecha as conexões do Agent (usado em teste e no shutdown). */
async function fechar() {
    if (!_agent) return;
    const a = _agent;
    _agent = null;
    _tentou = false;
    _fetchUndici = null;
    await a.close().catch(() => {});
}

module.exports = { dispatcher, fetch, fetchOpts, setFetchImpl, clearFetchImpl, fechar };
