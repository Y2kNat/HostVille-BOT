const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../../database/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket-config')
        .setDescription('🔗 Conectar este servidor (principal) ao servidor da staff')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt =>
            opt.setName('id-servidor-staff')
                .setDescription('ID do servidor onde a staff recebe as dúvidas')
                .setRequired(true))
        .addStringOption(opt =>
            opt.setName('id-canal-staff')
                .setDescription('ID do canal no servidor da staff')
                .setRequired(true))
        .addRoleOption(opt =>
            opt.setName('cargo-staff')
                .setDescription('Cargo de staff no servidor principal')
                .setRequired(true))
        .addChannelOption(opt =>
            opt.setName('canal-logs')
                .setDescription('Canal de logs (transcrições)')
                .setRequired(false))
        .addIntegerOption(opt =>
            opt.setName('max-tickets')
                .setDescription('Máximo de tickets por usuário (padrão: 2)')
                .setMinValue(1)
                .setMaxValue(5)
                .setRequired(false)),

    async execute(interaction) {
        const staffGuildId = interaction.options.getString('id-servidor-staff');
        const staffChannelId = interaction.options.getString('id-canal-staff');
        const staffRole = interaction.options.getRole('cargo-staff');
        const logChannel = interaction.options.getChannel('canal-logs');
        const maxTickets = interaction.options.getInteger('max-tickets') || 2;

        const communityGuildId = interaction.guild.id;
        const communityGuildName = interaction.guild.name;

        const staffGuild = interaction.client.guilds.cache.get(staffGuildId);
        if (!staffGuild) {
            return interaction.reply({
                content: `❌ Servidor staff \`${staffGuildId}\` não encontrado. O bot está nesse servidor?`,
                ephemeral: true
            });
        }

        db.saveConnection(communityGuildId, {
            communityGuildId,
            communityGuildName,
            staffGuildId,
            staffGuildName: staffGuild.name,
            staffChannelId,
            staffRoleId: staffRole.id,
            logChannelId: logChannel?.id || null,
            maxTicketsPerUser: maxTickets,
            createdAt: Date.now()
        });

        db.setStaffConfig(staffGuildId, {
            isStaffServer: true,
            communityGuildId,
            communityGuildName,
            staffChannelId
        });

        const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('🔗 Conexão Estabelecida')
            .setDescription('Os dois servidores estão conectados!')
            .addFields(
                { name: '🏠 Servidor Principal', value: `${communityGuildName}\n\`${communityGuildId}\``, inline: true },
                { name: '🏢 Servidor Staff', value: `${staffGuild.name}\n\`${staffGuildId}\``, inline: true },
                { name: '📨 Canal Staff', value: `<#${staffChannelId}>`, inline: true },
                { name: '👥 Cargo Staff', value: `${staffRole.name}`, inline: true },
                { name: '📊 Canal Logs', value: logChannel ? `${logChannel}` : '❌ Não configurado', inline: true },
                { name: '🔢 Max Tickets', value: `${maxTickets} por usuário`, inline: true }
            )
            .setFooter({ text: 'Agora use /ticket-setup para criar os painéis' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });

        try {
            const staffChannel = staffGuild.channels.cache.get(staffChannelId);
            if (staffChannel) {
                const staffEmbed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('🔗 Conexão Recebida')
                    .setDescription(`Este canal agora receberá dúvidas não respondidas de **${communityGuildName}**.`)
                    .addFields(
                        { name: '🏠 Servidor', value: communityGuildName, inline: true },
                        { name: '🆔 ID', value: communityGuildId, inline: true }
                    )
                    .setFooter({ text: 'Use o botão "Sugerir Resposta" para ensinar o bot' })
                    .setTimestamp();
                await staffChannel.send({ embeds: [staffEmbed] });
            }
        } catch (error) {
            console.log('Não foi possível enviar confirmação no servidor staff');
        }
    }
};