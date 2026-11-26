'use strict';

const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const QUEUE_FILE = path.join(__dirname, '..', 'data', 'responseQueue.json');

/**
 * Fila de respostas persistida em JSON (data/responseQueue.json).
 *
 * O bot pode ENFILEIRAR respostas que "quer dar" em vez de enviar na hora:
 *   - enfileirar para um canal específico (channelId)
 *   - enfileirar para vários canais (channelIds)
 *   - broadcast: enviar em todos os canais de texto válidos de uma guild
 *
 * O QueueManager.start(client) roda um loop que drena a fila e envia as
 * mensagens na ordem. Fica tudo salvo em disco → sobrevive a restart.
 */
class QueueManager {

    static MAX_RETRIES = 3;
    static INTERVAL_MS = 5000;

    // Filtro de canais "seguros" para broadcast (texto, sem threads, com permissão)
    static broadcastChannelPrefilter(channel) {
        if (!channel || typeof channel.isTextBased !== 'function') return false;
        if (!channel.isTextBased()) return false;
        if (typeof channel.isThread === 'function' && channel.isThread()) return false;
        try {
            if (!channel.permissionsFor(channel.guild.members.me).has('SendMessages')) return false;
        } catch (e) {
            return false;
        }
        return true;
    }

    // ============================================
    // DISCO (arquivo JSON)
    // ============================================
    static load() {
        try {
            if (fs.existsSync(QUEUE_FILE)) {
                const raw = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
                return Array.isArray(raw) ? raw : [];
            }
        } catch (e) {}
        return [];
    }

    static save(items) {
        try {
            fs.writeFileSync(QUEUE_FILE, JSON.stringify(items, null, 2));
        } catch (e) {
            console.error('QueueManager: erro ao salvar fila:', e.message);
        }
    }

    // ============================================
    // ENQUEUE
    // ============================================
    /**
     * Adicionar uma resposta à fila.
     * @param {Object} item
     * @param {string}   [item.channelId]  - canal de destino
     * @param {string[]} [item.channelIds] - vários canais de destino
     * @param {string}   [item.guildId]    - guild para broadcast
     * @param {boolean}  [item.broadcast]  - enviar em todos os canais de texto da guild
     * @param {string}   [item.content]    - texto da mensagem
     * @param {Object}   [item.embed]      - dados do embed (EmbedBuilder payload)
     * @param {number}   [item.sendAfter]  - ms para aguardar antes de enviar
     * @returns {string} id da entrada na fila
     */
    static enqueue(item) {
        const items = this.load();
        const entry = {
            id: 'q_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            type: item.type || 'message',
            channelId: item.channelId || null,
            channelIds: Array.isArray(item.channelIds) ? item.channelIds : null,
            guildId: item.guildId || null,
            broadcast: !!item.broadcast,
            content: item.content || null,
            embed: item.embed || null,
            question: item.question || null,
            userId: item.userId || null,
            maxRetries: item.maxRetries || null,
            createdAt: Date.now(),
            sendAfter: Date.now() + (item.sendAfter || 0),
            attempts: 0,
            status: 'pending'
        };
        items.push(entry);
        this.save(items);
        console.log(`📥 Enfileirado ${entry.id} → ${entry.broadcast ? 'broadcast ' : ''}${entry.channelId || (entry.channelIds ? entry.channelIds.length + ' canais' : entry.guildId || '?')}`);
        return entry.id;
    }

    // ============================================
    // INSPEÇÃO / MANUTENÇÃO
    // ============================================
    static list() { return this.load(); }

    static size() { return this.load().length; }

    static clearAll() { this.save([]); }

    static remove(id) {
        this.save(this.load().filter(i => i.id !== id));
    }

    // ============================================
    // REFERÊNCIA DE MENSAGEM (message_ref)
    // Guarda o ID de uma mensagem que chamou o bot e AINDA NÃO FOI RESPONDIDA.
    // Se o bot cair/crashar antes de responder, o ID fica salvo aqui; ao ligar
    // de novo, ele busca essa mensagem no Discord, responde e remove.
    // ============================================
    static enqueueRef(message, opts = {}) {
        if (!message || !message.id) return null;
        const items = this.load();
        if (items.some(i => i.type === 'message_ref' && i.messageId === message.id)) return null;
        const entry = {
            id: 'q_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            type: 'message_ref',
            channelId: message.channel.id,
            guildId: message.guild ? message.guild.id : null,
            messageId: message.id,
            userId: message.author.id,
            ticket: !!opts.ticket,
            createdAt: Date.now(),
            sendAfter: Date.now() + (opts.sendAfter || 300000),
            attempts: 0,
            maxRetries: 8,
            status: 'pending'
        };
        items.push(entry);
        this.save(items);
        return entry.id;
    }

    static removeRefByMessage(messageId) {
        const items = this.load();
        const before = items.length;
        const rest = items.filter(i => !(i.type === 'message_ref' && i.messageId === messageId));
        if (rest.length !== before) this.save(rest);
    }

    static markRefInFlight(messageId) {
        const items = this.load();
        let changed = false;
        for (const i of items) {
            if (i.type === 'message_ref' && i.messageId === messageId) {
                i.inFlightAt = Date.now();
                changed = true;
            }
        }
        if (changed) this.save(items);
    }

    static _isInFlight(entry) {
        return !!entry.inFlightAt && (Date.now() - entry.inFlightAt) < 180000;
    }

    static clearInFlightFlags() {
        const items = this.load();
        let changed = false;
        for (const i of items) {
            if (i.inFlightAt) {
                delete i.inFlightAt;
                changed = true;
            }
        }
        if (changed) this.save(items);
        return changed;
    }

    static releaseOldRefsOnBoot() {
        const items = this.load();
        let changed = false;
        const agora = Date.now();
        for (const i of items) {
            if (i.type !== 'message_ref') continue;
            if (i.status === 'done' || i.status === 'failed') continue;
            if (agora - (i.createdAt || 0) < 60000) continue;
            i.sendAfter = 0;
            changed = true;
        }
        if (changed) this.save(items);
        return changed;
    }

    // ============================================
    // ENVIO
    // ============================================
    static async _resolveChannels(client, entry) {
        const channels = [];

        // B25: `client.channels.cache` é o cache GLOBAL do client — contém
        // canais de todos os servidores, mais DMs e threads. Só o caminho
        // broadcast usava `guild.channels`, e os caminhos de ID explícito
        // não filhavam nada.
        //
        // O ID vem de `<#(\d+)>` digitado pelo usuário na mensagem
        // (TaskRunner.executeAction, caso 'enviar'), e `enviar` não estava
        // na lista de ações que exigem permissão. Então: um membro escreve
        // <#id> texto, o bot enfileira, e MAX_RETRIES=3 tenta 3 vezes. Se o
        // ID for de outro servidor onde o bot esteja, a mensagem é entregue
        // lá.
        //
        // A regra: sem `entry.guildId` não há como provar que um canal é da
        // nossa guild, então não se envia. Isso vale para `channelId` e
        // `channelIds` — o filtro de guild precisa existir em TODO caminho,
        // não só no broadcast.
        const guild = entry.guildId ? client.guilds?.cache?.get(entry.guildId) : null;

        /** O canal pertence à guild da entrada? */
        const pertence = (ch) => !!ch && !!guild && ch.guildId === guild.id
            && typeof ch.send === 'function';

        if (entry.channelId) {
            const ch = client.channels.cache.get(entry.channelId);
            if (pertence(ch)) channels.push(ch);
        }

        if (Array.isArray(entry.channelIds)) {
            for (const id of entry.channelIds) {
                const ch = client.channels.cache.get(id);
                if (pertence(ch) && !channels.some(ex => ex.id === id)) channels.push(ch);
            }
        }

        if (entry.broadcast && guild) {
            const extra = guild.channels.cache.filter(c =>
                this.broadcastChannelPrefilter(c) && !channels.some(ex => ex.id === c.id)
            );
            const list = [...extra.values()];
            // limite de sanidade para broadcast
            channels.push(...list.slice(0, 8));
        }

        return channels;
    }

    static async _sendOnce(client, entry) {
        const channels = await this._resolveChannels(client, entry);

        // sem nenhum canal válido → descarta (não dá retry infinito)
        if (channels.length === 0) return { ok: false, retry: false };

        const messageOpts = { content: entry.content || undefined };
        if (entry.embed) {
            try {
                messageOpts.embeds = [new EmbedBuilder(entry.embed)];
            } catch (e) {
                messageOpts.embeds = undefined;
            }
        }

        let anySent = false;
        for (const ch of channels) {
            try {
                await ch.send(messageOpts);
                anySent = true;
            } catch (e) {
                // canal sem permissão / mensagem recusada → tenta o próximo
            }
        }

        if (!anySent) return { ok: false, retry: true };
        return { ok: true };
    }

    // ============================================
    // ENVIO DE RESPOSTA DE IA (ai_reply)
    // Chamada que o bot não conseguiu responder na hora fica na fila.
    // Quando ele voltar a conseguir (ex.: a IA de volta), responde e sai da fila.
    // ============================================
    static async _sendAiReplyOnce(client, entry) {
        const channel = entry.channelId ? client.channels.cache.get(entry.channelId) : null;
        if (!channel || typeof channel.send !== 'function') return { ok: false, retry: false };

        const kilo = require('./KiloClient');
        const prompt = `Você é o HostBot, robô BRASILEIRO. Responda DIRETAMENTE o que foi perguntado, sem rodeios, sem gírias ("mano", "pô", "tá ligado"). Português brasileiro, tom natural. Máximo 3 linhas.`;

        let answer;
        try {
            answer = await kilo.chat({
                messages: [{ role: 'system', content: prompt }, { role: 'user', content: entry.question || 'Oi' }],
                temperature: 0.7,
                max_tokens: 512
            });
        } catch (e) {
            // IA indisponível no momento → tenta de novo no próximo ciclo
            return { ok: false, retry: true };
        }

        if (!answer) answer = '🤔 Não consegui responder...';

        const mention = entry.userId ? `<@${entry.userId}> ` : '';
        try {
            await channel.send({ content: mention + answer });
            return { ok: true };
        } catch (e) {
            return { ok: false, retry: true };
        }
    }

    static async _alreadyAnswered(channel, entry) {
        let target = null;
        try {
            target = await channel.messages.fetch(entry.messageId);
        } catch (e) {
            return true;
        }
        if (!target) return true;
        try {
            const recent = await channel.messages.fetch({ limit: 20 });
            const botId = channel.client.user.id;
            const PENSANDO = /^\s*-?#?\s*pensando\b/i;
            for (const m of recent.values()) {
                if (m.author && m.author.bot && m.author.id === botId && m.createdTimestamp > target.createdTimestamp) {
                    const content = m.content || '';
                    const hasEmbeds = !!(m.embeds && (typeof m.embeds.size === 'number' ? m.embeds.size : (Array.isArray(m.embeds) ? m.embeds.length : 0)));
                    // ignora placeholder "Pensando..." sem conteúdo real
                    if (PENSANDO.test(content) && !hasEmbeds) continue;
                    return true;
                }
            }
        } catch (e) {
            return false;
        }
        return false;
    }

    // ============================================
    // RESPOSTA DE MENSAGEM ANTERIOR (message_ref)
    // Busca a mensagem pelo ID salvo e RESPONDE de novo.
    // Usado quando o bot caiu/desligou antes de responder.
    // ============================================
    static async _sendMessageRefOnce(client, entry) {
        const channel = entry.channelId ? client.channels.cache.get(entry.channelId) : null;
        if (!channel || typeof channel.send !== 'function') return { ok: false, retry: false };

        let msg;
        try {
            msg = await channel.messages.fetch(entry.messageId);
        } catch (e) {
            // mensagem apagada ou canal sem acesso → nada a responder
            return { ok: false, retry: false };
        }

        if (!msg || msg.author.bot) return { ok: false, retry: false };
        if (msg.author.id !== entry.userId) return { ok: false, retry: false };

        if (await this._alreadyAnswered(channel, entry)) {
            return { ok: true };
        }

        // Reconstrói o despacho REAL (mesmo prompt + knowledge + fluxo do LIVE),
        // para a resposta sair igual à original — nunca o DEFAULT_PROMPT puro.
        msg._viaQueue = true;

        try {
            if (entry.ticket) {
                const TicketManager = require('./TicketManager');
                await TicketManager.processAutoAttendant(msg);
            } else {
                const ChatManager = require('./ChatManager');
                await ChatManager.respondToMessage(msg);
            }

            // Se o ref ainda existe após o despacho → a resposta NÃO foi entregue
            // (erro interno engolido, IA fora, sessão inválida...). Mantém na fila.
            const stillPending = this.load().some(i => i.type === 'message_ref' && i.messageId === entry.messageId);
            return stillPending ? { ok: false, retry: true } : { ok: true };
        } catch (e) {
            // IA ou Discord fora no momento → tenta de novo no próximo ciclo
            return { ok: false, retry: true };
        }
    }

    // ============================================
    // PROCESSADOR EM LOOP
    // ============================================
    static start(client) {
        this.clearInFlightFlags();
        if (this.releaseOldRefsOnBoot()) {
            console.log('🔄 Fila: mensagens antigas liberadas para resposta imediata');
        }

        setInterval(async () => {
            try {
                // Manutenção ativa → pausa a fila (entradas ficam pendentes)
                if (require('./MaintenanceManager').isEnabled()) return;

                const items = this.load();
                if (items.length === 0) return;

                let changed = false;
                const rest = [];

                for (const entry of items) {
                    if (entry.status === 'done' || entry.status === 'failed') continue;

                    if (this._isInFlight(entry)) {
                        rest.push(entry);
                        continue;
                    }

                    if (Date.now() < (entry.sendAfter || 0)) {
                        rest.push(entry);
                        continue;
                    }

                    const maxRetries = entry.maxRetries || this.MAX_RETRIES;

                    let res;
                    if (entry.type === 'ai_reply') {
                        res = await this._sendAiReplyOnce(client, entry);
                    } else if (entry.type === 'message_ref') {
                        res = await this._sendMessageRefOnce(client, entry);
                    } else {
                        res = await this._sendOnce(client, entry);
                    }

                    if (res && res.ok) {
                        console.log(`✅ Fila enviada: ${entry.id}`);
                        changed = true;
                        continue;
                    }

                    entry.attempts = (entry.attempts || 0) + 1;
                    if (!res.retry || entry.attempts > maxRetries) entry.status = 'failed';
                    rest.push(entry);
                    changed = true;
                }

                if (changed) this.save(rest);
            } catch (e) {
                console.error('QueueManager:', e.message);
            }
        }, this.INTERVAL_MS);
    }
}

module.exports = QueueManager;