const Memory = require('../models/Memory');
const Pending = require('../models/Pending');
const db = require('../database/db');

class AutoLearn {

    /**
     * Aprender com qualquer mensagem do chat
     */
    static async learnFromChat(message, response) {
        if (!response || response.length < 10) return;
        if (response.includes('Não sei') || response.includes('não consegui')) return;
        if (message.author.bot) return;

        const question = message.content
            .replace(/<@!?\d+>/g, '')
            .replace(/hvbot|hostbot/gi, '')
            .trim();

        if (question.length < 5) return;

        // Extrair TUDO que pode ser aprendido
        const lower = question.toLowerCase();

        // 1. PALAVRAS-CHAVE
        const stopWords = ['que', 'para', 'com', 'como', 'uma', 'isso', 'esse', 'essa', 'aquele', 'aquela', 'porque', 'quando', 'onde', 'qual', 'quem', 'mas', 'também', 'muito', 'bem', 'mal', 'sim', 'não'];
        const keywords = lower
            .replace(/[?.,!?]/g, '')
            .split(' ')
            .filter(w => w.length > 2 && !stopWords.includes(w))
            .slice(0, 8);

        // 2. EMOJIS
        const emojis = question.match(/[\p{Emoji}]/gu) || [];

        // 3. FRASES COMPLETAS (se a pergunta for longa)
        const phrase = question.length > 20 ? question : null;

        // 4. NOMES (menções)
        const mentions = message.mentions?.users?.map(u => u.username) || [];

        // 5. PADRÕES DE FALA (gírias, expressões)
        const speechPatterns = [];
        const girias = ['mano', 'pô', 'tá ligado', 'slc', 'tmj', 'suave', 'fechou', 'bora', 'partiu', 'é nóis', 'qual foi', 'demorou'];
        for (const g of girias) {
            if (lower.includes(g)) speechPatterns.push(g);
        }

        // Salvar no Depósito (categoria 'deposito')
        const depositData = {
            question,
            answer: response,
            keywords,
            emojis,
            phrase,
            mentions,
            speechPatterns,
            timestamp: new Date()
        };

        await Memory.create({
            user: message.author.username,
            userId: message.author.id,
            question: question,
            answer: JSON.stringify(depositData),
            understood: true,
            category: 'deposito',
            guildId: message.guild.id,
            timestamp: new Date()
        });

        // Também salvar no conhecimento local se tiver keywords suficientes
        if (keywords.length >= 2) {
            const entryId = keywords[0].replace(/[^a-z0-9_]/g, '_').substring(0, 20);
            await db.addKnowledge(message.guild.id, entryId, keywords, response);
        }

        console.log(`🧠 Depósito: ${keywords.slice(0, 3).join(', ')} | ${emojis.length} emojis | ${mentions.length} menções`);
    }

    /**
     * Ver estatísticas do depósito
     */
    static async getDepositStats(guildId) {
        const deposits = await Memory.find({ category: 'deposito', guildId }).lean();
        
        const stats = {
            total: deposits.length,
            palavras: 0,
            emojis: [],
            frases: 0,
            nomes: [],
            girias: [],
            ultimas: []
        };

        for (const dep of deposits) {
            try {
                const data = JSON.parse(dep.answer || '{}');
                stats.palavras += (data.keywords || []).length;
                stats.emojis.push(...(data.emojis || []));
                if (data.phrase) stats.frases++;
                stats.nomes.push(...(data.mentions || []));
                stats.girias.push(...(data.speechPatterns || []));
                stats.ultimas.push({
                    pergunta: dep.question?.substring(0, 60),
                    resposta: data.answer?.substring(0, 60),
                    data: dep.timestamp
                });
            } catch (e) {}
        }

        // Remover duplicados
        stats.emojis = [...new Set(stats.emojis)].slice(0, 20);
        stats.nomes = [...new Set(stats.nomes)].slice(0, 10);
        stats.girias = [...new Set(stats.girias)];
        stats.ultimas = stats.ultimas.slice(-5);

        return stats;
    }
}

module.exports = AutoLearn;