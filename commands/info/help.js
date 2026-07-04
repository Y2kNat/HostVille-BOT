const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const StatsManager = require('../../managers/StatsManager');
const { logInfo } = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('❓ Mostra a lista de comandos disponíveis'),
    
    async execute(interaction) {
        StatsManager.trackCommand('help');
        
        const embed = new EmbedBuilder()
            .setTitle('❓ Comandos Disponíveis - HostVille • BOT')
            .setDescription('Lista de comandos que você pode usar no bot:')
            .setColor(Colors.Blue)
            .addFields(
                { name: '🛡️ Moderação', value: '`/warn` `/warnings` `/clearwarns` `/kick` `/ban` `/timeout` `/purge`', inline: false },
                { name: '🔧 Configuração', value: '`/filter` `/linksettings`', inline: false },
                { name: '📊 Informações', value: '`/ping` `/help` `/adm` `/avatar` `/serverinfo` `/userinfo`', inline: false },
                { name: '📨 Comunicação', value: '`/private` `/report`', inline: false }
            )
            .setFooter({ text: 'Comandos de texto na DM: !clear !clearAll !MonitorOn !MonitorOff' })
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed], flags: 64 });
        logInfo(`Comando /help usado por ${interaction.user.tag}`);
    }
};