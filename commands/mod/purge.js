const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const StatsManager = require('../../managers/StatsManager');
const { logInfo } = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('🗑️ Apaga mensagens do canal')
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Quantidade (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)),
    
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });
        }
        
        const amount = interaction.options.getInteger('amount');
        
        try {
            await interaction.channel.bulkDelete(amount, true);
            StatsManager.incrementMessagesDeleted(amount);
            await StatsManager.saveStats();
            StatsManager.trackCommand('purge');
            
            await interaction.reply({
                content: `✅ ${amount} mensagens apagadas.`,
                flags: 64
            });
            
            logInfo(`Purge: ${interaction.user.tag} apagou ${amount} mensagens em #${interaction.channel.name}`);
        } catch (err) {
            await interaction.reply({ content: `❌ Erro: ${err.message}`, flags: 64 });
        }
    }
};