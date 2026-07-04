const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const StatsManager = require('../../managers/StatsManager');
const { logInfo } = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('👢 Expulsa um membro do servidor')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Usuário a ser expulso')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Motivo da expulsão')
                .setRequired(false)),
    
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
            return interaction.reply({ content: '❌ Sem permissão para expulsar membros.', flags: 64 });
        }
        
        const target = interaction.options.getMember('user');
        const reason = interaction.options.getString('reason') || 'Sem motivo especificado';
        
        if (!target) {
            return interaction.reply({ content: '❌ Usuário não encontrado.', flags: 64 });
        }
        
        try {
            await target.kick(`Expulso por ${interaction.user.tag} - ${reason} (HostVille • BOT)`);
            StatsManager.trackCommand('kick');
            
            await interaction.reply({
                content: `👢 ${target.user.tag} foi expulso.\n**Motivo:** ${reason}`,
                flags: 64
            });
            
            logInfo(`Kick: ${interaction.user.tag} expulsou ${target.user.tag} - Motivo: ${reason}`);
        } catch (err) {
            await interaction.reply({ content: `❌ Erro ao expulsar: ${err.message}`, flags: 64 });
        }
    }
};