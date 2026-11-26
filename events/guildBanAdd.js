const AntiRaidManager = require('../managers/AntiRaidManager');

/**
 * guildBanAdd — parte do anti-raid. Conta banimentos por executor (via audit
 * log) e pune ban em massa.
 */
module.exports = {
    name: 'guildBanAdd',
    async execute(guild, user) {
        try {
            await AntiRaidManager.handleGuildBanAdd(guild, user);
        } catch (e) {
            console.error('Erro no guildBanAdd (anti-raid):', e.message);
        }
    }
};