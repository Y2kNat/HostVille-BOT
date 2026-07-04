const { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const db = require('../database/db');
const { logInfo, logError } = require('../utils/logger');

async function handleDMMessage(message) {
    // !MonitorOn
    if (message.content.startsWith('!MonitorOn')) {
        const args = message.content.split(' ');
        const password = args[1];
        
        if (!password || password !== config.ACCESS_CODE) {
            const errorMsg = await message.reply(password ? '❌ Código de acesso incorreto!' : '❌ Use: `!MonitorOn ACCESS_CODE`');
            setTimeout(async () => {
                try {
                    const msgs = await message.channel.messages.fetch({ limit: 2 });
                    for (const msg of msgs.values()) {
                        if (msg.author.id === message.client.user.id) await msg.delete();
                    }
                } catch (e) {}
            }, 5000);
            return;
        }
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('monitor_all_on').setLabel('Todos os Servidores ⚠️').setStyle(ButtonStyle.Success).setEmoji('🌐'),
            new ButtonBuilder().setCustomId('monitor_select_on').setLabel('Selecionar um Servidor').setStyle(ButtonStyle.Primary).setEmoji('🔍')
        );
        
        const reply = await message.reply({
            content: '🛡️ **HostVille • BOT - Escolha uma opção para ATIVAR o monitoramento:**',
            components: [row]
        });
        
        setTimeout(async () => { try { await message.delete(); await reply.delete(); } catch (e) {} }, 120000);
        return;
    }
    
    // !MonitorOff
    if (message.content.startsWith('!MonitorOff')) {
        const args = message.content.split(' ');
        const password = args[1];
        
        if (!password || password !== config.ACCESS_CODE) {
            const errorMsg = await message.reply(password ? '❌ Código de acesso incorreto!' : '❌ Use: `!MonitorOff ACCESS_CODE`');
            setTimeout(async () => {
                try {
                    const msgs = await message.channel.messages.fetch({ limit: 2 });
                    for (const msg of msgs.values()) {
                        if (msg.author.id === message.client.user.id) await msg.delete();
                    }
                } catch (e) {}
            }, 5000);
            return;
        }
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('monitor_all_off').setLabel('Todos os Servidores ⚠️').setStyle(ButtonStyle.Danger).setEmoji('🌐'),
            new ButtonBuilder().setCustomId('monitor_select_off').setLabel('Selecionar um Servidor').setStyle(ButtonStyle.Primary).setEmoji('🔍')
        );
        
        const reply = await message.reply({
            content: '🛡️ **HostVille • BOT - Escolha uma opção para DESATIVAR o monitoramento:**',
            components: [row]
        });
        
        setTimeout(async () => { try { await message.delete(); await reply.delete(); } catch (e) {} }, 120000);
        return;
    }
    
    // !clearAll
    if (message.content.startsWith('!clearAll')) {
        const args = message.content.split(' ');
        const password = args[1];
        
        if (!password || password !== config.ACCESS_CODE) {
            const errorMsg = await message.reply(password ? '❌ Código de acesso incorreto!' : '❌ Use: `!clearAll SUA_SENHA`');
            setTimeout(async () => { try { await message.delete(); await errorMsg.delete(); } catch (e) {} }, 5000);
            return;
        }
        
        try { await message.delete(); } catch (e) {}
        
        const processingMsg = await message.channel.send('🔄 Limpando mensagens de TODAS as DMs...');
        
        let totalDeleted = 0;
        let totalChannels = 0;
        
        for (const [channelId, channel] of message.client.channels.cache) {
            if (channel.type === ChannelType.DM) {
                totalChannels++;
                try {
                    let fetchedMessages;
                    do {
                        fetchedMessages = await channel.messages.fetch({ limit: 100 });
                        if (fetchedMessages.size === 0) break;
                        const deletableMessages = fetchedMessages.filter(msg => msg.author.id === message.client.user.id);
                        if (deletableMessages.size === 0) break;
                        for (const [id, msg] of deletableMessages) {
                            try { await msg.delete(); totalDeleted++; await new Promise(resolve => setTimeout(resolve, 500)); } catch (err) {}
                        }
                    } while (fetchedMessages.size >= 100);
                    logInfo(`Limpou mensagens do bot na DM com ${channel.recipient ? channel.recipient.tag : 'desconhecido'}`);
                } catch (err) { logError(`Erro ao processar DM ${channelId}: ${err.message}`); }
            }
        }
        
        await processingMsg.edit(`✅ **${totalDeleted} mensagens** do bot foram limpas de **${totalChannels} DMs**!`);
        setTimeout(async () => { try { await processingMsg.delete(); } catch (e) {} }, 10000);
        logInfo(`${message.author.tag} limpou ${totalDeleted} mensagens de todas as DMs`);
        return;
    }
    
    // !clear
    if (message.content.startsWith('!clear')) {
        try { await message.delete(); } catch (e) {}
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('confirm_clear').setLabel('✅ Sim, limpar mensagens').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('cancel_clear').setLabel('❌ Não, ignorar').setStyle(ButtonStyle.Secondary)
        );
        
        const confirmMsg = await message.channel.send({
            content: '⚠️ **HostVille • BOT - Tem certeza que deseja limpar todas as mensagens desta DM?**',
            components: [row]
        });
        
        const filter = (interaction) => interaction.user.id === message.author.id;
        const collector = confirmMsg.createMessageComponentCollector({ filter, time: 60000, max: 1 });
        
        collector.on('collect', async (interaction) => {
            if (interaction.customId === 'confirm_clear') {
                await interaction.update({ content: '🔄 Limpando mensagens...', components: [] });
                
                let deletedCount = 0;
                try {
                    let fetchedMessages;
                    do {
                        fetchedMessages = await message.channel.messages.fetch({ limit: 100 });
                        if (fetchedMessages.size === 0) break;
                        const deletableMessages = fetchedMessages.filter(msg => msg.id !== confirmMsg.id);
                        if (deletableMessages.size === 0) break;
                        for (const [id, msg] of deletableMessages) {
                            try { await msg.delete(); deletedCount++; await new Promise(resolve => setTimeout(resolve, 500)); } catch (err) {}
                        }
                    } while (fetchedMessages.size >= 100);
                    
                    await interaction.editReply({ content: `✅ **${deletedCount} mensagens limpas! - HostVille • BOT**`, components: [] });
                    setTimeout(async () => { try { await confirmMsg.delete(); } catch (e) {} }, 5000);
                    logInfo(`${message.author.tag} limpou ${deletedCount} mensagens na DM`);
                } catch (error) {
                    logError(`Erro ao limpar DM: ${error.message}`);
                    await interaction.editReply({ content: '❌ Erro ao limpar mensagens.', components: [] });
                    setTimeout(async () => { try { await confirmMsg.delete(); } catch (e) {} }, 5000);
                }
            } else {
                await interaction.update({ content: '❌ Operação cancelada.', components: [] });
                setTimeout(async () => { try { await confirmMsg.delete(); } catch (e) {} }, 3000);
            }
        });
        
        collector.on('end', async (collected) => {
            if (collected.size === 0) {
                try {
                    await confirmMsg.edit({ content: '⏰ Tempo esgotado. Operação cancelada.', components: [] });
                    setTimeout(async () => { try { await confirmMsg.delete(); } catch (e) {} }, 3000);
                } catch (error) {}
            }
        });
        return;
    }
    
    // Resposta automática para outras mensagens na DM
    try {
        const reply = await message.reply({
            content: `❌ **Não é possível enviar esta mensagem.**\nCaso tenha algo para falar, entre em contato com <@${config.OWNER_ID}>\n\n🛡️ **HostVille • BOT**`
        });
        setTimeout(async () => { try { await reply.delete(); } catch (e) {} }, 10000);
        logInfo(`Mensagem automática enviada para ${message.author.tag} na DM`);
    } catch (error) {
        logError(`Erro ao responder DM: ${error.message}`);
    }
}

module.exports = { handleDMMessage };