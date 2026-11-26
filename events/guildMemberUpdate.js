const AntiRaidManager = require('../managers/AntiRaidManager');

/**
 * guildMemberUpdate — parte do anti-raid.
 *
 * Rastreia quando um membro ganha ou perde um cargo presente em ADMIN_ROLES.
 * Isso alimenta a whitelist: um admin legítimo (cargo há >= 1 dia) não é
 * banido por engano num raid, e um admin recém-cunhado (cargo há segundos)
 * não recebe passe livre.
 */
module.exports = {
    name: 'guildMemberUpdate',
    async execute(oldMember, newMember) {
        try {
            AntiRaidManager.onMemberUpdate(oldMember, newMember);
        } catch (e) {
            console.error('Erro no guildMemberUpdate (anti-raid):', e.message);
        }
    }
};