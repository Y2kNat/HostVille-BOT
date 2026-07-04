const Groq = require('groq-sdk');
const db = require('../database/db');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Memória de fatos sobre usuários (usuário → lista de coisas que ele disse)
const userFacts = new Map();

// Contador de mensagens por usuário (ranking de quem mais fala)
const userMessageCount = new Map();

class AutoInteraction {

    // Canais onde o bot pode interagir sozinho
    static ALLOWED_CHANNELS = ['1392306454756720742'];

    // Servidor de onde pegar os emojis (precisa estar nesse servidor)
    static EMOJI_GUILD_ID = '1519076712413925416';

    // Gatilhos especiais: quando alguém digitar essas palavras, o bot manda uma imagem
    static SPECIAL_TRIGGERS = {
        '67': 'https://cdn.discordapp.com/attachments/1521717074240602262/1522778676175835237/the-angry-birds-red-with-ear-meme-actually-is-sourced-from-v0-1ynv2vrzwwkg1.jpg',
        'six seven': 'https://cdn.discordapp.com/attachments/1521717074240602262/1522778676175835237/the-angry-birds-red-with-ear-meme-actually-is-sourced-from-v0-1ynv2vrzwwkg1.jpg',
        'seis sete': 'https://cdn.discordapp.com/attachments/1521717074240602262/1522778676175835237/the-angry-birds-red-with-ear-meme-actually-is-sourced-from-v0-1ynv2vrzwwkg1.jpg',
    };

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

    // ============================================
    // 🎯 VERIFICAR GATILHOS ESPECIAIS (67 = imagem)
    // ============================================
    static checkSpecialTriggers(content) {
        const lower = content.toLowerCase();
        for (const [trigger, url] of Object.entries(this.SPECIAL_TRIGGERS)) {
            if (lower.includes(trigger)) return url;
        }
        return null;
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
            const randomEmoji = this.getRandomEmoji(client);

            const systemPrompt = `Você é o HostBot, robô da HostVille.
<@${message.author.id}> respondeu sua mensagem anterior com: "${message.content}"

PERSONALIDADE:
- BRASILEIRO, ZOEIRO, CARISMÁTICO e AMIGÁVEL
- Fala como AMIGO: "mano", "pô", "tá ligado", "slc", "tmj", "suave", "fechou", "bora", "partiu"
- NUNCA seja agressivo, ignorante ou rude
- NUNCA use "se manca", "acorda pra vida", "tá de sacanagem" de forma ofensiva
- Seja LEVE, DIVERTIDO e RESPEITOSO
- USE EXATAMENTE 1 EMOJI NO FINAL: ${randomEmoji}
- NATURAL, como amigo de longa data
- NUNCA formal ou analista
- NUNCA use "parece que", "a galera está"
- Máximo 2 linhas`;

            const completion = await groq.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'system', content: systemPrompt }],
                temperature: 0.9, max_tokens: 120
            });

            let phrase = completion.choices[0]?.message?.content?.trim();
            if (phrase && randomEmoji && !phrase.includes(randomEmoji)) {
                phrase = phrase.trim() + ' ' + randomEmoji;
            }
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
                // ============================================
                // VERIFICAR INATIVIDADE (7 horas sem mensagens)
                // ============================================
                const inactiveTime = Date.now() - this.lastMessageTime;
                const sevenHours = 7 * 60 * 60 * 1000;

                if (inactiveTime > sevenHours) {
                    const guilds = client.guilds.cache;
                    for (const [id, guild] of guilds) {
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
                const guilds = client.guilds.cache.filter(g => true);

                for (const [id, guild] of guilds) {
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
                    let systemPrompt = '';

                    // ============================================
                    // 30% - Responder uma mensagem específica
                    // ============================================
                    if (action < 0.30 && lastAuthors.length > 0) {
                        const randomMsg = lastAuthors[Math.floor(Math.random() * lastAuthors.length)];
                        this.learnFact(randomMsg.username, randomMsg.id, randomMsg.content);

                        systemPrompt = `Você é o HostBot, robô da HostVille.
                        
Você está respondendo especificamente uma mensagem de <@${randomMsg.id}> que disse: "${randomMsg.content}"

PERSONALIDADE:
- BRASILEIRO, ZOEIRO, CARISMÁTICO e AMIGÁVEL
- Fala como AMIGO: "mano", "pô", "tá ligado", "slc", "tmj", "suave", "fechou", "bora", "partiu"
- NUNCA seja agressivo, ignorante ou rude
- NUNCA use "se manca", "acorda pra vida", "tá de sacanagem" de forma ofensiva
- Seja LEVE, DIVERTIDO e RESPEITOSO
- USE EXATAMENTE 1 EMOJI NO FINAL: ${randomEmoji}
- NATURAL, como amigo de longa data
- NUNCA formal ou analista
- NUNCA use "parece que", "a galera está"
- Máximo 2 linhas
${roulette.type === 'user' ? `- VOCÊ DEVE MENCIONAR ${roulette.mention} na sua resposta (use exatamente ${roulette.mention})` : ''}
${roulette.type === 'everyone' ? '- USE @everyone! RARÍSSIMO! RESPONSABILIDADE!' : ''}`;
                    }
                    // ============================================
                    // 25% - Lembrar de um fato antigo
                    // ============================================
                    else if (action < 0.55 && this.getRandomFact()) {
                        const fact = this.getRandomFact();

                        systemPrompt = `Você é o HostBot, robô da HostVille.
                        
Você lembrou de algo sobre ${fact.username} do nada. A pessoa disse: "${fact.fact}"

PERSONALIDADE:
- BRASILEIRO, ZOEIRO, CARISMÁTICO e AMIGÁVEL
- Fala como AMIGO: "mano", "pô", "tá ligado", "slc", "tmj", "suave"
- NUNCA seja agressivo, ignorante ou rude
- Seja LEVE, DIVERTIDO e RESPEITOSO
- USE EXATAMENTE 1 EMOJI NO FINAL: ${randomEmoji}
- NATURAL, como amigo de longa data
- Comente com humor sobre isso
- Máximo 2 linhas
${roulette.type === 'user' ? `- VOCÊ DEVE MENCIONAR ${roulette.mention} na sua fala (use exatamente ${roulette.mention})` : ''}
${roulette.type === 'everyone' ? '- USE @everyone! RARÍSSIMO!' : ''}`;
                    }
                    // ============================================
                    // 45% - Frase aleatória
                    // ============================================
                    else {
                        systemPrompt = `Você é o HostBot, robô da HostVille.
                        
O chat está assim no momento:
${lastMessages || 'Vazio...'}

PERSONALIDADE:
- BRASILEIRO, ZOEIRO, CARISMÁTICO e AMIGÁVEL
- Fala como AMIGO: "mano", "pô", "tá ligado", "slc", "tmj", "suave", "fechou", "bora", "partiu"
- NUNCA seja agressivo, ignorante ou rude
- NUNCA use "se manca", "acorda pra vida", "tá de sacanagem" de forma ofensiva
- Seja LEVE, DIVERTIDO e RESPEITOSO
- USE EXATAMENTE 1 EMOJI NO FINAL: ${randomEmoji}
- NATURAL, como amigo de longa data
- Puxe assunto, zoe, brinque, ou comente algo
- NUNCA formal ou analista
- Seja ÚNICO e NATURAL
- Máximo 2 linhas
${roulette.type === 'user' ? `- VOCÊ DEVE MENCIONAR ${roulette.mention} na sua fala (use exatamente ${roulette.mention})` : ''}
${roulette.type === 'everyone' ? '- USE @everyone! RARÍSSIMO! RESPONSABILIDADE!' : ''}`;
                    }

                    const completion = await groq.chat.completions.create({
                        model: 'llama-3.3-70b-versatile',
                        messages: [{ role: 'system', content: systemPrompt }],
                        temperature: 0.95,
                        max_tokens: 120
                    });
                    phrase = completion.choices[0]?.message?.content?.trim();

                    // Garantir que tem o emoji no final
                    if (phrase && randomEmoji && !phrase.includes(randomEmoji)) {
                        phrase = phrase.trim() + ' ' + randomEmoji;
                    }

                    // Adicionar @everyone se a roleta escolheu
                    if (roulette.type === 'everyone' && phrase && !phrase.includes('@everyone')) {
                        phrase = '@everyone ' + phrase;
                    }

                    // Enviar a frase
                    if (phrase && phrase.length > 5) {
                        await channel.send({ content: phrase });
                        console.log(`💬 Interação em #${channel.name}: ${phrase.substring(0, 50)}`);
                    }
                }
            } catch (error) {
                // Silencioso - não quebra o bot
            }
        }, 20 * 60 * 1000); // A cada 20 minutos
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