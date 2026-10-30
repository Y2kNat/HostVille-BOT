/**
 * IA do TaskRunner: o modelo principal (KILO_DEFAULT_MODEL) com um
 * fallback de MODELO DIFERENTE no mesmo gateway do Kilo.
 * Configuracao no .env com o prefixo TASK_FALLBACK_.
 *
 * Cobre os dois pontos onde o TaskRunner chama o modelo:
 *   1. o classificador isTaskRequest()  -> sem fallback, nenhuma tarefa e
 *      reconhecida quando o modelo principal cai (o bot fica "mudo" para codigo);
 *   2. a geracao em run()               -> sem fallback, o usuario espera
 *      o erro em vez de receber o arquivo.
 *
 * O fallback usa um MODELO MENOR por padrao porque aqui o modelo precisa
 * escrever codigo longo: e mais rapido e o orcamento de tokens do TaskRunner
 * ja e alto (TASK_MAX_TOKENS).
 */
const { criarIA } = require('./IAFallback');

module.exports = criarIA({
    prefixo: 'TASK_FALLBACK_',
    // Sem TASK_FALLBACK_MODEL no .env, usa o modelo alternativo do gateway
    // (KILO_FALLBACK_MODEL). Aqui o modelo alternativo costuma ser o mais
    // rápido: quem espera código está com pressa.
    modeloPadrao: () => process.env.KILO_FALLBACK_MODEL || '',
    contextoPadrao: 'taskrunner',
    // menor que o dos tickets: quem espera codigo esta com pressa, e o
    // classificador roda em TODA mensagem — esperar 25s ali travaria o bot
    esperaMsPadrao: 12000,
    timeoutMsPadrao: 90000,
    // teto alto: o TaskRunner gera arquivo inteiro (landing page, script)
    maxTokensPadrao: 16000,
    // piso importante: o classificador pede max_tokens=5 e, sem piso,
    // o modelo de raciocinio gasta o orcamento todo e devolve vazio
    minTokensPadrao: 2000,
    reasoningEffortPadrao: 'none',
});
