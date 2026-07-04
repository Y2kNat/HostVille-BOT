const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config');
const StatsManager = require('../../managers/StatsManager');
const { logInfo, logError } = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('private')
        .setDescription('📨 Enviar mensagem da staff')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Usuário que receberá a mensagem')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('message')
                .setDescription('Mensagem a ser enviada')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('code')
                .setDescription('Código de acesso')
                .setRequired(true)),
    
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const message = interaction.options.getString('message');
        const code = interaction.options.getString('code');
        
        if (code !== config.ACCESS_CODE) {
            return interaction.reply({ content: '❌ Código de acesso incorreto!', flags: 64 });
        }
        
        StatsManager.trackCommand('private');
        
        try {
            await interaction.channel.send(`🛠 **Mensagem da Staff - HostVille • BOT** 🛠\n\n${user}\n\n${message}`);
            await user.send({ content: `📬 **Mensagem da Staff - HostVille • BOT**\n\n${message}` });
            
            await interaction.reply({
                content: `✅ Mensagem enviada\n\nPara ${user}\n\nMensagem enviada:\n${message}`,
                flags: 64
            });
            
            logInfo(`${interaction.user.tag} enviou mensagem para ${user.tag}`);
        } catch (error) {
            await interaction.reply({
                content: '❌ Erro ao enviar a mensagem. Verifique se o usuário tem DMs abertos.',
                flags: 64
            });
            logError(`Erro ao enviar mensagem privada: ${error.message}`);
        }
    }
};