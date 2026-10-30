const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const TicketManager = require('../../managers/TicketManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('🎓 Criar um ticket de atendimento para um usuário')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Usuário para abrir o atendimento')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('motivo')
                .setDescription('Motivo do atendimento')
                .setRequired(true)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('usuario');
        const motivo = interaction.options.getString('motivo');

        await interaction.deferReply({ flags: 64 });

        try {
            await TicketManager.createTicketForUser(interaction, targetUser, motivo);
        } catch (error) {
            console.error('Erro no /ticket:', error.message);
            return interaction.editReply({ content: '❌ Erro ao criar atendimento.' });
        }
    }
};