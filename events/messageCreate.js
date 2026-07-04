const { ChannelType, EmbedBuilder, Colors, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const db = require('../database/db');
const { isAdmin, isStaff } = require('../utils/permissions');
const { logModeration, logError } = require('../utils/logger');
const SpamManager = require('../managers/SpamManager');
const FilterManager = require('../managers/FilterManager');
const LinkManager = require('../managers/LinkManager');
const WarningManager = require('../managers/WarningManager');
const StatsManager = require('../managers/StatsManager');
const { handleDMMessage } = require('../handlers/dmCommands');
const TicketManager = require('../managers/TicketManager');
const WelcomeManager = require('../managers/WelcomeManager');
const ChatManager = require('../managers/ChatManager');
const AdminChatManager = require('../managers/AdminChatManager');
const ContextMemory = require('../managers/ContextMemory');
const ImageAnalyzer = require('../managers/ImageAnalyzer');
const DynamicCommands = require('../managers/DynamicCommands');
const StaffLearner = require('../managers/StaffLearner');
const AutoInteraction = require('../managers/AutoInteraction');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

module.exports = {
    name: 'messageCreate',
    async execute(message) {
        if (message.author.bot) return;

        // ============================================
// GATILHOS ESPECIAIS (imagens/gifs)
// ============================================
if (message.guild) {
    const content = message.content.toLowerCase();
    const triggers = {
        '67': 'https://cdn.discordapp.com/attachments/1521717074240602262/1522778676175835237/the-angry-birds-red-with-ear-meme-actually-is-sourced-from-v0-1ynv2vrzwwkg1.jpg',
        'six seven': 'https://cdn.discordapp.com/attachments/1521717074240602262/1522778676175835237/the-angry-birds-red-with-ear-meme-actually-is-sourced-from-v0-1ynv2vrzwwkg1.jpg',
        'seis sete': 'https://cdn.discordapp.com/attachments/1521717074240602262/1522778676175835237/the-angry-birds-red-with-ear-meme-actually-is-sourced-from-v0-1ynv2vrzwwkg1.jpg',
    };

    for (const [trigger, url] of Object.entries(triggers)) {
        if (content.includes(trigger)) {
            const { EmbedBuilder } = require('discord.js');
const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setImage(url);
await message.reply({ embeds: [embed] });
            return;
        }
    }
}
        
        // ============================================
        // RESPONDER QUANDO ALGUÉM RESPONDE O BOT (arrastar pro lado)
        // ============================================
        if (message.reference && message.guild) {
            const replied = await AutoInteraction.onBotMessageReplied(message, message.client);
            if (replied) return;
        }

        // ============================================
        // VERIFICAR SE USUÁRIO ESTÁ SILENCIADO
        // ============================================
        if (message.guild) {
            const guildConfig = await db.getConnection(message.guild.id) || {};
            const mutedUsers = guildConfig.mutedUsers || [];
            if (mutedUsers.includes(message.author.id)) {
                try {
                    if (message.deletable) await message.delete();
                } catch (e) {}
                return;
            }
        }

        // ============================================
        // MENSAGENS NA DM
        // ============================================
        if (message.channel.type === ChannelType.DM) {
            const isWelcome = await WelcomeManager.processResponse(message);
            if (isWelcome) return;

            await handleDMMessage(message);
            return;
        }

        // ============================================
        // ATENDIMENTO AUTOMÁTICO NO TICKET
        // ============================================
        const ticketProcessed = await TicketManager.processAutoAttendant(message);
        if (ticketProcessed) return;

        // ============================================
        // COMANDOS DE ADMIN VIA CHAT (PRIMEIRO)
        // ============================================
        if (AdminChatManager.isAdminCommand(message)) {
            await AdminChatManager.processAdminCommand(message);
            return;
        }

        // ============================================
        // CANAL DE APRENDIZADO DA STAFF
        // ============================================
        const staffLearned = await StaffLearner.process(message);
        if (staffLearned) return;
        
        // ============================================
        // COMANDOS DINÂMICOS (! ou /)
        // ============================================
        const content = message.content;
        if (content.startsWith('!') || content.startsWith('/')) {
            const commandName = content.split(' ')[0].replace('!', '').replace('/', '').toLowerCase();
            const dynamicResponse = await DynamicCommands.execute(message, commandName, message.guild.id);
            if (dynamicResponse) {
                await message.reply({ content: dynamicResponse });
                return;
            }
        }

        // ============================================
        // FILTRO DE PALAVRAS OFENSIVAS (ANTES DA IA)
        // ============================================
        if (await FilterManager.containsOffensiveWord(message.content)) {
            const foundWord = await FilterManager.findOffensiveWord(message.content);

            try {
                const permissions = message.channel.permissionsFor(message.client.user);
                if (!permissions.has(PermissionFlagsBits.ManageMessages)) return;
                if (!message.deletable) return;

                await message.delete();
                StatsManager.incrementMessagesDeleted();
                await StatsManager.saveStats();

                const warnData = {
                    reason: `Palavra ofensiva detectada: "${foundWord}"`,
                    moderator: message.client.user.id,
                    timestamp: Date.now(),
                    autoWarn: true
                };

                const warns = await WarningManager.addWarning(message.author.id, warnData);
                StatsManager.incrementWarns();
                await StatsManager.saveStats();

                const warningMsg = await message.channel.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('🚫 Mensagem Removida - HostVille • BOT')
                        .setDescription('Sua mensagem foi removida por conter palavras ofensivas.')
                        .setColor(Colors.Red)
                        .addFields(
                            { name: '👤 Usuário', value: message.author.toString(), inline: false },
                            { name: '🗓 Data', value: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), inline: false },
                            { name: '🚫 Palavra', value: `**${foundWord || "desconhecida"}**`, inline: false },
                            { name: '⚠️ Avisos', value: `${warns.length}`, inline: false }
                        )
                        .setFooter({ text: 'Caso isso tenha sido um erro, contate a staff.' })
                        .setTimestamp()
                    ]
                });

                setTimeout(async () => { try { await warningMsg.delete(); } catch (e) {} }, 10000);

                logModeration('Palavras ofensivas detectadas', message.author, message.content, message.channel, foundWord || 'desconhecida');

                const punishment = await WarningManager.checkAutoPunishment(message.member);
                if (punishment) {
                    const punishmentMsg = await message.channel.send(punishment);
                    setTimeout(async () => { try { await punishmentMsg.delete(); } catch (e) {} }, 10000);
                }
                
                return;
            } catch (err) {
                logError(`Erro ao moderar mensagem: ${err.message}`);
            }
        }

        // ============================================
        // ANÁLISE DE IMAGENS
        // ============================================
        if (ChatManager.isBotCalled(message)) {
            const msgContent = message.content.toLowerCase();
            
            // Traduzir imagem
            if (msgContent.includes('traduz') || msgContent.includes('traduza') || msgContent.includes('traduzir')) {
                const translateResponse = await ImageAnalyzer.translateImage(message);
                if (translateResponse) {
                    await message.reply({ content: translateResponse });
                    return;
                }
            }
            
            // Analisar imagem
            const imageResponse = await ImageAnalyzer.analyzeWithAI(message);
            if (imageResponse) {
                await message.reply({ content: imageResponse });
                return;
            }
        }

        const imageAnalysis = await ImageAnalyzer.analyze(message);
        if (imageAnalysis && !ChatManager.isBotCalled(message)) {
            await message.reply({ content: '📸 Se quiser que eu analise essa imagem, me menciona junto! Ex: `HvBot o que tem nessa imagem?`' });
            return;
        }

        // ============================================
        // VERIFICAR SE USUÁRIO TEM CONTEXTO PENDENTE
        // ============================================
        const pending = ContextMemory.getPending(message.author.id);
        
        if (pending && !ChatManager.isBotCalled(message)) {
            ContextMemory.clearPending(message.author.id);
            
            const answer = message.content;
            const question = pending.question;
            
            await message.channel.sendTyping();

            try {
                const knowledge = await db.getKnowledge(message.guild.id);
                let conhecimentoTexto = '';
                
                if (Object.keys(knowledge).length > 0) {
                    conhecimentoTexto = 'CONHECIMENTO DO SERVIDOR (USE EXATAMENTE):\n';
                    for (const [id, entry] of Object.entries(knowledge)) {
                        conhecimentoTexto += `- "${entry.keywords.join(', ')}" → "${entry.response}"\n`;
                    }
                }

                const systemPrompt = `O usuário tinha perguntado: "${question}"
E agora respondeu: "${answer}"
Ele está falando do SERVIDOR/JOGO/DISCORD.

${conhecimentoTexto}

REGRA ABSOLUTA:
- Se a pergunta combinar com o conhecimento, COPIE EXATAMENTE a resposta
- NÃO invente, NÃO explique, só COPIE
- Se não combinar: "Confira os canais de informação!"`;

                const completion = await groq.chat.completions.create({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: answer }
                    ],
                    temperature: 0.3,
                    max_tokens: 200
                });

                const response = completion.choices[0]?.message?.content?.trim() || '📋 Confira os canais de informação!';
                
                await message.reply({ content: response });
            } catch (error) {
                await message.reply({ content: '📋 No servidor, confira os canais de informação.' });
            }
            
            return;
        }

        // ============================================
        // RESPONDER QUANDO MENCIONAR O BOT
        // ============================================
        if (ChatManager.isBotCalled(message)) {
            await ChatManager.respondToMessage(message);
            return;
        }

        // ============================================
        // MODERAÇÃO EM CANAIS DE SERVIDOR
        // ============================================
        const isMonitoringActive = await db.getMonitoringStatus(message.guild.id);
        if (!isMonitoringActive) return;
        if (isStaff(message.author.id)) return;
        if (isAdmin(message.member)) return;

        // ============================================
        // ANTI-SPAM
        // ============================================
        const spamCheck = SpamManager.checkSpam(message);
        if (spamCheck.isSpam) {
            await SpamManager.handleSpam(message);
            return;
        }

        // ============================================
        // ANTI-LINK
        // ============================================
        const linkCheck = await LinkManager.checkLink(message);
        if (linkCheck.block) {
            await LinkManager.handleLinkBlock(message, linkCheck.reason);
            StatsManager.incrementMessagesDeleted();
            await StatsManager.saveStats();
            logModeration('Anti-link', message.author, message.content, message.channel, linkCheck.reason);
            return;
        }
    }
};