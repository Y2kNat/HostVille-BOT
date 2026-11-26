'use strict';

const fs = require('fs');
const path = require('path');
const { TranscriptArchive } = require('../utils/TranscriptArchive');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'ticketKbCache.json');
const MOST_ASKED_FILE = path.join(__dirname, '..', 'data', 'mostAsked.json');

class TicketKB {
    static _load(file) {
        try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; }
        catch (e) { return {}; }
    }
    static _save(file, data) {
        try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) {}
    }

    /**
     * Extrai pares pergunta/resposta do transcript de um ticket.
     * Quem abriu o ticket (ticket.userId) é quem pergunta; os demais
     * (staff/bot) são as respostas.
     */
    static extract(channelId, ticket) {
        const msgs = TranscriptArchive.get(channelId);
        const pairs = [];
        let q = null;
        let a = '';
        const openerId = ticket && ticket.userId;
        for (const m of msgs) {
            const text = (m.content || '').trim()
                || (m.embedsRaw || []).map(e => [e.titulo, e.descricao].filter(Boolean).join(' ')).join(' ').trim();
            if (!text) continue;
            const isOpener = openerId && m.authorId === openerId;
            if (isOpener) {
                if (q && a.trim()) pairs.push({ pergunta: q, resposta: a.trim() });
                q = text;
                a = '';
            } else if (q) {
                a = a ? a + '\n' + text : text;
            }
        }
        if (q && a.trim()) pairs.push({ pergunta: q, resposta: a.trim() });
        return pairs;
    }

    /**
     * Armazena o ticket+respostas em cache, atualiza o ranking das mensagens
     * mais perguntadas e alimenta o ChatMemory para o Auto-KB minerar.
     */
    static record(channelId, ticket, pairs) {
        if (!pairs || !pairs.length) return;

        // cache do ticket
        const cache = this._load(CACHE_FILE);
        const key = String((ticket && ticket.number) || channelId);
        cache[key] = {
            number: ticket && ticket.number,
            channelId,
            userId: ticket && ticket.userId,
            pairs,
            createdAt: Date.now(),
        };
        this._save(CACHE_FILE, cache);

        // ranking das perguntas mais frequentes
        const asked = this._load(MOST_ASKED_FILE);
        for (const p of pairs) {
            const k = String(p.pergunta || '').toLowerCase().trim().slice(0, 120);
            if (!k) continue;
            if (!asked[k]) asked[k] = { count: 0, exemplo: p.pergunta };
            asked[k].count++;
        }
        // mantém só os 100 mais frequentes
        const entries = Object.entries(asked).sort((a, b) => b[1].count - a[1].count).slice(0, 100);
        const trimmed = {};
        for (const [k, v] of entries) trimmed[k] = v;
        this._save(MOST_ASKED_FILE, trimmed);

        // dispara um ciclo do Auto-KB (em background) para propor documento
        try {
            const { AutoKB } = require('./AutoKB');
            setTimeout(() => { AutoKB.run({ post: true }).catch(() => {}); }, 5000);
        } catch (e) {}

        // alimenta ChatMemory para o Auto-KB minerar
        try {
            const ChatMemory = require('./ChatMemory');
            const canal = 'ticket-' + ((ticket && ticket.number) || channelId);
            const nome = (ticket && ticket.userTag) || 'user';
            for (const p of pairs) {
                ChatMemory.remember(canal, nome, p.pergunta);
                ChatMemory.remember(canal, 'HostBot', p.resposta);
            }
        } catch (e) {}
    }
}

module.exports = TicketKB;
