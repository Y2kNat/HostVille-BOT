const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const WarningManager = require('../../managers/WarningManager');
const StatsManager = require('../../managers/StatsManager');
const { isAdmin } = require('../../utils/permissions');
const { logInfo } = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('⚠️ Aplica um aviso a um membro')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Usuário a ser avisado')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Motivo do aviso')
                .setRequired(true)),
    
    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: '❌ Sem permissão para usar este comando.', flags: 64 });
        }
        
        const target = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        const member = interaction.guild.members.cache.get(target.id);
        
        const warnData = {
            reason,
            moderator: interaction.user.id,
            timestamp: Date.now()
        };
        
        const warns = await WarningManager.addWarning(target.id, warnData);
        StatsManager.incrementWarns();
        await StatsManager.saveStats();
        StatsManager.trackCommand('warn');
        
        const embed = new EmbedBuilder()
            .setTitle('⚠️ Aviso Aplicado - HostVille • BOT')
            .setColor(Colors.Orange)
            .addFields(
                { name: '👤 Usuário', value: target.tag, inline: true },
                { name: '📝 Motivo', value: reason, inline: true },
                { name: '🔢 Total de Avisos', value: `${warns.length}`, inline: true },
                { name: '🛠 Staff', value: interaction.user.tag, inline: true }
            )
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed], flags: 64 });
        
        if (member) {
            const punishment = await WarningManager.checkAutoPunishment(member);
            if (punishment) {
                await interaction.followUp({ content: punishment, flags: 64 });
            }
        }
        
        logInfo(`/warn usado por ${interaction.user.tag} em ${target.tag} - Motivo: ${reason}`);
    }
};