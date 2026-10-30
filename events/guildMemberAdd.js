module.exports = {
    name: 'guildMemberAdd',
    async execute(member) {
        // Boas-vindas desativadas (WelcomeManager/welcomeData removidos)
        if (member.user.bot) return;
    }
};