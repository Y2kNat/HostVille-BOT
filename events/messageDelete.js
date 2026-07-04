const { logError } = require('../utils/logger');

module.exports = {
    name: 'messageDelete',
    async execute(message) {
        if (!message.guild || !message.author) return;
        
        let deleter = 'Desconhecido';
        try {
            const auditLogs = await message.guild.fetchAuditLogs({ type: 72, limit: 1 });
            const entry = auditLogs.entries.first();
            if (entry && entry.target.id === message.author.id && entry.createdTimestamp > Date.now() - 5000) {
                deleter = entry.executor.tag;
            }
        } catch (e) {}
        
        console.log('\x1b[31m\x1b[40m\x1b[1m\n 🗑️ MENSAGEM DELETADA \x1b[0m');
        console.log('\x1b[31m────────────────────────────────\x1b[0m');
        console.log(`\x1b[31m   Autor:     ${message.author.tag}\x1b[0m`);
        console.log(`\x1b[31m   Conteúdo: ${message.content || '[sem texto]'}\x1b[0m`);
        console.log(`\x1b[31m   Deletado:  ${deleter}\x1b[0m`);
        console.log(`\x1b[31m   Canal:     #${message.channel.name}\x1b[0m`);
        console.log(`\x1b[31m   Servidor:  ${message.guild.name}\x1b[0m`);
        console.log('\x1b[31m────────────────────────────────\x1b[0m\n');
    }
};