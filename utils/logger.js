const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

/**
 * Onde gravar.
 *
 * Testes e scripts de diagnostico partilham o mesmo codigo do bot, e sem
 * isto qualquer script de teste escrevia no logs/bot-DD-MM-AAAA.log de
 * verdade. Isso ja aconteceu: linhas de teste com usuarios ficticios
 * (u2st_*, u_e2e) apareceram no log do bot e fizeram o diagnostico do tier
 * ser lido errado duas vezes, porque nao dava para distinguir qual processo
 * escreveu a linha.
 *
 * Quem nao for o bot passa LOG_FILE=teste.log e grava separado. Sem a
 * variavel o comportamento e o de sempre.
 */
const ARQUIVO_TESTE = String(process.env.LOG_FILE || '').trim();

function getLogFile() {
    if (ARQUIVO_TESTE) {
        return path.isAbsolute(ARQUIVO_TESTE)
            ? ARQUIVO_TESTE
            : path.join(logDir, ARQUIVO_TESTE);
    }
    const day = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).replace(/\//g, '-');
    return path.join(logDir, `bot-${day}.log`);
}

function persist(level, message) {
    const clean = String(message).replace(/\u001b\[[0-9;]*m/g, '');
    const ts = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    try {
        fs.appendFileSync(getLogFile(), `[${ts}] ${level}: ${clean}\n`);
    } catch (e) {}
}

function getTimestamp() {
    return chalk.gray(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}]`);
}

function logInfo(message) {
    console.log(`${getTimestamp()} ${chalk.green('➜ INFO')}: ${chalk.cyan(message)}`);
    persist('INFO', message);
}

function logError(message) {
    console.log(`${getTimestamp()} ${chalk.red('✖ ERRO')}: ${chalk.yellow(message)}`);
    persist('ERRO', message);
}

function logWarn(message) {
    console.log(`${getTimestamp()} ${chalk.yellow('⚠ AVISO')}: ${chalk.white(message)}`);
    persist('AVISO', message);
}

function logSuccess(message) {
    console.log(`${getTimestamp()} ${chalk.green('SUCESSO')}: ${chalk.white(message)}`);
    persist('SUCESSO', message);
}

function logModeration(message, user, content, channel, foundWord) {
    console.log(chalk.red.bgBlack.bold('\n 🛡️ MENSAGEM MODERADA '));
    console.log(chalk.red('────────────────────────────────'));
    console.log(chalk.red(`   Usuário:   ${user.tag}`));
    console.log(chalk.red(`   ID:        ${user.id}`));
    console.log(chalk.red(`   Conteúdo:  ${content}`));
    console.log(chalk.red(`   Palavra:   "${foundWord}"`));
    console.log(chalk.red(`   Canal:     #${channel.name}`));
    console.log(chalk.red(`   Motivo:    ${message}`));
    console.log(chalk.red('────────────────────────────────\n'));
    persist('MODERAÇÃO', `Usuário: ${user.tag} | Conteúdo: ${content} | Palavra: "${foundWord}" | Motivo: ${message}`);
}

function logMemberJoin(user, guild) {
    console.log(chalk.green.bgBlack.bold('\n 👤 NOVO MEMBRO '));
    console.log(chalk.green('────────────────────────────────'));
    console.log(chalk.green(`   Usuário:  ${user.tag}`));
    console.log(chalk.green(`   ID:       ${user.id}`));
    console.log(chalk.green(`   Servidor: ${guild.name}`));
    console.log(chalk.green(`   Data:     ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`));
    console.log(chalk.green('────────────────────────────────\n'));
    persist('ENTRADA', `Usuário: ${user.tag} | Servidor: ${guild.name}`);
}

function logMemberLeave(user, guild) {
    console.log(chalk.red.bgBlack.bold('\n ❌ MEMBRO SAIU '));
    console.log(chalk.red('────────────────────────────────'));
    console.log(chalk.red(`   Usuário:  ${user.tag}`));
    console.log(chalk.red(`   Servidor: ${guild.name}`));
    console.log(chalk.red(`   Data:     ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`));
    console.log(chalk.red('────────────────────────────────\n'));
    persist('SAÍDA', `Usuário: ${user.tag} | Servidor: ${guild.name}`);
}

const Logger = {
    info: logInfo,
    error: logError,
    warn: logWarn,
    success: logSuccess,
    moderation: logModeration,
    memberJoin: logMemberJoin,
    memberLeave: logMemberLeave
};

module.exports = { logInfo, logError, logWarn, logSuccess, logModeration, logMemberJoin, logMemberLeave, Logger };