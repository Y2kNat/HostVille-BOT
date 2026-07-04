const config = require('../config');
const { logModeration, logError } = require('../utils/logger');

const spamTracker = new Map();

class SpamManager {
    static checkSpam(message) {
        const now = Date.now();
        const userSpam = spamTracker.get(message.author.id) || { timestamps: [], lastContent: '' };
        
        userSpam.timestamps = userSpam.timestamps.filter(t => now - t < config.SPAM.TIME_WINDOW);
        userSpam.timestamps.push(now);
        
        // Verificar spam por volume
        if (userSpam.timestamps.length > config.SPAM.MAX_MESSAGES) {
            spamTracker.delete(message.author.id);
            return { isSpam: true, type: 'volume' };
        }
        
        // Verificar spam por conteúdo repetido
        if (userSpam.lastContent && message.content.length > 5) {
            const similarity = message.content.toLowerCase() === userSpam.lastContent.toLowerCase() ? 1 : 0;
            if (similarity === 1) {
                spamTracker.delete(message.author.id);
                return { isSpam: true, type: 'content' };
            }
        }
        
        userSpam.lastContent = message.content;
        spamTracker.set(message.author.id, userSpam);
        return { isSpam: false };
    }

    static async handleSpam(message) {
        try {
            await message.delete().catch(() => {});
            await message.member.timeout(config.SPAM.MUTE_DURATION, 'Spam detectado (HostVille • BOT)');
            
            const spamMsg = await message.channel.send(`${message.author} foi silenciado por 1 minuto por spam.`);
            setTimeout(async () => { try { await spamMsg.delete(); } catch (e) {} }, 10000);
            
            logModeration('Anti-spam ativado', message.author, message.content, message.channel, 'spam');
        } catch (err) {
            logError(`Erro no anti-spam: ${err.message}`);
        }
    }
}

module.exports = SpamManager;