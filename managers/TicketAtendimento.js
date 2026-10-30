const { EmbedBuilder } = require('discord.js');
const db = require('../database/db');
const kilo = require('./KiloClient');
const { loadingText } = require('../utils/emojis');
const { replyOrEdit } = require('../utils/messages');
const { cliente: clienteIA } = require('../utils/TicketIA');
const { antiInventionBlock, responseRules } = require('../utils/kbPrompt');
const { generateValidated, isGiveUp } = require('../ai/ResponseValidator');
const { buildTicketContext, rememberTurn, checkInjection } = require('../utils/ticketContext');

const FALLBACK_ROLE_ID = '1542509842701226017';

class TicketAtendimento {

    static async start(channel, user, guildId) {
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🎓 Ticket de Atendimento')
            .setDescription(`Beleza, ${user.username}! 👋\n\nEste atendimento foi aberto para você.\nPode perguntar o que quiser que eu te ajudo!`)
            .setFooter({ text: 'Respondo automaticamente. Se eu não souber, um cargo responsável te responde.' });

        await channel.send({ embeds: [embed] });
    }

    static async process(message, session) {
        const msg = message.content;

        session.step = 1;
        session.question = msg;

        // Mensagem "Pensando..." que será editada com a resposta (se falhar, responde direto)
        let thinking = null;
        try { thinking = await message.channel.send(loadingText(message.client)); }
        catch (e) { console.error('❌ Pensando (atendimento):', e.message); }

        try {
            const knowledge = await db.getKnowledge(session.guildId);
            let knowledgeText = '';
            for (const [id, entry] of Object.entries(knowledge)) {
                knowledgeText += `- "${entry.keywords.join(', ')}" → "${entry.response}"\n`;
            }

            // Guard de prompt injection (modelo dedicado no gateway Kilo)
            const guard = await checkInjection(msg);
            if (guard.blocked) {
                await message.channel.send(require('./InjectionGuard').BLOQUEIO).catch(() => {});
                return;
            }

            const ctx = buildTicketContext(message.channel.id, msg, message.author.id);
            if (ctx.rateLimited) {
                await message.channel.send(`⏳ Espera ${ctx.retryAfter} antes de mandar outra mensagem aqui.`).catch(() => {});
                return;
            }
            const { context: kbContext, docs, history, intentHint, resolvedQuestion } = ctx;

            const systemPrompt = `Você é o HostBot atendendo ${message.author.username} em um ticket de atendimento.
${history ? `\nHISTÓRICO DESTE ATENDIMENTO (use só para entender do que a pergunta fala, inclusive perguntas indiretas como "e meus carros?"):\n${history}\n` : ''}
${intentHint ? `\n${intentHint}\n` : ''}
${kbContext ? `\nCONHECIMENTO DA BASE (${docs.join(', ')}):\n${kbContext}\n` : ''}
CONHECIMENTO ADICIONAL (database local da guild):
${knowledgeText || '(vazio)'}

INSTRUÇÕES:
- Responda usando SOMENTE o CONHECIMENTO acima, com os detalhes reais (valores, canais, comandos).
- NUNCA copie o texto do CONHECIMENTO. Resuma com suas próprias palavras.
- Responda EXATAMENTE o que foi perguntado: um erro → só a solução; um comando → o comando + o que ele faz.
- Se o usuário fala como quem JÁ tem o item (ex.: "minha propriedade", "já registrei"), NÃO repita o tutorial do começo.
- Se a informação NÃO existir no conhecimento, responda exatamente:
  "Não tenho essa informação no momento. O cargo <@&${FALLBACK_ROLE_ID}> vai responder sua pergunta!"
- Nunca invente respostas.

${responseRules()}

${antiInventionBlock()}`;

            const response = await generateValidated(clienteIA, {
                contexto: 'atendimento',
                systemPrompt,
                userMessage: resolvedQuestion,
                docs,
                context: kbContext,
                extraSource: knowledgeText,
                optionOverrides: { temperature: 0.3, max_tokens: 220 }
            });

                        const fallbackPhrase = 'Não tenho essa informação no momento';
            if (response && !response.includes(fallbackPhrase) && !isGiveUp(response)) {
                await replyOrEdit(thinking, message.channel, {
                    content: '',
                    embeds: [
                        new EmbedBuilder().setColor(0x5865F2).setDescription(response).addFields({ name: '\u200b', value: 'Resposta gerada por IA, caso seja um erro, contate <@1438102316271014008>' })
                    ]
                });
                rememberTurn(message.channel.id, message.author.username, msg, response);
            } else {
                await replyOrEdit(thinking, message.channel, { content: `🤔 Não consegui confirmar essa informação com confiança. <@&${FALLBACK_ROLE_ID}> vai responder! 🦾`, embeds: [] });
                const { logWarn } = require('../utils/logger');
                logWarn(`🎫 Ticket sem resposta válida | pergunta="${String(msg).slice(0, 80)}" | por=${message.author.tag}`);
                try {
                    const conn = await db.getConnection(session.guildId);
                    if (conn?.staffChannelId) {
                        const staffChannel = message.channel.guild?.channels?.cache?.get(conn.staffChannelId);
                        if (staffChannel) {
                            await staffChannel.send({ embeds: [
                                new EmbedBuilder().setColor(0x5865F2)
                                    .setTitle('🎓 Nova Pergunta no Atendimento')
                                    .setDescription(`**Usuário:** ${message.author}\n**Ticket:** ${message.channel}\n**Pergunta:** ${msg}\n\n<@&${FALLBACK_ROLE_ID}>`)
                                    .setTimestamp()
                            ]});
                        }
                    }
                } catch (e) {}
            }
        } catch (e) {
            console.error('❌ ERRO no process de atendimento:', e);
            const timedOut = e && e.iaDown;
            await replyOrEdit(thinking, message.channel, {
                content: timedOut
                    ? '⏳ A IA local está demorando demais e caiu. Tenta enviar de novo em instantes! (vou tentar sozinho em alguns minutos)'
                    : '❌ Não consegui processar agora. Tenta reescrever a pergunta!',
                embeds: []
            });
        }
    }

    static delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = TicketAtendimento;