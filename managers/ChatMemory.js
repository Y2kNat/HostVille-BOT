const fs = require('fs');
const path = require('path');

const memoryPath = path.join(__dirname, '..', 'data', 'chatMemory.json');

class ChatMemory {

    static load() {
        try {
            if (fs.existsSync(memoryPath)) {
                return JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
            }
        } catch (e) {}
        return {};
    }

    static save(data) {
        fs.writeFileSync(memoryPath, JSON.stringify(data, null, 2));
    }

    static remember(userId, message) {
        const memory = this.load();
        if (!memory[userId]) memory[userId] = { messages: [], lastSeen: null, personality: 'normal' };
        memory[userId].messages.push({
            content: message.substring(0, 200),
            timestamp: Date.now()
        });
        // Manter só últimas 50 mensagens
        if (memory[userId].messages.length > 50) {
            memory[userId].messages = memory[userId].messages.slice(-50);
        }
        memory[userId].lastSeen = Date.now();
        this.save(memory);
    }

    static getHistory(userId) {
        const memory = this.load();
        return memory[userId]?.messages || [];
    }

    static getPersonality(channelName) {
        const personalities = {
            'denuncia': 'SÉRIO e PROFISSIONAL. Sem gírias.',
            'suporte': 'ATENCIOSO e TÉCNICO. Gírias moderadas.',
            'duvida': 'AMIGÁVEL e DIDÁTICO. Gírias liberadas.',
            'bate-papo': 'ZOEIRO e CARISMÁTICO. Gírias pesadas.',
            'chat': 'ZOEIRO e CARISMÁTICO. Gírias pesadas.',
            'geral': 'ZOEIRO e CARISMÁTICO. Gírias pesadas.'
        };

        for (const [key, personality] of Object.entries(personalities)) {
            if (channelName.includes(key)) return personality;
        }
        return 'NATURAL e AMIGÁVEL. Gírias moderadas.';
    }
}

module.exports = ChatMemory;
