const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { iniciar } = require('../../handlers/setupWizard');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('⚙️ Configuração guiada do servidor')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });
        }
        await interaction.reply({ ...iniciar(interaction.user.id), flags: 64 });
    }
};