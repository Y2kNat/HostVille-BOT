const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const StatsManager = require('../../managers/StatsManager');
const { logInfo } = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('🔨 Bane um usuário do servidor')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Usuário a ser banido')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Motivo do banimento')
                .setRequired(false)),
    
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return interaction.reply({ content: '❌ Sem permissão para banir membros.', flags: 64 });
        }
        
        const target = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'Sem motivo especificado';
        
        try {
            await interaction.guild.members.ban(target, {
                reason: `Banido por ${interaction.user.tag} - ${reason} (HostVille • BOT)`
            });
            StatsManager.trackCommand('ban');
            
            await interaction.reply({
                content: `🔨 ${target.tag} foi banido.\n**Motivo:** ${reason}`,
                flags: 64
            });
            
            logInfo(`Ban: ${interaction.user.tag} baniu ${target.tag} - Motivo: ${reason}`);
        } catch (err) {
            await interaction.reply({ content: `❌ Erro ao banir: ${err.message}`, flags: 64 });
        }
    }
};