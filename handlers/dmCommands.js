const { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const db = require('../database/db');
const { logInfo, logError } = require('../utils/logger');
const crypto = require('crypto');
const { gate } = require('../managers/RateLimiter');
// A comparação em tempo constante e o portão de tentativas saíram daqui para
// utils/accessCode.js: o `/adm` defendia o MESMO segredo com `!==` e sem
// limite, e duas cópias de um primitivo de segurança é como uma delas fica
// velha. Reexportados porque o resto do arquivo (e o teste B20) os usa.
const { comparaSenha, confereAcesso: confereAcessoBase } = require('../utils/accessCode');

/**
 * B20 — verificação do código de acesso.
 *
 * Três coisas erradas na versão anterior:
 *   1. `!==` sai no primeiro dígito diferente. Medir o tempo da resposta
 *      revela o resto da senha dígito a dígito. `timingSafeEqual` sempre
 *      compara os dois lados inteiros.
 *   2. Não havia limite de tentativas. O painel inteiro depende deste
 *      número, e o caminho de DM não é coberto por nenhum filtro: o
 *      anti-spam só roda depois do `return` da linha 82 do messageCreate.
 *      Um código de 4 dígitos é 10.000 tentativas, e o filtro de spam nunca
 *      viu nenhuma delas.
 *   3. O erro não distinguia "não mandou nada" de "mandou errado", o que
 *      não importa para segurança mas importa para o log.
 *
 * O valor do ACCESS_CODE não é tratado aqui: isso é configuração, vive no
 * .env. O que este módulo garante é que o caminho de brute force tem
 * janela fechada e comparação constante.
 *
 * A implementação mora em utils/accessCode.js — ver o require no topo. Este
 * wrapper só troca o texto da dica, que é específico da DM.
 */

/**
 * Portão de acesso do painel de DM. Devolve null se passou, ou a string de
 * aguardo/erro.
 */
function confereAcesso(userId, senhaInformada) {
    return confereAcessoBase(userId, senhaInformada, 'dm', {
        dica: '❌ Use: `!MonitorOn ACCESS_CODE`'
    });
}

async function handleDMMessage(message) {
    // !MonitorOn
    if (message.content.startsWith('!MonitorOn')) {
        const args = message.content.split(' ');
        const senha = args[1];

        const recusa = confereAcesso(message.author.id, senha);
        if (recusa) {
            await message.reply(recusa);
            await apagaDepois(message, recusa);
            return;
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`monitor_all_on:${message.author.id}`).setLabel('Todos os Servidores ⚠️').setStyle(ButtonStyle.Success).setEmoji('🌐'),
            new ButtonBuilder().setCustomId(`monitor_select_on:${message.author.id}`).setLabel('Selecionar um Servidor').setStyle(ButtonStyle.Primary).setEmoji('🔍')
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
        const senha = args[1];

        const recusa = confereAcesso(message.author.id, senha);
        if (recusa) {
            await message.reply(recusa);
            await apagaDepois(message, recusa);
            return;
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`monitor_all_off:${message.author.id}`).setLabel('Todos os Servidores ⚠️').setStyle(ButtonStyle.Danger).setEmoji('🌐'),
            new ButtonBuilder().setCustomId(`monitor_select_off:${message.author.id}`).setLabel('Selecionar um Servidor').setStyle(ButtonStyle.Primary).setEmoji('🔍')
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
        const senha = args[1];

        const recusa = confereAcesso(message.author.id, senha);
        if (recusa) {
            await message.reply(recusa === '❌ Use: `!MonitorOn ACCESS_CODE`'
                ? '❌ Use: `!clearAll ACCESS_CODE`'
                : recusa);
            await apagaDepois(message, 'erro');
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
    //
    // B20 (achado novo, não estava em nenhum dos documentos): este comando
    // NÃO pedia senha nenhuma e apagava TODAS as mensagens da DM — não só as
    // do bot. Qualquer pessoa que conseguisse mandar DM ao bot disparava.
    // O `!clearAll`, que varre todas as DMs do bot, exigia senha; este, que
    // é menor no escopo, não exigia.
    if (message.content.startsWith('!clear')) {
        const args = message.content.split(' ');
        const senha = args[1];

        const recusa = confereAcesso(message.author.id, senha);
        if (recusa) {
            await message.reply(recusa === '❌ Use: `!MonitorOn ACCESS_CODE`'
                ? '❌ Use: `!clear ACCESS_CODE`'
                : recusa);
            await apagaDepois(message, 'erro');
            return;
        }

        try { await message.delete(); } catch (e) {}

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('confirm_clear').setLabel('✅ Sim, limpar mensagens do bot').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('cancel_clear').setLabel('❌ Não, ignorar').setStyle(ButtonStyle.Secondary)
        );

        const confirmMsg = await message.channel.send({
            content: '⚠️ **HostVille • BOT - Apagar as mensagens do BOT nesta conversa?**',
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
                        // Só o que o BOT escreveu. Antes, esta linha não
                        // filtrava nada: a DM é do usuário, mas a resposta
                        // do bot é o que existe para apagar, e apagar a
                        // mensagem do usuário seria uma decisão que o
                        // comando não promete.
                        const deletableMessages = fetchedMessages.filter(
                            msg => msg.author.id === message.client.user.id
                        );
                        if (deletableMessages.size === 0) break;
                        for (const [id, msg] of deletableMessages) {
                            try { await msg.delete(); deletedCount++; await new Promise(resolve => setTimeout(resolve, 500)); } catch (e) {}
                        }
                    } while (fetchedMessages.size >= 100);

                    await interaction.editReply({ content: `✅ **${deletedCount} mensagens do bot limpas! - HostVille • BOT**`, components: [] });
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

/** Apaga a mensagem de erro e a do usuário depois de um tempo. */
async function apagaDepois(message, marca) {
    setTimeout(async () => {
        try {
            const msgs = await message.channel.messages.fetch({ limit: 4 });
            for (const msg of msgs.values()) {
                if (msg.author.id === message.client.user.id) await msg.delete();
            }
            if (marca === 'erro') await message.delete();
        } catch (e) {}
    }, 5000);
}

module.exports = { handleDMMessage, confereAcesso, comparaSenha };