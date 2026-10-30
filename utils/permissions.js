/**
 * Permissões: quem é staff e quem é admin.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * B28 — isStaff é GLOBAL, por design. Isto está documentado aqui porque
 * antes não estava em lugar nenhum, e "não está documentado" é o que
 * faz um comportamento parecer bug.
 *
 * O que é
 * `isStaff(userId)` consulta `config.STAFF_USER_ID`, uma lista de IDs que
 * não tem guild. Medido: 8 IDs, e `isStaff(STAFF_USER_ID[0])` é `true` em
 * QUALQUER servidor onde o bot esteja. Não há guild no argumento nem na
 * consulta.
 *
 * Efeito
 * Quem é staff no servidor A ganha bypass de anti-spam e anti-link também
 * no servidor B, onde não tem cargo nenhum. A lista é da REDE do bot, não
 * de um servidor: se ele está em 40 servidores, os 8 IDs têm o mesmo bypass
 * nos 40.
 *
 * DECISÃO: isso é intencional. Staff de rede é o modelo do projeto — o dono
 * opera o bot em vários servidores da mesma comunidade, e o bypass de spam
 * para o dono da rede é o que evita o dono tomar mute no próprio bot.
 *
 * O QUE ISSO NÃO É
 * isStaff NÃO dá acesso a nada deestructive. Ela só pula anti-spam e
 * anti-link. As ações destrutivas (mutar, banir, limpar, broadcast,
 * RESPONDER_CANAL) passam por `canModerate`/`canPublish`, que checam dono,
 * cargo de admin e permissão do Discord — e essas checam por guild.
 *
 * Para mudar: derivar de cargo, como isAdmin faz, e passar a ser
 * `isStaff(member)`. Não é uma troca de uma linha: 3 call sites.
 * ─────────────────────────────────────────────────────────────────────────
 */

const config = require('../config');

/**
 * Staff da REDE: bypass de anti-spam e anti-link em qualquer servidor.
 *
 * @param {string} userId
 * @returns {boolean}
 *
 * NÃO concede acesso a ação destrutiva nenhuma. Ver o cabeçalho.
 */
function isStaff(userId) {
    if (!userId) return false;
    return Array.isArray(config.STAFF_USER_ID) && config.STAFF_USER_ID.includes(userId);
}

/**
 * Admin de UM servidor: cargo na lista de admin.
 *
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 *
 * B28: o caminho por NOME de cargo (`ADMIN_ROLES.includes(role.name)`) é
 * perigoso e hoje está INERTE — `ADMIN_ROLES` só tem IDs numéricos. Se o
 * dono colocar um NOME no .env, qualquer cargo com aquele nome vira admin,
 * e o nome é o mesmo em todos os servidores da rede. Um ID é específico do
 * servidor; um nome é global.
 *
 * Por isso o nome foi REMOVIDO e não apenas documentado: a configuração
 * perigosa fica impossível de montar por engano.
 */
function isAdmin(member) {
    if (!member) return false;
    if (!Array.isArray(config.ADMIN_ROLES) || config.ADMIN_ROLES.length === 0) return false;
    const ids = config.ADMIN_ROLES.filter(r => typeof r === 'string' && /^\d+$/.test(r));
    if (ids.length === 0) return false;
    return member.roles.cache.some(role => ids.includes(role.id));
}

function hasPermission(member, permission) {
    if (!member) return false;
    return member.permissions.has(permission);
}

module.exports = { isStaff, isAdmin, hasPermission };
