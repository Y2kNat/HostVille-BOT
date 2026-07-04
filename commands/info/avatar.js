const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const StatsManager = require('../../managers/StatsManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('avatar')
        .setDescription('🖼️ Mostra o avatar de um usuário')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Usuário')
                .setRequired(false)),
    
    async execute(interaction) {
        StatsManager.trackCommand('avatar');
        
        const user = interaction.options.getUser('user') || interaction.user;
        
        const embed = new EmbedBuilder()
            .setTitle(`🖼️ Avatar de ${user.tag}`)
            .setImage(user.displayAvatarURL({ dynamic: true, size: 4096 }))
            .setColor(Colors.Blue)
            .setFooter({ text: 'HostVille • BOT' });
        
        await interaction.reply({ embeds: [embed] });
    }
};