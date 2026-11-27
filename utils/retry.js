const { logWarn } = require('./logger');

/**
 * Retentativa genérica com backoff exponencial e jitter.
 * Só erro operacional é retentável; 4xx de validação não.
 */
async function comRetry(fn, opts = {}) {
    const {
        tentativas = 3,
        baseMs = 1000,
        maxMs = 30000,
        contexto = 'retry',
        ehRetentavel = padraoRetentavel,
    } = opts;

    let ultimoErro = null;
    for (let n = 1; n <= tentativas; n++) {
        try {
            return await fn(n);
        } catch (e) {
            ultimoErro = e;
            if (!ehRetentavel(e, n)) {
                logWarn(`⚠ ${contexto}: erro não retentável (${e.message})`);
                throw e;
            }
            if (n === tentativas) break;
            const teto = Math.min(maxMs, baseMs * 2 ** (n - 1));
            const espera = Math.round(teto * (0.75 + Math.random() * 0.5));
            logWarn(`⚠ ${contexto}: tentativa ${n}/${tentativas} falhou (${e.message}) — nova em ${espera}ms`);
            await new Promise(r => setTimeout(r, espera));
        }
    }
    throw ultimoErro;
}
function padraoRetentavel(e) {
    const m = String((e && e.message) || '');
    if (/EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|buffering timed out|connectTimeoutMS|getaddrinfo|fetch failed|network|timeout/i.test(m)) return true;
    if (/MongooseServerSelectionError|MongoNetworkError|MongoNotConnected/i.test(m)) return true;
    const code = Number(e && (e.code || e.status));
    if (code === 429 || (code >= 500 && code <= 599)) return true;
    return false;
}

module.exports = { comRetry, padraoRetentavel };
