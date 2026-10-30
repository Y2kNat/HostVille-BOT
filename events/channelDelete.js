const TicketManager = require('../managers/TicketManager');

module.exports = {
    name: 'channelDelete',
    async execute(channel) {
        try {
            await TicketManager.handleChannelDeleted(channel);
        } catch (e) {
            console.error('Erro no channelDelete (ticket):', e.message);
        }
    }
};