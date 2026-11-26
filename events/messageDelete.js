const deletedStore = require('../utils/deletedStore');
const MessageCache = require('../utils/messageCache');

function descrever(msg) {
    const partes = [];
    const texto = String(msg.content || '').trim();
    if (texto) partes.push(texto);
    for (const att of (msg.attachments || [])) {
        partes.push(`[arquivo: ${att.name || 'sem nome'}] ${att.url || ''}`.trim());
    }
    return partes.length ? partes.join(' | ') : '[sem texto]';
}

module.exports = {
    name: 'messageDelete',
    async execute(message) {
        if (!message.guild) return;

        const cached = MessageCache.get(message.id);
        let msg = message;
        if (cached) {
            msg = {
                ...message,
                author: message.author || (cached.authorId ? { id: cached.authorId, tag: cached.authorTag } : null),
                content: cached.content || message.content,
                attachments: (cached.attachments && cached.attachments.length) ? cached.attachments : (message.attachments || []),
                embeds: (cached.embeds && cached.embeds.length) ? cached.embeds : (message.embeds || [])
            };
        } else {
            try {
                if (!message.author || !message.content) msg = await message.fetch();
            } catch (e) {}
        }

        const author = msg.author || { tag: 'Desconhecido', id: '?' };
        const marca = message.client && message.client.__moderationDelete;
        const isModeration = !!(marca && marca.channel === message.channel.id && (Date.now() - marca.ts) < 10000);

        let deleter = 'Desconhecido';
        if (isModeration) {
            deleter = 'HostVille • BOT (moderação)';
        } else {
            try {
                const auditLogs = await message.guild.fetchAuditLogs({ type: 72, limit: 5 });
                const recent = auditLogs.entries.filter(e => e.createdTimestamp > Date.now() - 10000);
                const entry = recent.find(e => !e.target || e.target.id === msg.id || e.target.id === author.id) || recent[0];
                if (entry && entry.executor) deleter = entry.executor.tag;
            } catch (e) {}
        }

        const conteudo = descrever(msg);
        if (conteudo === '[sem texto]') {
            if (isModeration) message.client.__moderationDelete = null;
            return;
        }
        const anexos = (msg.attachments || []).map(a => ({ name: a.name, url: a.url }));
        const embeds = (msg.embeds || []).length;

        deletedStore.add({
            guildId: message.guild.id,
            guildName: message.guild.name,
            channelId: message.channel.id,
            channelName: message.channel.name || '?',
            authorId: author.id,
            authorTag: author.tag,
            content: conteudo,
            attachments: anexos,
            embeds,
            deleter,
            source: isModeration ? 'moderacao' : 'manual',
            palavra: isModeration ? (marca.foundWord || '') : '',
            severidade: isModeration ? (marca.severity || '') : '',
            categoria: isModeration ? (marca.category || '') : ''
        });

        if (isModeration) {
            message.client.__moderationDelete = null;
            return;
        }
        if (!message.author) return;

        console.log('\x1b[31m\x1b[40m\x1b[1m\n 🗑️ MENSAGEM DELETADA \x1b[0m');
        console.log('\x1b[31m────────────────────────────────\x1b[0m');
        console.log(`\x1b[31m   Autor:     ${author.tag}\x1b[0m`);
        console.log(`\x1b[31m   Conteúdo: ${conteudo}\x1b[0m`);
        console.log(`\x1b[31m   Deletado:  ${deleter}\x1b[0m`);
        console.log(`\x1b[31m   Canal:     #${message.channel.name}\x1b[0m`);
        console.log(`\x1b[31m   Servidor:  ${message.guild.name}\x1b[0m`);
        console.log('\x1b[31m────────────────────────────────\x1b[0m\n');
    }
};