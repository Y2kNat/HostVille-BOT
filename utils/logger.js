const chalk = require('chalk');

function getTimestamp() {
    return chalk.gray(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}]`);
}

function logInfo(message) {
    console.log(`${getTimestamp()} ${chalk.green('➜ INFO')}: ${chalk.cyan(message)}`);
}

function logError(message) {
    console.log(`${getTimestamp()} ${chalk.red('✖ ERRO')}: ${chalk.yellow(message)}`);
}

function logWarn(message) {
    console.log(`${getTimestamp()} ${chalk.yellow('⚠ AVISO')}: ${chalk.white(message)}`);
}

function logSuccess(message) {
    console.log(`${getTimestamp()} ${chalk.green('✔ SUCESSO')}: ${chalk.white(message)}`);
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
}

function logMemberJoin(user, guild) {
    console.log(chalk.green.bgBlack.bold('\n 👤 NOVO MEMBRO '));
    console.log(chalk.green('────────────────────────────────'));
    console.log(chalk.green(`   Usuário:  ${user.tag}`));
    console.log(chalk.green(`   ID:       ${user.id}`));
    console.log(chalk.green(`   Servidor: ${guild.name}`));
    console.log(chalk.green(`   Data:     ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`));
    console.log(chalk.green('────────────────────────────────\n'));
}

function logMemberLeave(user, guild) {
    console.log(chalk.red.bgBlack.bold('\n ❌ MEMBRO SAIU '));
    console.log(chalk.red('────────────────────────────────'));
    console.log(chalk.red(`   Usuário:  ${user.tag}`));
    console.log(chalk.red(`   Servidor: ${guild.name}`));
    console.log(chalk.red(`   Data:     ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`));
    console.log(chalk.red('────────────────────────────────\n'));
}

module.exports = { logInfo, logError, logWarn, logSuccess, logModeration, logMemberJoin, logMemberLeave };