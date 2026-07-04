const { SlashCommandBuilder, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../config');
const StatsManager = require('../../managers/StatsManager');
const { logInfo } = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('adm')
        .setDescription('🔐 Painel administrativo - HostVille • BOT')
        .addStringOption(option =>
            option.setName('code')
                .setDescription('Senha de acesso administrativo')
                .setRequired(true)),
    
    async execute(interaction) {
        const code = interaction.options.getString('code');
        
        if (code !== config.ACCESS_CODE) {
            return interaction.reply({ content: '❌ Código de acesso incorreto!', flags: 64 });
        }
        
        StatsManager.trackCommand('adm');
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('stats').setLabel('📊 Estatísticas').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('console').setLabel('🖥️ Ver no Console').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('help').setLabel('❓ Ajuda').setStyle(ButtonStyle.Success)
        );

        const embed = new EmbedBuilder()
            .setTitle('🔐 Painel Administrativo - HostVille • BOT')
            .setDescription('Bem-vindo ao painel de controle do bot!')
            .setColor(Colors.Blue)
            .addFields(
                { name: '👤 Usuário', value: interaction.user.tag, inline: true },
                { name: '🆔 ID', value: interaction.user.id, inline: true }
            )
            .setFooter({ text: 'Use os botões abaixo para acessar as funcionalidades' })
            .setTimestamp();

        await interaction.reply({ content: 'Painel Administrativo:', embeds: [embed], components: [row], flags: 64 });
        logInfo(`/adm usado por ${interaction.user.tag}`);
    }
};