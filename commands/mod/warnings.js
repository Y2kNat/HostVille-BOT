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
        const warns = await WarningManager.getWarnings(target.id, interaction.guild.id);
        StatsManager.trackCommand('warnings');
        
        const embed = new EmbedBuilder()
            .setTitle(`📋 Avisos de ${target.tag} - HostVille • BOT`)
            .setColor(Colors.Orange);

        if (warns.length === 0) {
            embed.setDescription('✅ Nenhum aviso registrado.');
        } else {
            // Discord aceita no máximo 25 campos por embed. Com a escada
            // indo a 30 avisos, um usuário no degrau do banimento estouraria
            // o limite e o comando quebraria — ou seja, exatamente no
            // momento em que a staff mais precisa ver o histórico.
            const LIMITE = 24;
            const shown = warns.slice(0, LIMITE);
            shown.forEach((w, i) => {
                const quem = w.moderator ? `<@${w.moderator}>` : '⚠️ **staff não registrada**';
                const como = w.auto ? '🤖 filtro automático' : '👤 staff';
                const origem = w.legacy ? ' · servidor de origem desconhecido' : '';
                embed.addFields({
                    name: `Aviso #${i + 1} - ${formatDate(w.timestamp)}`,
                    value: `**Motivo:** ${w.reason}\n**Origem:** ${como} por ${quem}${origem}`,
                    inline: false
                });
            });
            if (warns.length > LIMITE) {
                embed.setFooter({
                    text: `Mostrando ${LIMITE} de ${warns.length} avisos. Os mais antigos não cabem no embed.`
                });
            }
        }
        
        await interaction.reply({ embeds: [embed], flags: 64 });
    }
};