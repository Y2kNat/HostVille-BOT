const { SlashCommandBuilder } = require('discord.js');
const WarningManager = require('../../managers/WarningManager');
const { isAdmin } = require('../../utils/permissions');
const StatsManager = require('../../managers/StatsManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clearwarns')
        .setDescription('🗑️ Remove todos os avisos de um usuário')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Usuário para limpar os avisos')
                .setRequired(true)),
    
    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });
        }
        
        const target = interaction.options.getUser('user');
        await WarningManager.clearWarnings(target.id);
        StatsManager.trackCommand('clearwarns');
        
        await interaction.reply({
            content: `✅ Avisos de ${target.tag} removidos com sucesso.`,
            flags: 64
        });
    }
};