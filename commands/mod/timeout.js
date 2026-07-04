const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const StatsManager = require('../../managers/StatsManager');
const { logInfo } = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('🔇 Silencia um usuário temporariamente')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Usuário a ser silenciado')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('minutes')
                .setDescription('Minutos (1-40320)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(40320))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Motivo')
                .setRequired(false)),
    
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });
        }
        
        const target = interaction.options.getMember('user');
        const minutes = interaction.options.getInteger('minutes');
        const reason = interaction.options.getString('reason') || 'Sem motivo especificado';
        
        if (!target) {
            return interaction.reply({ content: '❌ Usuário não encontrado.', flags: 64 });
        }
        
        const ms = minutes * 60 * 1000;
        
        try {
            await target.timeout(ms, `Silenciado por ${interaction.user.tag} - ${reason} (HostVille • BOT)`);
            StatsManager.trackCommand('timeout');
            
            await interaction.reply({
                content: `🔇 ${target.user.tag} foi silenciado por ${minutes} minutos.\n**Motivo:** ${reason}`,
                flags: 64
            });
            
            logInfo(`Timeout: ${interaction.user.tag} silenciou ${target.user.tag} por ${minutes}m`);
        } catch (err) {
            await interaction.reply({ content: `❌ Erro: ${err.message}`, flags: 64 });
        }
    }
};