const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const AutoInteraction = require('../../managers/AutoInteraction');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autointeraction')
        .setDescription('Liga/desliga as interações automáticas do bot')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('status')
                .setDescription('ON ou OFF')
                .setRequired(true)
                .addChoices(
                    { name: 'ON (ligar)', value: 'on' },
                    { name: 'OFF (desligar)', value: 'off' }
                )),
    
    async execute(interaction) {
        const status = interaction.options.getString('status');
        const enabled = status === 'on';
        
        await AutoInteraction.setAutoInteraction(interaction.guild.id, enabled);
        
        const embed = new EmbedBuilder()
            .setTitle(enabled ? '✅ Auto-Interação LIGADA' : '🔇 Auto-Interação DESLIGADA')
            .setDescription(enabled 
                ? 'O bot vai mandar mensagens automáticas a cada 20 minutos.' 
                : 'O bot NÃO vai mais mandar mensagens automáticas.')
            .setColor(enabled ? 0x00FF00 : 0xFF0000)
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
