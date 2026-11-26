const TicketManager = require('../managers/TicketManager');
const AntiRaidManager = require('../managers/AntiRaidManager');
const HoneypotManager = require('../managers/HoneypotManager');

module.exports = {
    name: 'channelDelete',
    async execute(channel) {
        // Honeypot: se o canal-armadilha foi deletado, avisa a staff.
        try {
            await HoneypotManager.handleChannelDelete(channel);
        } catch (e) {
            console.error('Erro no channelDelete (honeypot):', e.message);
        }
        // Anti-Raid roda ANTES: conta o delete no executor e pode bani-lo.
        // Não depende do TicketManager e não pode derrubá-lo se falhar.
        try {
            await AntiRaidManager.handleChannelDelete(channel);
        } catch (e) {
            console.error('Erro no channelDelete (anti-raid):', e.message);
        }
        try {
            await TicketManager.handleChannelDeleted(channel);
        } catch (e) {
            console.error('Erro no channelDelete (ticket):', e.message);
        }
    }
};