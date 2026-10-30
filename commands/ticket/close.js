const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const TicketManager = require('../../managers/TicketManager');
const db = require('../../database/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription('Fecha o ticket do canal atual')
        .addStringOption(option =>
            option.setName('motivo')
                .setDescription('Motivo do fechamento (obrigatório)')
                .setRequired(true)
                .setMinLength(5)
                .setMaxLength(500)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        const channel = interaction.channel;
        const motivo = (interaction.options.getString('motivo') || '').trim();

        if (motivo.length < 3) {
            return interaction.reply({
                content: '❌ Informe o motivo do fechamento.',
                flags: 64
            });
        }

        // vale tanto pelo nome do canal quanto pelo registro no banco: um
        // ticket válido não pode ser rejeitado só por causa do prefixo
        const ticket = await db.getTicket(channel.id);
        if (!ticket && !channel.name.startsWith('🎫・')) {
            return interaction.reply({
                content: '❌ Este comando só pode ser usado em canais de ticket!',
                flags: 64
            });
        }

        await interaction.deferReply();

        try {
            // Fecha o ticket usando o TicketManager
            await TicketManager.closeTicket(channel, interaction.user, motivo);

            // Notifica o site para deletar do MongoDB
            try {
                await fetch('https://hostcenter.vercel.app/api/tickets/fechar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        channelId: channel.id,
                        motivo: motivo,
                        closedBy: interaction.user.tag
                    })
                });
            } catch (e) {
                console.error('Erro ao notificar site:', e.message);
            }

            await interaction.editReply({
                content: '🗑️ **Ticket Fechado!**\n📝 Motivo: **' + motivo + '**\n👤 Fechado por: **' + interaction.user.tag + '**'
            });

        } catch (error) {
            console.error('Erro ao fechar ticket:', error.message);
            await interaction.editReply({
                content: '❌ Erro ao fechar ticket: ' + error.message
            });
        }
    }
};