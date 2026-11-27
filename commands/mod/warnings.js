const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const WarningManager = require('../../managers/WarningManager');
const { isAdmin } = require('../../utils/permissions');
const { formatDate } = require('../../utils/formatters');
const StatsManager = require('../../managers/StatsManager');
const Paginator = require('../../utils/paginator');

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
        
        if (!warns.length) {
            return interaction.reply({ embeds: [new EmbedBuilder()
                .setTitle(`📋 Avisos de ${target.tag} - HostVille • BOT`)
                .setColor(Colors.Orange)
                .setDescription('✅ Nenhum aviso registrado.')], flags: 64 });
        }

        await interaction.deferReply({ flags: 64 });
        const paginador = Paginator.criar({
            itens: warns,
            porPagina: 5,
            buildEmbed: (pagina, indice, total) => {
                const embed = new EmbedBuilder()
                    .setTitle(`📋 Avisos de ${target.tag} - HostVille • BOT`)
                    .setColor(Colors.Orange)
                    .setFooter({ text: `Página ${indice + 1} de ${Math.ceil(total / 5)}` });
                pagina.forEach((w, i) => {
                    const quem = w.moderator ? `<@${w.moderator}>` : '⚠️ **staff não registrada**';
                    const como = w.auto ? '🤖 filtro automático' : '👤 staff';
                    const origem = w.legacy ? ' · servidor de origem desconhecido' : '';
                    embed.addFields({
                        name: `Aviso #${indice * 5 + i + 1} - ${formatDate(w.timestamp)}`,
                        value: `**Motivo:** ${w.reason}\n**Origem:** ${como} por ${quem}${origem}`,
                        inline: false
                    });
                });
                return embed;
            }
        });
        return Paginator.enviar(interaction, paginador, 'warn');
    }
};