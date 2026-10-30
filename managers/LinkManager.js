const { inviteRegex, urlRegex } = require('../data/offensiveWords');
const db = require('../database/db');
// B26: reaproveita o mapa de homóglifos do normalizador em vez de manter
// uma cópia aqui. A do LinkManager cobria um subconjunto e a do
// normalizador é a que o filtro de palavra usa — duas listas divergentes
// para o mesmo problema é como um dos dois caminhos fica para trás.
const { dobrarHomoglifo } = require('../utils/moderation/normalizer');

const ZERO_WIDTH = /[-‍⁠﻿]/g;

/**
 * Canonicaliza o texto para o teste de convite.
 *
 * Cobre o que o regex sozinho não pega:
 *   - percent-encoding: `%64` -> `d` (o `discord.gg/%64iscord` responde
 *     301 igual ao canônico, confirmado em rede em 30/09)
 *   - homóglifos cirílicos: `disсord` com C cirílico
 *   - invisíveis e acentos
 *
 * A ordem importa: decodifica o percent-encoding ANTES de dobrar o
 * homóglifo, senão o byte já viraria letra antes de ser decodificado.
 */
function canonicalizar(texto) {
    let s = String(texto || '');
    s = s.replace(ZERO_WIDTH, '');
    s = s.replace(/%[0-9a-f]{2}/gi, (m) => {
        try { return decodeURIComponent(m); } catch (e) { return m; }
    });
    s = dobrarHomoglifo(s);
    s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.toLowerCase();
}

class LinkManager {
    static containsInvite(text) {
        // Testa o texto cru E o canonicalizado: o primeiro preserva a forma
        // original (o regex é o que sabe o que é separador tolerado), o
        // segundo pega o que o encoding e o homóglifo escondem.
        inviteRegex.lastIndex = 0;
        if (inviteRegex.test(String(text || ''))) return true;
        inviteRegex.lastIndex = 0;
        return inviteRegex.test(canonicalizar(text));
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

    /**
     * @param {Message} message
     * @param {string} [guildId]  escopo da config de link. Sem ele, o filtro
     *   cai no global legacy — o comportamento de sempre, mas por acidente.
     */
    static async checkLink(message, guildId) {
        const escopo = guildId || message?.guild?.id;
        const linkConfig = await db.getLinkSettings(escopo);

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