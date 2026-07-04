const WelcomeManager = require('../managers/WelcomeManager');

module.exports = {
    name: 'guildMemberAdd',
    async execute(member) {
        // Ignorar bots
        if (member.user.bot) return;

        // Enviar boas-vindas interativas
        await WelcomeManager.sendWelcome(member);
    }
};
