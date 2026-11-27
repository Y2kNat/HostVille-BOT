const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const WarnStore = require('../../utils/warnStore');
const { formatDate } = require('../../utils/formatters');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban-info')
        .setDescription('🔍 Mostra o estado de banimento de um usuário')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(opt => opt.setName('user').setDescription('Usuário (menção ou ID)').setRequired(true)),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });
        }
        await interaction.deferReply({ flags: 64 });

        const target = interaction.options.getUser('user');
        const guildId = interaction.guild.id;
        let inGuild = true;
        try { await interaction.guild.members.fetch(target.id); } catch { inGuild = false; }

        let ban = null;
        try { ban = await interaction.guild.bans.fetch(target.id); } catch (e) {
            if (e.code === 50013) return interaction.editReply({ content: '❌ Não tenho permissão para ver os banimentos.' });
        }

        const embed = new EmbedBuilder()
            .setColor(ban ? Colors.Red : Colors.Green)
            .setTitle(ban ? '🔨 Banido' : '✅ Não banido')
            .setThumbnail(target.displayAvatarURL())
            .addFields(
                { name: '👤 Usuário', value: `${target.tag}\n\`${target.id}\``, inline: true },
                { name: '🏠 No servidor', value: inGuild ? 'Sim' : 'Não (saiu ou nunca entrou)', inline: true },
                { name: '📊 Status', value: ban ? 'Banido' : 'Não banido', inline: true }
            );
        if (ban) embed.addFields(
            { name: '📝 Motivo', value: (ban.reason || 'Não informado').slice(0, 1024), inline: false },
            { name: '🕒 Quando', value: formatDate(ban.createdTimestamp || Date.now()), inline: true }
        );
        const warns = WarnStore.get(target.id, guildId);
        embed.addFields({ name: '⚠️ Avisos', value: warns.length ? `${warns.length} registro(s)` : 'Nenhum', inline: true });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`baninfo_detalhes:${target.id}`).setLabel('Ver detalhes').setEmoji('📋').setStyle(ButtonStyle.Secondary)
        );
        await interaction.editReply({ embeds: [embed], components: [row] });
    }
};