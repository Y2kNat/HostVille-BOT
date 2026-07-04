
const Groq = require('groq-sdk');
const db = require('../database/db');
const ContextMemory = require('./ContextMemory');
const ChatMemory = require('./ChatMemory');
const BotModes = require('./BotModes');
const TaskRunner = require('./TaskRunner');
const VoiceMessage = require('./VoiceMessage');
const AutoInteraction = require('./AutoInteraction');
const RestartManager = require('./RestartManager');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class ChatManager {

    static isBotCalled(message) {
        const botMention = `<@${message.client.user.id}>`;
        const botName = message.client.user.username.toLowerCase();
        const content = message.content.toLowerCase();

        return (
            message.content.includes(botMention) ||
            content.startsWith(botName) ||
            content.startsWith('hvbot') ||
            content.startsWith('hostbot')
        );
    }

    static extractQuestion(message) {
        const botMention = `<@${message.client.user.id}>`;
        const botName = message.client.user.username.toLowerCase();

        return message.content
            .replace(botMention, '')
            .replace(new RegExp(botName, 'gi'), '')
            .replace(/hvbot/gi, '')
            .replace(/hostbot/gi, '')
            .trim();
    }

    static async respondToMessage(message) {
        let question = this.extractQuestion(message);
        const userId = message.author.id;
        const userName = message.author.username;
        const mode = await BotModes.getMode(message.guild.id);
        const guildConfig = await db.getConnection(message.guild.id) || {};
        const voiceMode = guildConfig.voiceMode === true;

        // RESTART
        if (question.toLowerCase().includes('restart') || question.toLowerCase().includes('reiniciar')) {
            await RestartManager.restart(message.client, message);
            return true;
        }

        // Pegar 1 emoji aleatório do servidor
        const randomEmoji = AutoInteraction.getRandomEmoji(message.client);

        // MENSAGEM DE VOZ DIRETA
        if (question.toLowerCase().includes('fala') || question.toLowerCase().includes('diga') || question.toLowerCase().includes('em voz')) {
            let textToSpeak = question.replace(/fala|diga|em voz|por áudio|por audio/gi, '').replace(/[""]/g, '').trim();
            if (textToSpeak.length > 3) {
                await VoiceMessage.send(message, textToSpeak);
                return true;
            }
        }

        // OFENSAS
        const offensiveWords = ['merda', 'fdp', 'caralho', 'puta', 'desgraça', 'arrombado', 'vsf', 'tnc', 'cu', 'bosta', 'porra', 'cacete', 'filho da puta', 'vai tomar no cu', 'vtnc', 'foda-se', 'fodase'];
        const hasOffense = offensiveWords.some(w => question.toLowerCase().includes(w));

        if (hasOffense) {
            await message.channel.sendTyping();
            try {
                const roastPrompt = `Você é o HostBot em MODO ${mode.name}. O usuário ${userName} te xingou: "${question}"

${mode.allowOffensive ? 'PALAVRÕES LIBERADOS.' : 'NUNCA use palavrões.'}
${mode.systemPrompt}

Responda no mesmo nível. Máximo 2 linhas.
FORMATO DE RESPOSTA:
- Fale como um AMIGO, não como um analista
- NUNCA use palavras como "parece que", "a galera está", "usando gírias como"
- NUNCA analise a conversa, PARTICIPE dela
- Seja DIRETO e NATURAL
- Exemplo ERRADO: "Parece que a galera está rindo..."
- Exemplo CERTO: "KKKKK Caroline dormiu no role? Celular no silencioso é foda! 😂"`;

                const completion = await groq.chat.completions.create({
                    model: 'llama-3.3-70b-versatile',
                    messages: [{ role: 'system', content: roastPrompt }, { role: 'user', content: question }],
                    temperature: mode.temperature,
                    max_tokens: 150
                });

                let response = completion.choices[0]?.message?.content?.trim() || '😅 Tô suave! 🤙';

                // Adicionar emoji se não tiver
                if (randomEmoji && !response.includes(randomEmoji)) {
                    response = response.trim() + ' ' + randomEmoji;
                }

                await message.reply({ content: response });
            } catch (e) {
                await message.reply({ content: '😅 Tô suave! 🤙' });
            }
            return true;
        }

        // TAREFAS
        const taskKeywords = ['cria um', 'crie um', 'faça um', 'faca um', 'faz um', 'gere um', 'gera um', 'escreva um', 'escreva uma', 'muta o', 'mute o', 'silencia o', 'expulsa o', 'bane o', 'banir o', 'anuncia', 'cria uma', 'crie uma', 'faça uma', 'faca uma', 'faz uma', 'gere uma', 'gera uma', 'quero que você', 'quero que voce', 'quero que vc'];
        const isTask = taskKeywords.some(kw => question.toLowerCase().includes(kw));

        if (isTask) {
            const taskResult = await TaskRunner.run(message);
            if (taskResult) {
                let response = taskResult;
                if (randomEmoji && !response.includes(randomEmoji)) {
                    response = response.trim() + ' ' + randomEmoji;
                }
                if (voiceMode) await VoiceMessage.send(message, response);
                else await message.reply({ content: response });
            }
            return true;
        }

        // CONHECIMENTO
        const knowledge = await db.getKnowledge(message.guild.id);
        const q = question.toLowerCase();

        for (const [id, entry] of Object.entries(knowledge)) {
            const matchCount = entry.keywords.filter(kw => q.includes(kw.toLowerCase())).length;
            if (matchCount >= 2) {
                let response = entry.response;
                if (randomEmoji && !response.includes(randomEmoji)) {
                    response = response.trim() + ' ' + randomEmoji;
                }
                if (voiceMode) await VoiceMessage.send(message, response);
                else await message.reply({ content: response });
                return true;
            }
        }

        // RESPOSTA NORMAL COM IA
        let referencedContent = '';
        let referencedAuthor = '';
        if (message.reference) {
            try {
                const refMsg = await message.channel.messages.fetch(message.reference.messageId);
                if (refMsg) {
                    referencedContent = refMsg.content;
                    referencedAuthor = refMsg.author.username;
                }
            } catch (e) {}
        }

        ChatMemory.remember(userId, question);
        await message.channel.sendTyping();

        try {
            let systemPrompt;
            if (referencedContent) {
                systemPrompt = `${mode.systemPrompt}\n\n${userName} respondeu "${referencedAuthor}" que disse: "${referencedContent}"\nE te perguntou: "${question}"\n\nResponda como AMIGO, não como analista. NUNCA use "parece que", "a galera está". Seja DIRETO e NATURAL. Máximo 3 linhas.`;
            } else {
                systemPrompt = `${mode.systemPrompt}\n\n${userName}: ${question}\n\nResponda como AMIGO, não como analista. NUNCA use "parece que", "a galera está". Seja DIRETO e NATURAL.`;
            }

            const completion = await groq.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: question || 'Oi' }],
                temperature: mode.temperature,
                max_tokens: 200
            });

            let response = completion.choices[0]?.message?.content?.trim();
            if (!response) response = '🤔 Não consegui responder...';
            if (response.includes('servidor') && response.includes('vida real')) ContextMemory.setPending(userId, question);

            // Adicionar emoji no final
            if (randomEmoji && !response.includes(randomEmoji)) {
                response = response.trim() + ' ' + randomEmoji;
            }

            if (voiceMode) await VoiceMessage.send(message, response);
            else await message.reply({ content: response });
            return true;

        } catch (error) {
            console.error('Erro:', error.message);
            await message.reply({ content: '❌ Erro.' });
            return true;
        }
    }
}

module.exports = ChatManager;