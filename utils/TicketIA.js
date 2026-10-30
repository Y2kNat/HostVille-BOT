/**
 * IA dos tickets: o modelo principal (KILO_DEFAULT_MODEL) com um fallback
 * de MODELO DIFERENTE no mesmo gateway do Kilo.
 * Configuracao no .env com o prefixo FALLBACK_.
 *
 * ai/ResponseValidator usa este objeto no lugar do cliente principal e
 * continua igual: a resposta do fallback passa pelo mesmo validador, entao
 * a garantia de nao-alucinar nao muda.
 */
const { criarIA } = require('./IAFallback');

module.exports = criarIA({
    prefixo: 'FALLBACK_',
    // Sem FALLBACK_MODEL no .env, usa o modelo alternativo do gateway
    // (KILO_FALLBACK_MODEL): se repetisse o principal, cair um significaria
    // cair os dois e a segunda camada nao cobriria nada.
    modeloPadrao: () => process.env.KILO_FALLBACK_MODEL || '',
    contextoPadrao: 'ticket',
    esperaMsPadrao: 25000,
    timeoutMsPadrao: 45000,
    maxTokensPadrao: 4000,
    minTokensPadrao: 1500,
    reasoningEffortPadrao: 'none',
});
