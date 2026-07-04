const { EmbedBuilder, Colors } = require('discord.js');
const config = require('../config');
const { formatTime } = require('../utils/formatters');
const StatsManager = require('./StatsManager');

class ReportManager {
    static async generateDailyReport(client) {
        const stats = StatsManager.getStats();
        const now = new Date();
        const reportDate = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        
        const sortedCommands = Object.entries(stats.commandsUsed)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        
        let commandsField = "📊 **Comandos mais usados:**\n";
        if (sortedCommands.length > 0) {
            sortedCommands.forEach(([cmd, count]) => {
                commandsField += `• \`/${cmd}\`: ${count} vezes\n`;
            });
        } else {
            commandsField += "• Nenhum comando usado hoje";
        }
        
        const reportEmbed = new EmbedBuilder()
            .setTitle('📊 Relatório Diário - HostVille • BOT')
            .setDescription(`Período: **${reportDate}**`)
            .setColor(Colors.Blue)
            .addFields(
                { name: '🛡️ **Ações de Moderação**', value: `• Msgs deletadas: **${stats.messagesDeleted}**\n• Avisos dados: **${stats.warnsGiven}**`, inline: true },
                { name: '👥 **Movimentação**', value: `• Entraram: **${stats.membersJoined}**\n• Saíram: **${stats.membersLeft}**`, inline: true },
                { name: '📈 **Crescimento**', value: `**${stats.membersJoined - stats.membersLeft}** membros`, inline: true },
                { name: '🤖 **Status do Bot**', value: `• Uptime: **${formatTime(client.uptime)}**\n• Ping: **${client.ws.ping}ms**\n• Servidores: **${client.guilds.cache.size}**`, inline: false },
                { name: '📋 **Comandos**', value: commandsField, inline: false }
            )
            .setFooter({ 
                text: `HostVille • BOT - Relatório gerado automaticamente • ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}`,
                iconURL: client.user.displayAvatarURL()
            });

        return reportEmbed;
    }

    static async sendReport(client) {
        try {
            const reportEmbed = await this.generateDailyReport(client);
            
            for (const staffId of config.STAFF_USER_ID) {
                try {
                    const staffUser = await client.users.fetch(staffId);
                    if (staffUser) {
                        await staffUser.send({ content: '📬 **Relatório Diário - HostVille • BOT**', embeds: [reportEmbed] });
                    }
                } catch (err) {}
            }
            
            if (config.LOG_CHANNEL_ID) {
                const logChannel = await client.channels.fetch(config.LOG_CHANNEL_ID).catch(() => null);
                if (logChannel) {
                    await logChannel.send({ content: '📊 **Relatório Diário - HostVille • BOT**', embeds: [reportEmbed] });
                }
            }
            
            StatsManager.getStats().reset();
            await StatsManager.saveStats();
        } catch (error) {}
    }

    static scheduleDailyReport(client) {
        const now = new Date();
        const [reportHour, reportMinute] = config.DAILY_REPORT_TIME.split(':').map(Number);
        const nextReport = new Date(now);
        nextReport.setHours(reportHour, reportMinute, 0, 0);
        if (now > nextReport) nextReport.setDate(nextReport.getDate() + 1);
        
        setTimeout(() => {
            this.sendReport(client);
            setInterval(() => this.sendReport(client), 24 * 60 * 60 * 1000);
        }, nextReport - now);
    }
}

module.exports = ReportManager;