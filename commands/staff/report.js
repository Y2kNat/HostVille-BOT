const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config');
const ReportManager = require('../../managers/ReportManager');
const StatsManager = require('../../managers/StatsManager');
const { logInfo, logError } = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('📊 Gerar relatório manual (Staff)')
        .addStringOption(option =>
            option.setName('code')
                .setDescription('Código de acesso')
                .setRequired(true)),
    
    async execute(interaction) {
        const code = interaction.options.getString('code');
        
        if (code !== config.ACCESS_CODE) {
            return interaction.reply({ content: '❌ Código de acesso incorreto!', flags: 64 });
        }
        
        StatsManager.trackCommand('report');
        
        await interaction.reply({ content: '🔄 Gerando relatório...', flags: 64 });
        
        const reportEmbed = await ReportManager.generateDailyReport(interaction.client);
        
        let successCount = 0;
        let failCount = 0;
        
        for (const staffId of config.STAFF_USER_ID) {
            try {
                const staffUser = await interaction.client.users.fetch(staffId);
                if (staffUser) {
                    await staffUser.send({ content: '📊 **Relatório Manual - HostVille • BOT**', embeds: [reportEmbed] });
                    successCount++;
                    logInfo(`📊 Relatório manual enviado para ${staffUser.tag}`);
                }
            } catch (err) {
                failCount++;
                logError(`Erro ao enviar relatório manual para ${staffId}: ${err.message}`);
            }
        }
        
        if (config.LOG_CHANNEL_ID) {
            const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID).catch(() => null);
            if (logChannel) await logChannel.send({ content: '📊 **Relatório Manual - HostVille • BOT**', embeds: [reportEmbed] });
        }
        
        await interaction.followUp({
            content: `✅ Relatório gerado e enviado para **${successCount} staff(s)**${failCount > 0 ? ` (${failCount} falhas)` : ''}`,
            flags: 64
        });
        
        logInfo(`${interaction.user.tag} gerou relatório manual (enviado para ${successCount} staffs)`);
    }
};