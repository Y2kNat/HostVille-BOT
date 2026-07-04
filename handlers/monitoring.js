const { EmbedBuilder, Colors, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const db = require('../database/db');
const { logError, logInfo } = require('../utils/logger');
const config = require('../config');

const pendingActions = new Map();

async function handleMonitorButtons(interaction) {
    await interaction.deferReply({ flags: 64 });
    
    try {
        const parts = interaction.customId.split('_');
        const action = parts[1];
        const state = parts[2];
        const isOn = state === 'on';
        const actionText = isOn ? 'ATIVAR' : 'DESATIVAR';
        
        if (action === 'all') {
            let count = 0;
            for (const [guildId] of interaction.client.guilds.cache) {
                await db.setMonitoringStatus(guildId, isOn);
                count++;
            }
            
            const embed = createStatusEmbed(null, state, interaction.user);
            embed.setDescription(`✅ Monitoramento ${isOn ? 'ativado' : 'desativado'} em **${count} servidores**!`);
            
            await interaction.editReply({ content: `✅ Operação concluída!`, embeds: [embed] });
            setTimeout(async () => { try { await interaction.deleteReply(); } catch (e) {} }, 10000);
            
        } else if (action === 'select') {
            const options = [];
            let count = 0;
            
            for (const [guildId, guild] of interaction.client.guilds.cache) {
                if (count >= 25) break;
                
                const status = await db.getMonitoringStatus(guildId) ? '🟢 ATIVO' : '🔴 INATIVO';
                options.push(
                    new StringSelectMenuOptionBuilder()
                        .setLabel(guild.name.substring(0, 100))
                        .setDescription(`${guild.memberCount} membros - ${status}`)
                        .setValue(guildId)
                        .setEmoji('🏛️')
                );
                count++;
            }
            
            if (interaction.client.guilds.cache.size > 25) {
                options.push(
                    new StringSelectMenuOptionBuilder()
                        .setLabel('📌 Mais servidores...')
                        .setDescription('Use o comando novamente para ver outros servidores')
                        .setValue('more')
                        .setEmoji('📌')
                );
            }
            
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`select_server_${state}`)
                .setPlaceholder('Selecione um servidor')
                .addOptions(options);
            
            const row = new ActionRowBuilder().addComponents(selectMenu);
            
            pendingActions.set(interaction.user.id, { action: state, messageId: interaction.id });
            
            await interaction.editReply({
                content: `🔍 **Selecione o servidor para ${actionText} o monitoramento:**`,
                components: [row]
            });
        }
    } catch (error) {
        logError(`Erro no handleMonitorButtons: ${error.message}`);
        await interaction.editReply({ content: '❌ Erro ao processar comando. Tente novamente.' });
        setTimeout(async () => { try { await interaction.deleteReply(); } catch (e) {} }, 5000);
    }
}

async function handleServerSelection(interaction) {
    await interaction.deferUpdate();
    
    try {
        const selectedValue = interaction.values[0];
        const customId = interaction.customId;
        const state = customId.split('_')[2];
        
        const pending = pendingActions.get(interaction.user.id);
        
        if (!pending) {
            await interaction.editReply({ content: '❌ Esta seleção expirou. Use o comando novamente.', components: [] });
            setTimeout(async () => { try { await interaction.deleteReply(); } catch (e) {} }, 5000);
            return;
        }
        
        const isOn = state === 'on';
        const actionText = isOn ? 'ATIVADO' : 'DESATIVADO';
        
        if (selectedValue === 'more') {
            await interaction.editReply({
                content: '📌 **Use o comando novamente para ver mais servidores.**\nDigite `!MonitorOn` ou `!MonitorOff` novamente.',
                components: []
            });
            setTimeout(async () => { try { await interaction.deleteReply(); } catch (e) {} }, 5000);
            pendingActions.delete(interaction.user.id);
            return;
        }
        
        const guild = interaction.client.guilds.cache.get(selectedValue);
        if (!guild) {
            await interaction.editReply({ content: '❌ Servidor não encontrado.', components: [] });
            setTimeout(async () => { try { await interaction.deleteReply(); } catch (e) {} }, 5000);
            pendingActions.delete(interaction.user.id);
            return;
        }
        
        await db.setMonitoringStatus(selectedValue, isOn);
        
        const embed = createStatusEmbed(guild, state, interaction.user);
        
        await interaction.editReply({
            content: `✅ **Monitoramento ${actionText} em ${guild.name}!**`,
            embeds: [embed],
            components: []
        });
        
        setTimeout(async () => { try { await interaction.deleteReply(); } catch (e) {} }, 10000);
        pendingActions.delete(interaction.user.id);
        
    } catch (error) {
        logError(`Erro no handleServerSelection: ${error.message}`);
        await interaction.editReply({ content: '❌ Erro ao processar seleção.', components: [] });
        setTimeout(async () => { try { await interaction.deleteReply(); } catch (e) {} }, 5000);
    }
}

function createStatusEmbed(guild, action, user) {
    const isActive = action === 'on';
    const color = isActive ? Colors.Green : Colors.Red;
    const statusText = isActive ? '🟢 **ATIVO**' : '🔴 **INATIVO**';
    
    const embed = new EmbedBuilder()
        .setTitle(`🛡️ Monitoramento ${isActive ? 'Ativado' : 'Desativado'} - HostVille • BOT`)
        .setColor(color)
        .addFields(
            { name: '🛡️ Status', value: statusText, inline: true },
            { name: '🛠 Staff', value: user.toString(), inline: true },
            { name: '🗓 Data', value: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), inline: false }
        )
        .setTimestamp();
    
    if (guild) embed.addFields({ name: '🏛️ Servidor', value: guild.name, inline: true });
    
    return embed;
}

module.exports = { handleMonitorButtons, handleServerSelection, pendingActions };