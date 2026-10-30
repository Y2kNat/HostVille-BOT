const { EmbedBuilder } = require('discord.js');
const db = require('../database/db');
const kilo = require('./KiloClient');
const { loadingText } = require('../utils/emojis');
const { replyOrEdit } = require('../utils/messages');
const { cliente: clienteIA } = require('../utils/TicketIA');
const { antiInventionBlock, responseRules } = require('../utils/kbPrompt');
const { generateValidated, isGiveUp } = require('../ai/ResponseValidator');
const { buildTicketContext, rememberTurn, checkInjection } = require('../utils/ticketContext');

// cargo chamado quando a IA nao consegue responder com confianca
const FALLBACK_ROLE_ID = '1542509842701226017';

class TicketSuporte {

    static async start(channel, user, guildId) {
        const embed = new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle('🆘 Ticket de Suporte')
            .setDescription(`E aí ${user.username}, beleza? 👋\n\nVocê abriu um ticket de **suporte**.\nPode falar o que está acontecendo que vou te ajudar!`)
            .setFooter({ text: 'Descreva seu problema em detalhes' });

        await channel.send({ embeds: [embed] });
    }

    static async process(message, session) {
        const msg = message.content;

        session.step = 1;
        session.question = msg;

        // Mensagem "Pensando..." que será editada com a resposta (se falhar, responde direto)
        let thinking = null;
        try { thinking = await message.channel.send(loadingText(message.client)); }
        catch (e) { console.error('❌ Pensando (suporte):', e.message); }

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

            const systemPrompt = `Você é o HostBot atendendo suporte técnico.
${history ? `\nHISTÓRICO DESTE ATENDIMENTO (use só para entender do que a pergunta fala, inclusive perguntas indiretas como "e meus carros?"):\n${history}\n` : ''}
${intentHint ? `\n${intentHint}\n` : ''}
${kbContext ? `\nCONHECIMENTO DA BASE (${docs.join(', ')}):\n${kbContext}\n` : ''}
CONHECIMENTO ADICIONAL (database local da guild): ${knowledgeText || '(vazio)'}

INSTRUÇÕES:
- Responda EXATAMENTE o que foi perguntado: se é um erro, só a solução desse erro; se pedem um comando, dê o comando + o que ele faz.
- NUNCA copie o texto do CONHECIMENTO. Resuma com suas próprias palavras.
- Se o usuário fala como quem JÁ tem o item (ex.: "minha propriedade", "já registrei", "não aparece"), NÃO repita o tutorial do zero.
- Se não souber ou não combinar, responda apenas: "Vou chamar um staff".
- Nunca invente respostas.

${responseRules()}

${antiInventionBlock()}`;

            const response = await generateValidated(clienteIA, {
                contexto: 'suporte',
                systemPrompt,
                userMessage: resolvedQuestion,
                docs,
                context: kbContext,
                extraSource: knowledgeText,
                optionOverrides: { temperature: 0.3, max_tokens: 220 }
            });

            if (response && !isGiveUp(response)) {
                await replyOrEdit(thinking, message.channel, {
                    content: '',
                    embeds: [
                        new EmbedBuilder().setColor(0x2ecc71).setDescription(response).addFields({ name: '\u200b', value: 'Resposta gerada por IA, caso seja um erro, contate <@1438102316271014008>' })
                    ]
                });
                rememberTurn(message.channel.id, message.author.username, msg, response);
            } else {
                await replyOrEdit(thinking, message.channel, { content: `🤔 Não consegui confirmar essa informação com confiança. <@&${FALLBACK_ROLE_ID}> vai responder! 🦾`, embeds: [] });
                const { logWarn } = require('../utils/logger');
                logWarn(`🎫 Ticket suporte sem resposta válida | pergunta="${String(msg).slice(0, 80)}" | por=${message.author.tag}`);
                const conn = await db.getConnection(session.guildId);
                if (conn?.staffRoleId) await message.channel.send(`<@&${conn.staffRoleId}>`);
            }
        } catch (e) {
            console.error('❌ ERRO no process de suporte:', e);
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

module.exports = TicketSuporte;
