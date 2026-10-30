const { SlashCommandBuilder, PermissionFlagsBits, Routes } = require('discord.js');
const TicketManager = require('../../managers/TicketManager');
const db = require('../../database/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('adicionar')
        .setDescription('Adicionar um usuário ao ticket atual')
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Usuário que terá acesso ao ticket')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('tipo')
                .setDescription('Tipo de acesso (1 = ver e ler, 2 = ver, ler e escrever)')
                .setMinValue(1)
                .setMaxValue(2))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        const channel = interaction.channel;
        const targetUser = interaction.options.getUser('usuario');
        const tipo = interaction.options.getInteger('tipo') || 2;

        if (!channel.name.startsWith('🎫・')) {
            return interaction.reply({
                content: '❌ Este comando só pode ser usado em canais de ticket!',
                flags: 64
            });
        }

        await interaction.deferReply({ flags: 64 });

        try {
            const membreFrom = await channel.guild.members.fetch(targetUser.id).catch(() => null);
            if (!membreFrom) {
                return interaction.editReply({ content: '❌ Usuário não está no servidor.' });
            }

            const allowBits = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, ...(tipo === 2 ? [PermissionFlagsBits.SendMessages] : [])].reduce((a, b) => a | b, 0n);

            await interaction.client.rest.put(
                Routes.channelPermission(channel.id, targetUser.id),
                { body: { id: targetUser.id, type: 1, allow: allowBits.toString(), deny: '0' } }
            );

            const freshChannel = await channel.guild.channels.fetch(channel.id, { force: true });
            const perm = freshChannel.permissionsFor(membreFrom);
            const canView = perm?.has(PermissionFlagsBits.ViewChannel) === true;
            const canRead = perm?.has(PermissionFlagsBits.ReadMessageHistory) === true;
            const canSend = tipo !== 2 || perm?.has(PermissionFlagsBits.SendMessages) === true;

            if (!canView || !canRead || !canSend) {
                return interaction.editReply({
                    content: '❌ Não consegui confirmar a permissão no canal. Tenta de novo ou chama um staff.'
                });
            }

            const pessoa = targetUser.username || targetUser.tag;
            await interaction.editReply({ content: `**${pessoa}** pode ver e ${tipo === 2 ? '**escrever**' : '**ler**'} no ticket agora!` });

            try {
                await channel.send({ content: `${targetUser} foi adicionado ao atendimento por ${interaction.user}.` });
            } catch (e) {}

            const ticket = await db.getTicket(channel.id);
            const { sendLog } = require('../../utils/realtime');
            sendLog('➕ ' + pessoa + ' adicionado ao ticket #' + String(ticket?.number || '?').padStart(4, '0') + ' por ' + interaction.user.tag, 'info', 'tickets');
        } catch (error) {
            console.error('Erro ao adicionar usuário:', error.message);
            await interaction.editReply({ content: '❌ Erro ao adicionar usuário: ' + error.message });
        }
    }
};
