const kilo = require('./KiloClient');
const TaskRunner = require('./TaskRunner');
const db = require('../database/db');

// Memória de fatos sobre usuários (usuário → lista de coisas que ele disse)
const userFacts = new Map();

// Contador de mensagens por usuário (ranking de quem mais fala)
const userMessageCount = new Map();

class AutoInteraction {

    // Canais onde o bot pode interagir sozinho
    static ALLOWED_CHANNELS = ['1392306454756720742'];

    // Servidor de onde pegar os emojis (precisa estar nesse servidor)
    static EMOJI_GUILD_ID = '1519076712413925416';

    // Vídeo enviado quando o chat fica 7 horas sem ninguém falar
    static INACTIVE_VIDEO = './media/inactive.mp4';

    // Timestamp da última mensagem no chat (usado pra detectar inatividade)
    static lastMessageTime = Date.now();

    // ============================================
    // 😊 PEGAR TODOS OS EMOJIS DO SERVIDOR
    // ============================================
    static getServerEmojis(client) {
        const guild = client.guilds.cache.get(this.EMOJI_GUILD_ID);
        if (!guild) return [];
        return guild.emojis.cache
            .filter(e => e.available)
            .map(e => e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`)
            .slice(0, 50);
    }

    // ============================================
    // 🎲 PEGAR 1 EMOJI ALEATÓRIO
    // ============================================
    static getRandomEmoji(client) {
        const emojis = this.getServerEmojis(client);
        if (emojis.length === 0) return '';
        return emojis[Math.floor(Math.random() * emojis.length)];
    }

    // ============================================
    // 🎰 ROLETA DE MENÇÕES ALEATÓRIAS
    // ============================================
    static mentionRoulette(guild) {
        const activeUsers = [];
        for (const [userId, count] of userMessageCount) {
            if (count > 0) activeUsers.push({ userId, count });
        }
        activeUsers.sort((a, b) => b.count - a.count);
        const rand = Math.random();

        // @everyone: 0.001% dividido por número de ativos (MUITO RARO)
        if (rand < 0.00001 / Math.max(activeUsers.length, 1)) {
            return { type: 'everyone', mention: '@everyone' };
        }

        // Top usuários: chance baseada em quem mais fala
        if (activeUsers.length > 0) {
            for (let i = 0; i < Math.min(activeUsers.length, 5); i++) {
                const chance = 0.35 - (i * 0.10);
                if (rand < chance && chance > 0) {
                    const member = guild.members.cache.get(activeUsers[i].userId);
                    if (member) {
                        return {
                            type: 'user',
                            mention: `<@${activeUsers[i].userId}>`,
                            username: member.user.username,
                            rank: i + 1
                        };
                    }
                }
            }
        }

        // Ninguém: 30% a 70%
        if (rand < 0.30 + (Math.random() * 0.40)) return { type: 'none', mention: '' };

        // Usuário aleatório
        const members = guild.members.cache.filter(m => !m.user.bot);
        if (members.size > 0) {
            const rm = members.random();
            return { type: 'user', mention: `<@${rm.id}>`, username: rm.user.username };
        }
        return { type: 'none', mention: '' };
    }

    // ============================================
    // 📊 REGISTRAR MENSAGEM DO USUÁRIO
    // ============================================
    static registerMessage(userId) {
        userMessageCount.set(userId, (userMessageCount.get(userId) || 0) + 1);
    }

    // Persona padrão (modos personalizados removidos)
    static DEFAULT_PROMPT = `Você é o HostBot, robô BRASILEIRO com modo GLOBAL.
Responda DIRETAMENTE o que foi pedido, sem rodeios. NÃO use gírias ("mano", "pô", "tá ligado", "tmj", "slc", "suave").
Não enrole, vá direto ao ponto. Tom neutro e natural. Português brasileiro. Máximo 3 linhas.`;

    // ============================================
    // 🧠 CONSTRUIR PROMPT COM CONTEXTO
    // ============================================
    static async buildPrompt(guildId, contextType, contextData = {}) {
        let basePrompt = this.DEFAULT_PROMPT;

        // Instruções específicas do AutoInteraction
        const autoInteractionRules = [
            '',
            'REGRAS ADICIONAIS PARA INTERAÇÃO AUTOMÁTICA:',
            '- Máximo 2 linhas',
            '- NATURAL, como amigo de longa data',
            '- NUNCA formal ou analista',
            '- NUNCA use "parece que", "a galera está"',
            '- Seja ÚNICO e NATURAL'
        ];

        // Adicionar emoji se disponível
        if (contextData.randomEmoji) {
            autoInteractionRules.push(`- USE EXATAMENTE 1 EMOJI NO FINAL: ${contextData.randomEmoji}`);
        }

        // Adicionar menção da roleta
        if (contextData.roulette) {
            if (contextData.roulette.type === 'user') {
                autoInteractionRules.push(`- VOCÊ DEVE MENCIONAR ${contextData.roulette.mention} na sua resposta (use exatamente ${contextData.roulette.mention})`);
            } else if (contextData.roulette.type === 'everyone') {
                autoInteractionRules.push('- USE @everyone! RARÍSSIMO! RESPONSABILIDADE!');
            }
        }

        // Contexto específico por tipo de interação
        let contextPrompt = '';
        switch (contextType) {
            case 'reply':
                contextPrompt = `\n\n<@${contextData.userId}> respondeu sua mensagem anterior com: "${contextData.content}"`;
                break;
            case 'respond_to_message':
                contextPrompt = `\n\nVocê está respondendo especificamente uma mensagem de <@${contextData.userId}> que disse: "${contextData.content}"`;
                break;
            case 'remember_fact':
                contextPrompt = `\n\nVocê lembrou de algo sobre ${contextData.username} do nada. A pessoa disse: "${contextData.fact}"
- Comente com humor sobre isso`;
                break;
            case 'random':
                contextPrompt = `\n\nO chat está assim no momento:\n${contextData.lastMessages || 'Vazio...'}
- Puxe assunto, zoe, brinque, ou comente algo`;
                break;
        }

        return basePrompt + '\n' + autoInteractionRules.join('\n') + contextPrompt;
    }

    // ============================================
    // 🤖 GERAR RESPOSTA USANDO A IA (gateway Kilo) + MODO
    // ============================================

    /**
     * Monta o turno de usuário da conversa.
     *
     * Não é enfeite: sem um turno 'user' o modelo não consegue aplicar o
     * chat template e devolve HTTP 200 com finish_reason="load", usage
     * zerada e content vazio em ~150ms.
     * O modelo nunca chega a começar, então repetir a chamada não resolve.
     */
    static buildUserTurn(contextType, contextData = {}) {
        switch (contextType) {
            case 'reply':
            case 'respond_to_message':
                return `<@${contextData.userId}> disse: "${contextData.content || ''}"`;
            case 'remember_fact':
                return `${contextData.username} falou antes: "${contextData.fact || ''}"`;
            case 'random':
                return `Últimas mensagens do chat:\n${contextData.lastMessages || '(nenhuma)'}`;
            default:
                return 'Responda ao chat.';
        }
    }

    static async generateResponse(guildId, contextType, contextData = {}) {
        const systemPrompt = await this.buildPrompt(guildId, contextType, contextData);

        const completion = await kilo.chat({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: this.buildUserTurn(contextType, contextData) }
            ],
            temperature: 0.7,
            max_tokens: 120
        });

        let phrase = completion;

        // Garantir que tem o emoji no final
        if (phrase && contextData.randomEmoji && !phrase.includes(contextData.randomEmoji)) {
            phrase = phrase.trim() + ' ' + contextData.randomEmoji;
        }

        // Adicionar @everyone se a roleta escolheu
        if (contextData.roulette?.type === 'everyone' && phrase && !phrase.includes('@everyone')) {
            phrase = '@everyone ' + phrase;
        }

        return phrase;
    }

    // ============================================
    // 💬 RESPONDER NA HORA (arrastar mensagem do bot)
    // ============================================
    static async onBotMessageReplied(message, client) {
        if (!message.reference) return false;
        try {
            const referenced = await message.channel.messages.fetch(message.reference.messageId);
            if (!referenced || referenced.author.id !== client.user.id) return false;

            this.registerMessage(message.author.id);

            // Se o reply pedir código/arquivo, rotear para o TaskRunner (cria arquivo completo)
            if (await TaskRunner.isTaskRequest(message.content)) {
                const taskResult = await TaskRunner.run(message);
                if (taskResult) {
                    await message.reply({ content: taskResult });
                    console.log(`📋 Tarefa via reply para ${message.author.username}`);
                    return true;
                }
            }

            const randomEmoji = this.getRandomEmoji(client);

            const phrase = await this.generateResponse(message.guild.id, 'reply', {
                userId: message.author.id,
                content: message.content,
                randomEmoji
            });

            if (phrase && phrase.length > 3) {
                await message.reply({ content: phrase });
                console.log(`💬 Resposta na hora para ${message.author.username}`);
                return true;
            }
        } catch (e) {
            console.error('Erro onBotMessageReplied:', e.message);
        }
        return false;
    }

    // ============================================
    // 🤖 INTERAÇÕES ALEATÓRIAS (a cada 20 min)
    // ============================================
    static startRandomInteractions(client) {
        // Atualizar timestamp quando alguém falar no chat
        client.on('messageCreate', (msg) => {
            if (!msg.author.bot && this.ALLOWED_CHANNELS.includes(msg.channel.id)) {
                this.lastMessageTime = Date.now();
            }
        });

        setInterval(async () => {
            try {
                // Manutenção ativa → nenhuma interação automática
                if (require('./MaintenanceManager').isEnabled()) return;

                // ============================================
                // VERIFICAR INATIVIDADE (7 horas sem mensagens)
                // ============================================
                const inactiveTime = Date.now() - this.lastMessageTime;
                const sevenHours = 7 * 60 * 60 * 1000;

                if (inactiveTime > sevenHours) {
                    const guilds = client.guilds.cache;
                    for (const [id, guild] of guilds) {
                        // 👇 Verificar se auto-interação está LIGADA
                        const isEnabled = await db.getAutoInteractionStatus(guild.id);
                        if (!isEnabled) continue;

                        const channels = guild.channels.cache.filter(c =>
                            this.ALLOWED_CHANNELS.includes(c.id) &&
                            c.permissionsFor(guild.members.me).has('SendMessages')
                        );
                        if (channels.size > 0) {
                            const channel = channels.random();
                            await channel.send({
                                content: '💤 7 horas sem ninguém falar... ACORDA GALERA! 🎬',
                                files: [{ attachment: this.INACTIVE_VIDEO, name: 'acorda-galera.mp4' }]
                            });
                            this.lastMessageTime = Date.now();
                            break;
                        }
                    }
                }

                // ============================================
                // INTERAÇÕES NORMAIS
                // ============================================
                const guilds = client.guilds.cache;

                for (const [id, guild] of guilds) {
                    // 👇 VERIFICAR SE AUTO-INTERAÇÃO ESTÁ LIGADA
                    const isEnabled = await db.getAutoInteractionStatus(guild.id);
                    if (!isEnabled) continue;

                    // 40% de chance de interagir nesse ciclo
                    if (Math.random() > 0.40) continue;

                    const channels = guild.channels.cache.filter(c =>
                        this.ALLOWED_CHANNELS.includes(c.id) &&
                        c.permissionsFor(guild.members.me).has('SendMessages')
                    );
                    if (channels.size === 0) continue;

                    const channel = channels.random();

                    // Pegar últimas mensagens do chat para contexto
                    let lastMessages = '';
                    let lastAuthors = [];
                    try {
                        const messages = await channel.messages.fetch({ limit: 15 });
                        const msgArray = Array.from(messages.values()).reverse();
                        for (const msg of msgArray) {
                            if (!msg.author.bot) {
                                lastMessages += `<@${msg.author.id}>: ${msg.content}\n`;
                                lastAuthors.push({
                                    username: msg.author.username,
                                    id: msg.author.id,
                                    content: msg.content
                                });
                                this.registerMessage(msg.author.id);
                            }
                        }
                    } catch (e) {
                        // Silencioso - não quebra o bot
                    }

                    // 🎰 ROLETA de menções
                    const roulette = this.mentionRoulette(guild);

                    // 😊 Pegar 1 emoji aleatório
                    const randomEmoji = this.getRandomEmoji(client);

                    const action = Math.random();
                    let phrase = null;

                    const contextData = {
                        randomEmoji,
                        roulette
                    };

                    // ============================================
                    // 30% - Responder uma mensagem específica
                    // ============================================
                    if (action < 0.30 && lastAuthors.length > 0) {
                        const randomMsg = lastAuthors[Math.floor(Math.random() * lastAuthors.length)];
                        this.learnFact(randomMsg.username, randomMsg.id, randomMsg.content);

                        phrase = await this.generateResponse(guild.id, 'respond_to_message', {
                            ...contextData,
                            userId: randomMsg.id,
                            content: randomMsg.content
                        });
                    }
                    // ============================================
                    // 25% - Lembrar de um fato antigo
                    // ============================================
                    else if (action < 0.55 && this.getRandomFact()) {
                        const fact = this.getRandomFact();

                        phrase = await this.generateResponse(guild.id, 'remember_fact', {
                            ...contextData,
                            username: fact.username,
                            fact: fact.fact
                        });
                    }
                    // ============================================
                    // 45% - Frase aleatória
                    // ============================================
                    else {
                        phrase = await this.generateResponse(guild.id, 'random', {
                            ...contextData,
                            lastMessages
                        });
                    }

                    // Enviar a frase
                    if (phrase && phrase.length > 5) {
                        await channel.send({ content: phrase });
                        console.log(`💬 Interação em #${channel.name}: ${phrase.substring(0, 50)}`);
                    }
                }
            } catch (error) {
                console.error('Erro nas interações aleatórias:', error.message);
            }
        }, 20 * 60 * 1000); // A cada 20 minutos
    }

    // ============================================
    // 🔧 TOGGLE AUTO INTERACTION (ON/OFF)
    // ============================================
    static async setAutoInteraction(guildId, enabled) {
        await db.setAutoInteractionStatus(guildId, enabled);
        console.log(`🔧 Auto-interação ${enabled ? 'LIGADA' : 'DESLIGADA'} para guild ${guildId}`);
        return enabled;
    }

    static async getAutoInteraction(guildId) {
        return await db.getAutoInteractionStatus(guildId);
    }

    // ============================================
    // 🧠 APRENDER FATO SOBRE USUÁRIO
    // ============================================
    static learnFact(username, userId, content) {
        const key = userId || username;
        if (!userFacts.has(key)) userFacts.set(key, []);
        const facts = userFacts.get(key);
        facts.push({ username, fact: content, timestamp: Date.now() });
        if (facts.length > 5) facts.shift();
    }

    // ============================================
    // 📝 PEGAR FATO ALEATÓRIO ANTIGO
    // ============================================
    static getRandomFact() {
        const allFacts = [];
        for (const facts of userFacts.values()) {
            for (const fact of facts) allFacts.push(fact);
        }
        if (allFacts.length === 0) return null;
        const oldFacts = allFacts.filter(f => Date.now() - f.timestamp > 10 * 60 * 1000);
        const pool = oldFacts.length > 0 ? oldFacts : allFacts;
        return pool[Math.floor(Math.random() * pool.length)];
    }
}

module.exports = AutoInteraction;