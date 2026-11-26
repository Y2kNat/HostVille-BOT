const { EmbedBuilder, Colors, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const WarningManager = require('./WarningManager');
const StatsManager = require('./StatsManager');
const Features = require('./FeatureRegistry');
const { logError, logModeration, logInfo } = require('../utils/logger');

async function apply(message, foundWord, modResult) {
    const staffOuAdmin = isStaff(message.author.id) || isAdmin(message.member);
    let roastAtivo = process.env.PROFANITY_AI_ROAST === 'true';
    try { roastAtivo = Features.ligadoSync('roast', 'global'); } catch (e) {}

    logModeration('Palavras ofensivas detectadas', message.author, message.content, message.channel,
        `${foundWord || 'desconhecida'} [${modResult.category}/${modResult.severity} conf=${modResult.confidence} via=${modResult.aiStatus}]` +
        `${staffOuAdmin ? ' (staff/admin: SEM PUNICAO)' : ''}`);

    if (staffOuAdmin) return { punished: false, reason: 'staff' };
    if (roastAtivo) return { punished: false, reason: 'roast' };

    if (!Features.ligadoSync('punicao_auto', message.guild.id)) {
        logInfo(`[Features] punicao_auto desligada em ${message.guild.name}: aviso registrado, escada não aplicada`);
        return { punished: false, reason: 'punicao_auto_off' };
    }

    try {
        const permissions = message.channel.permissionsFor(message.client.user);
        if (!permissions || !permissions.has(PermissionFlagsBits.ManageMessages)) return { punished: false, reason: 'sem_permissoes' };
        if (!message.deletable) return { punished: false, reason: 'nao_deletavel' };

        message.client.__moderationDelete = { channel: message.channel.id, ts: Date.now() };
        await message.delete();
        StatsManager.incrementMessagesDeleted();
        await StatsManager.saveStats();

        const warnData = {
            reason: `Palavra ofensiva detectada: "${foundWord || 'desconhecida'}"`,
            moderator: message.client.user.id,
            guildId: message.guild.id,
            auto: true,
            timestamp: Date.now()
        };
        const warns = await WarningManager.addWarning(message.author.id, warnData);
        StatsManager.incrementWarns();
        await StatsManager.saveStats();

        const warningMsg = await message.channel.send({
            embeds: [new EmbedBuilder()
                .setTitle('🚫 Mensagem Removida - HostVille • BOT')
                .setDescription('Sua mensagem foi removida por conter palavras ofensivas.')
                .setColor(Colors.Red)
                .addFields(
                    { name: '👤 Usuário', value: message.author.toString(), inline: false },
                    { name: '🗓 Data', value: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), inline: false },
                    { name: '🚫 Palavra', value: `**${foundWord || 'desconhecida'}**`, inline: false },
                    { name: '⚠️ Avisos', value: `${warns.length}`, inline: false }
                )
                .setFooter({ text: 'Caso isso tenha sido um erro, contate a staff.' })
                .setTimestamp()
            ]
        });
        setTimeout(async () => { try { await warningMsg.delete(); } catch (e) {} }, 10000);

        const punishment = await WarningManager.checkAutoPunishment(message.member, message.guild.id);
        if (punishment) {
            const punishmentMsg = await message.channel.send(punishment);
            setTimeout(async () => { try { await punishmentMsg.delete(); } catch (e) {} }, 10000);
        }
        return { punished: true };
    } catch (err) {
        logError(`Erro ao moderar mensagem: ${err.message}`);
        return { punished: false, reason: 'erro', error: err.message };
    }
}

function isStaff(userId) {
    try { const { isStaff } = require('../utils/permissions'); return isStaff(userId); }
    catch (e) { return false; }
}
function isAdmin(member) {
    try { const { isAdmin } = require('../utils/permissions'); return isAdmin(member); }
    catch (e) { return false; }
}

module.exports = { apply };
