const StatsManager = require('../managers/StatsManager');
const { logMemberJoin, logMemberLeave, logInfo } = require('../utils/logger');

module.exports = [
    {
        name: 'guildMemberAdd',
        async execute(member) {
            StatsManager.incrementMembersJoined();
            await StatsManager.saveStats();
            logMemberJoin(member.user, member.guild);
            logInfo(`Novo membro: ${member.user.tag} (${member.guild.name})`);
        }
    },
    {
        name: 'guildMemberRemove',
        async execute(member) {
            StatsManager.incrementMembersLeft();
            await StatsManager.saveStats();
            logMemberLeave(member.user, member.guild);
            logInfo(`Membro saiu: ${member.user.tag} (${member.guild.name})`);
        }
    }
];