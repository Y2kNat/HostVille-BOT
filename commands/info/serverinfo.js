const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const StatsManager = require('../../managers/StatsManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('🏛️ Informações do servidor'),
    
    async execute(interaction) {
        StatsManager.trackCommand('serverinfo');
        
        const guild = interaction.guild;
        
        const embed = new EmbedBuilder()
            .setTitle(`🏛️ ${guild.name} - HostVille • BOT`)
            .setThumbnail(guild.iconURL())
            .addFields(
                { name: '👑 Dono', value: `<@${guild.ownerId}>`, inline: true },
                { name: '👥 Membros', value: `${guild.memberCount}`, inline: true },
                { name: '📅 Criado em', value: guild.createdAt.toLocaleDateString('pt-BR'), inline: true },
                { name: '💬 Canais', value: `${guild.channels.cache.size}`, inline: true },
                { name: '🔰 Cargos', value: `${guild.roles.cache.size}`, inline: true }
            )
            .setColor(Colors.Blue)
            .setFooter({ text: `ID: ${guild.id}` })
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
    }
};