module.exports = {
    name: 'messageUpdate',
    async execute(oldMessage, newMessage) {
        if (!oldMessage.guild || !oldMessage.author) return;
        if (oldMessage.content === newMessage.content) return;
        
        console.log('\x1b[33m\x1b[40m\x1b[1m\n 📝 MENSAGEM ATUALIZADA \x1b[0m');
        console.log('\x1b[33m────────────────────────────────\x1b[0m');
        console.log(`\x1b[33m   Autor:     ${oldMessage.author.tag}\x1b[0m`);
        console.log(`\x1b[33m   Antigo:    ${oldMessage.content}\x1b[0m`);
        console.log(`\x1b[33m   Novo:      ${newMessage.content}\x1b[0m`);
        console.log(`\x1b[33m   Canal:     #${oldMessage.channel.name}\x1b[0m`);
        console.log('\x1b[33m────────────────────────────────\x1b[0m\n');
    }
};