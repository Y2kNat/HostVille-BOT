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

        // Escopo por guild: antes, um admin do servidor B apagava o
        // histórico de punição do servidor A, que é onde a decisão tem
        // efeito. Aviso limpo num servidor não pode apagar o do outro.
        // Avisos legados ('unknown') continuam em todos os servidores — são
        // infrações reais de origem desconhecida, e apagar them daria reset.
        await WarningManager.clearWarnings(target.id, interaction.guild.id);
        StatsManager.trackCommand('clearwarns');

        await interaction.reply({
            content: `✅ Avisos de ${target.tag} neste servidor removidos com sucesso.`,
            flags: 64
        });
    }
};