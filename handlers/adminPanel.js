const { EmbedBuilder, Colors } = require('discord.js');
const { logInfo } = require('../utils/logger');

async function handleButtonInteraction(interaction) {
    const client = interaction.client;
    
    switch (interaction.customId) {
        case 'stats': {
            const uptimeSeconds = Math.floor(client.uptime / 1000);
            const hours = Math.floor(uptimeSeconds / 3600);
            const minutes = Math.floor((uptimeSeconds % 3600) / 60);
            const seconds = uptimeSeconds % 60;

            const embed = new EmbedBuilder()
                .setTitle('📊 Estatísticas - HostVille • BOT')
                .setColor(Colors.Green)
                .addFields(
                    { name: '🏓 Ping', value: `${client.ws.ping}ms`, inline: true },
                    { name: '⏱️ Uptime', value: `${hours}h ${minutes}m ${seconds}s`, inline: true },
                    { name: '🏛️ Servidores', value: `${client.guilds.cache.size}`, inline: true },
                    { name: '👥 Usuários', value: `${client.users.cache.size}`, inline: true }
                )
                .setFooter({ text: 'HostVille • BOT - Estatísticas atualizadas' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed], flags: 64 });
            logInfo(`${interaction.user.tag} abriu estatísticas`);
            setTimeout(async () => { try { await interaction.deleteReply(); } catch (e) {} }, 15000);
            break;
        }

        case 'console': {
            console.log('\n═══ 📊 ESTATÍSTICAS - HostVille • BOT ═══');
            console.log(`🏓 Ping:    ${client.ws.ping}ms`);
            console.log(`⏱️  Uptime:  ${Math.floor(client.uptime / 3600000)}h`);
            console.log(`🏛️  Servers: ${client.guilds.cache.size}`);
            console.log(`👥 Users:   ${client.users.cache.size}`);
            console.log('═══════════════════════════════════\n');
            
            await interaction.reply({ content: '✅ Verifique o console!', flags: 64 });
            setTimeout(async () => { try { await interaction.deleteReply(); } catch (e) {} }, 5000);
            break;
        }

        case 'help': {
            const embed = new EmbedBuilder()
                .setTitle('❓ Ajuda - Painel Administrativo - HostVille • BOT')
                .setDescription('Como usar o painel administrativo:')
                .setColor(Colors.Blue)
                .addFields(
                    { name: '📊 Estatísticas', value: 'Clique em "Estatísticas" para ver dados do bot', inline: false },
                    { name: '🖥️ Console', value: 'Clique em "Ver no Console" para ver dados no terminal', inline: false },
                    { name: '🔐 Segurança', value: 'Use o comando /adm com a senha correta', inline: false }
                )
                .setFooter({ text: 'HostVille • BOT - Painel Administrativo' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed], flags: 64 });
            logInfo(`${interaction.user.tag} pediu ajuda no painel`);
            setTimeout(async () => { try { await interaction.deleteReply(); } catch (e) {} }, 15000);
            break;
        }

        default:
            await interaction.reply({ content: '❌ Botão desconhecido!', flags: 64 });
            setTimeout(async () => { try { await interaction.deleteReply(); } catch (e) {} }, 5000);
    }
}

module.exports = { handleButtonInteraction };