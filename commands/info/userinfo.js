const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const StatsManager = require('../../managers/StatsManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('👤 Informações de um usuário')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Usuário')
                .setRequired(false)),
    
    async execute(interaction) {
        StatsManager.trackCommand('userinfo');
        
        const member = interaction.options.getMember('user') || interaction.member;
        const user = member.user;
        
        const roles = member.roles.cache
            .filter(r => r.id !== interaction.guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => r.toString())
            .join(', ') || 'Nenhum';
        
        const embed = new EmbedBuilder()
            .setTitle(`👤 ${user.tag} - HostVille • BOT`)
            .setThumbnail(user.displayAvatarURL())
            .addFields(
                { name: '🆔 ID', value: user.id, inline: true },
                { name: '📅 Entrou no servidor', value: member.joinedAt.toLocaleDateString('pt-BR'), inline: true },
                { name: '🔹 Conta criada', value: user.createdAt.toLocaleDateString('pt-BR'), inline: true },
                { name: '🔰 Cargos', value: roles, inline: false }
            )
            .setColor(member.displayColor || Colors.Blue)
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
    }
};