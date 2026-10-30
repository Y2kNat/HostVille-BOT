const crypto = require('crypto');
const config = require('../config');
const { logInfo } = require('./logger');
const { gate } = require('../managers/RateLimiter');

/**
 * Verificação do ACCESS_CODE — casa única para as duas portas que ele abre.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * O `handlers/dmCommands.js` já tinha a versão boa (B20): comparação em tempo
 * constante + rate limit. O `/adm` não usava — fazia `code !== config.ACCESS_CODE`
 * direto, sem limite de tentativas, o que é a mesma falha que o B20 fechou
 * na DM. Duas implementações do mesmo segredo é como uma delas fica velha.
 *
 * O caminho de slash não é coberto pelo anti-spam: o `messageCreate` faz
 * `return` no `isBotInputCommand()` do interactionCreate, então nenhuma
 * tentativa de senha passa pelo filtro de mensagem. Um código de 4 dígitos
 * são 10.000 combinações e nada segura.
 */

const ESCOPOS = {
    dm:  { gate: 'dm',  rotulo: 'DM' },
    adm: { gate: 'adm', rotulo: '/adm' }
};

/**
 * Compara duas senhas em tempo constante.
 *
 * `timingSafeEqual` exige mesmo tamanho, então o caso "tamanho diferente"
 * faria uma comparação de tamanho fixo (b vs b) antes de devolver false — sem
 * isso, o tempo da resposta revelaria o COMPRIMENTO do segredo, que é meio
 * do trabalho do atacante.
 *
 * @param {string} enviada
 * @param {string} [esperado]  padrão: config.ACCESS_CODE
 */
function comparaSenha(enviada, esperado = config.ACCESS_CODE) {
    const a = Buffer.from(String(enviada ?? ''), 'utf8');
    const b = Buffer.from(String(esperado ?? ''), 'utf8');
    if (a.length !== b.length) {
        crypto.timingSafeEqual(b, b);
        return false;
    }
    return crypto.timingSafeEqual(a, b);
}

/**
 * Portão de acesso.
 *
 * @param {string} userId
 * @param {string} senhaInformada
 * @param {'dm'|'adm'} [porta]
 * @param {object} [opts] { dica } texto de uso quando a senha veio vazia
 * @returns {null|string} null se passou, ou a mensagem de erro/aguardo
 */
function confereAcesso(userId, senhaInformada, porta = 'dm', opts = {}) {
    const cfg = ESCOPOS[porta] || ESCOPOS.dm;

    // Rate limit ANTES de comparar: quem está forçando tem que bater no
    // limite, e não no `!==`.
    const espera = gate(cfg.gate, userId);
    if (espera) return `⏳ Calma! Tente de novo ${espera}.`;

    if (!senhaInformada) return opts.dica || '❌ Informe o código de acesso.';
    if (!config.ACCESS_CODE) {
        logError_txt('ACCESS_CODE não está definido no .env — o painel está fechado para todo mundo.');
        return '❌ Painel indisponível: ACCESS_CODE ausente no servidor.';
    }
    if (!comparaSenha(senhaInformada)) {
        logInfo(`[${cfg.rotulo}] tentativa de acesso recusada (user=${userId})`);
        return '❌ Código de acesso incorreto!';
    }
    return null;
}

// logError_txt existe para não criar uma dependência de utils/logger que
// puxasse config de volta. Na prática logger -> config é só leitura, mas
// manter o require local evita o ciclo se algum dia o logger importar isto.
function logError_txt(m) {
    try { require('./logger').logError(m); } catch (e) { console.error(m); }
}

module.exports = { comparaSenha, confereAcesso };
