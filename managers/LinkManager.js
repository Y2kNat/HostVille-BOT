const { inviteRegex, urlRegex } = require('../data/offensiveWords');
const db = require('../database/db');

class LinkManager {
    static containsInvite(text) {
        inviteRegex.lastIndex = 0;
        return inviteRegex.test(text);
    }

    static containsLink(text) {
        urlRegex.lastIndex = 0;
        return urlRegex.test(text);
    }

    static getLinks(text) {
        urlRegex.lastIndex = 0;
        const matches = [];
        let match;
        while ((match = urlRegex.exec(text)) !== null) matches.push(match[0]);
        return matches;
    }

    static async checkLink(message) {
        const linkConfig = await db.getLinkSettings();
        
        // Verificar convites do Discord
        if (this.containsInvite(message.content) && linkConfig.deleteInvites) {
            return { block: true, reason: 'convite Discord' };
        }
        
        // Verificar links externos
        if (this.containsLink(message.content) && linkConfig.allowedDomains.length > 0) {
            const links = this.getLinks(message.content);
            let blocked = false;
            
            for (const url of links) {
                try {
                    const hostname = new URL(url).hostname;
                    if (!linkConfig.allowedDomains.includes(hostname)) {
                        blocked = true;
                        break;
                    }
                } catch (e) {
                    blocked = true;
                    break;
                }
            }
            
            if (blocked) {
                return { block: true, reason: 'link externo' };
            }
        }
        
        return { block: false };
    }

    static async handleLinkBlock(message, reason) {
        try {
            await message.delete().catch(() => {});
            const msg = await message.channel.send(
                `${message.author}, ${reason === 'convite Discord' ? 'convites de outros servidores não são permitidos.' : 'links externos não são permitidos.'}`
            );
            setTimeout(async () => { try { await msg.delete(); } catch (e) {} }, 10000);
        } catch (err) {}
    }
}

module.exports = LinkManager;