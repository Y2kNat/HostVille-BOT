const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const WarningManager = require('../../managers/WarningManager');
const { isAdmin } = require('../../utils/permissions');
const { formatDate } = require('../../utils/formatters');
const StatsManager = require('../../managers/StatsManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warnings')
        .setDescription('📋 Ver avisos de um usuário')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Usuário para ver os avisos')
                .setRequired(true)),
    
    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });
        }
        
        const target = interaction.options.getUser('user');
        const warns = await WarningManager.getWarnings(target.id);
        StatsManager.trackCommand('warnings');
        
        const embed = new EmbedBuilder()
            .setTitle(`📋 Avisos de ${target.tag} - HostVille • BOT`)
            .setColor(Colors.Orange);
        
        if (warns.length === 0) {
            embed.setDescription('✅ Nenhum aviso registrado.');
        } else {
            warns.forEach((w, i) => {
                embed.addFields({
                    name: `Aviso #${i + 1} - ${formatDate(w.timestamp)}`,
                    value: `**Motivo:** ${w.reason}\n**Staff:** <@${w.moderator}>`,
                    inline: false
                });
            });
        }
        
        await interaction.reply({ embeds: [embed], flags: 64 });
    }
};