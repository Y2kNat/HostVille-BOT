const AntiRaidManager = require('../managers/AntiRaidManager');

/**
 * channelCreate — parte do anti-raid. Conta criação de canais por executor
 * (via audit log) e pune criação em massa. Não interfere em nenhum outro
 * fluxo de criação de canal do bot.
 */
module.exports = {
    name: 'channelCreate',
    async execute(channel) {
        try {
            await AntiRaidManager.handleChannelCreate(channel);
        } catch (e) {
            console.error('Erro no channelCreate (anti-raid):', e.message);
        }
    }
};