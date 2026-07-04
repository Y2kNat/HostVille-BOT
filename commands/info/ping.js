const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const StatsManager = require('../../managers/StatsManager');
const { logInfo } = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('🏓 Verifica a latência do bot'),
    
    async execute(interaction) {
        StatsManager.trackCommand('ping');
        
        const embed = new EmbedBuilder()
            .setTitle('🏓 Ping - HostVille • BOT')
            .setColor(Colors.Green)
            .addFields(
                { name: '📡 Latência', value: `${interaction.client.ws.ping}ms`, inline: true },
                { name: '⏱️ Uptime', value: `${Math.floor(interaction.client.uptime / 1000)}s`, inline: true }
            )
            .setFooter({ text: 'HostVille • BOT está funcionando corretamente!' })
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed], flags: 64 });
        logInfo(`Comando /ping usado por ${interaction.user.tag}`);
    }
};