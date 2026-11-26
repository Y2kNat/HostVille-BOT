const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const db = require('../database/db');
const fs = require('fs');
const path = require('path');
const TicketDenuncias = require('./TicketDenuncias');
const TicketSuporte = require('./TicketSuporte');
const TicketDuvidas = require('./TicketDuvidas');
const TicketAtendimento = require('./TicketAtendimento');
const { sendLog } = require('../utils/realtime');
const { TranscriptArchive } = require('../utils/TranscriptArchive');

const activeSessions = new Map();
// o override existe para os testes: nenhum teste deve tocar no registro real
const TICKET_CHANNELS_FILE = process.env.TICKET_CHANNELS_FILE
    || path.join(__dirname, '..', 'data', 'ticketChannels.json');

function loadTicketChannels() {
    try {
        if (!fs.existsSync(TICKET_CHANNELS_FILE)) return {};
        return JSON.parse(fs.readFileSync(TICKET_CHANNELS_FILE, 'utf8')) || {};
    } catch (e) {
        console.error('❌ Erro ao ler registro de tickets:', e.message);
        return {};
    }
}

function saveTicketChannels(channels) {
    try {
        const dir = path.dirname(TICKET_CHANNELS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const tmp = TICKET_CHANNELS_FILE + '.tmp-' + process.pid;
        fs.writeFileSync(tmp, JSON.stringify(channels, null, 2));
        fs.renameSync(tmp, TICKET_CHANNELS_FILE);
    } catch (e) {
        console.error('❌ Erro ao salvar registro de tickets:', e.message);
    }
}

function getSessionCategory(category) {
    return category === 'denuncias' || category === 'suporte' || category === 'duvidas' ? category : 'atendimento';
}

class TicketManager {
    /** Canais de log de abertura e fechamento de tickets. */
    static LOG_OPEN = '1467592262123782196';   // ╭︰꒰📩・open-log-tickets
    static LOG_CLOSE = '1468098233996808346';  // ╰︰꒰📩・closed-log-tickets

    /** Onde o arquivo da transcricao e arquivado (outro servidor). */
    static ARQUIVO_GUILD = '1519076712413925416';   // Administração HostVille
    static ARQUIVO_CHANNEL = '1521717074240602262'; // #admin

    /** Emoji exibido no campo "Tipo de Ticket" do embed de abertura. */
    static TIPO_EMOJI = {
        denuncias: '🚨', denuncia: '🚨',
        suporte: '🛠️',
        duvidas: '❓', duvida: '❓',
        atendimento: '🎧',
        registro: '📝',
        utilityverifyblue: '🔵', registroazul: '🔵',
    };


    // ============================================================
    // IA LIGADA/DESLIGADA POR TICKET
    // Staff pode desligar a resposta automática num ticket específico
    // (ex.: conversaYRosefando com a equipe) sem mexer na IA do servidor.
    // ============================================================
    static ticketAi = {};              // guildId -> { channelId: true }
    static ticketAiAt = 0;
    static TICKET_AI_TTL = 2 * 60 * 1000;

    static async refreshTicketAi(force = false) {
        const now = Date.now();
        if (!force && now - this.ticketAiAt < this.TICKET_AI_TTL) return this.ticketAi;
        try {
            const db = require('../database/db');
            if (typeof db.getTicketAi !== 'function') return this.ticketAi;
            for (const g of Object.keys(db)) {
                try { this.ticketAi[g] = await db.getTicketAi(g); } catch (e) { /* sem config */ }
            }
            this.ticketAiAt = now;
        } catch (e) { /* banco fora: segue com o cache */ }
        return this.ticketAi;
    }

    /** Sessão ativa do canal, ou null. A Map é de módulo: este é o acesso
     *  oficial para quem precisar consultar/ajustar a sessão de fora. */
    static getSession(channelId) {
        return activeSessions.get(channelId) || null;
    }

    /** A IA responde neste ticket? (padrão: sim) */
    static isAiEnabled(guildId, channelId) {
        const map = this.ticketAi[guildId];
        if (!map) return true;
        return !map[String(channelId)];
    }

    static async setTicketAi(guildId, channelId, disabled) {
        const db = require('../database/db');
        const map = await db.setTicketAi(guildId, channelId, disabled);
        this.ticketAi[guildId] = map;
        this.ticketAiAt = Date.now();
        return map;
    }

    /**
     * Recarregar sessões de tickets ativos após restart do bot.
     * Garante permanência: mesmo se o bot desligar, os canais que ficaram
     * "ativo" no registro continuam respondendo com a IA.
     */
    static async restoreSessionsForGuild(guild) {
        // BUG CORRIGIDO: esta função roda no startup, e o cache de canais do
        // Discord ainda pode estar VAZIO nesse momento. Antes, "não achei no
        // cache" era tratado como "o canal não existe mais" e o registro era
        // apagado — foi assim que o ticket #0027 sumiu do ticketChannels.json
        // num restart. Agora só removemos depois de confirmar na API.
        const cacheAquecido = guild.channels && guild.channels.cache && guild.channels.cache.size > 0;
        if (!cacheAquecido) {
            // Cache frio: agenda uma segunda tentativa. Descartar agora
            // perderia o ticket; esperar resolve sem risco.
            if (!this._restoreTentativas) this._restoreTentativas = new Map();
            const tentativas = (this._restoreTentativas.get(guild.id) || 0) + 1;

            if (tentativas <= 5) {
                this._restoreTentativas.set(guild.id, tentativas);
                sendLog(
                    '⏳ Cache de canais vazio em ' + guild.name +
                    ' — nova tentativa de restaurar tickets em 10s (tentativa ' + tentativas + '/5)',
                    'info', 'tickets'
                );
                setTimeout(() => {
                    this.restoreSessionsForGuild(guild).catch(() => {});
                }, 10000);
                return;
            }

            // Esgotou as tentativas: mantém o registro como está. Perder o
            // ticket é bem pior do que manter um registro obsoleto, que a
            // staff corrige apagando o canal.
            this._restoreTentativas.delete(guild.id);
            sendLog(
                '⚠️ Não consegui confirmar os tickets de ' + guild.name +
                ' após 5 tentativas — mantive os registros (ninguém foi apagado)',
                'warn', 'tickets'
            );
            return;
        }
        this._restoreTentativas?.delete(guild.id);

        const channels = loadTicketChannels();
        for (const [channelId, reg] of Object.entries(channels)) {
            if (reg.status !== 'ativo') continue;
            if (reg.guildId !== guild.id) continue;
            let channel = guild.channels.cache.get(channelId);

            if (!channel) {
                // Não está no cache: confirma na API antes de remover.
                // 404 = realmente deletado pela staff. Outro erro (sem
                // permissão, API fora) NÃO pode apagar o registro.
                let confirmadoAusente = false;
                try {
                    await guild.channels.fetch(channelId);
                } catch (err) {
                    const code = err && (err.code ?? err.status);
                    const msg = String((err && err.message) || '');
                    if (code === 10003 || code === 10004 || code === 404 || /unknown channel|not found/i.test(msg)) {
                        confirmadoAusente = true;
                    } else {
                        sendLog(
                            '⚠️ Não consegui confirmar se o ticket #' + String(reg.number).padStart(4, '0') +
                            ' existe (' + (err && err.message) + ') — mantive o registro',
                            'warn', 'tickets'
                        );
                    }
                }

                if (confirmadoAusente) {
                    // canal deletado com o bot offline: o registro sai e o
                    // número volta para o contador
                    await this.removeTicketChannel(channelId);
                }
                continue;
            }
            const session = activeSessions.get(channelId);
            if (session) continue;
            // não reativa ticket já assumido pela staff
            let claimed = false;
            try {
                const t = await db.getTicket(channelId);
                if (t && t.claimedBy) claimed = true;
            } catch (e) {}
            if (claimed) continue;
            activeSessions.set(channelId, {
                state: 'active',
                step: 1,
                userId: reg.userId,
                guildId: reg.guildId,
                category: getSessionCategory(reg.category)
            });
        }
    }

    static async restoreSessions(client) {
        // era sincrono e devolvia um numero, mas o caller faz await: o await
        // nao esperava nada e o log "restauradas" saia antes do trabalho
        let restored = 0;
        for (const guild of client.guilds.cache.values()) {
            const before = activeSessions.size;
            await this.restoreSessionsForGuild(guild);
            restored += activeSessions.size - before;
        }
        return restored;
    }

    static async registerTicketChannel(channelId, data) {
        const channels = loadTicketChannels();
        channels[channelId] = {
            status: 'ativo',
            category: data.category,
            number: data.number,
            guildId: data.guildId,
            userId: data.userId,
            createdAt: data.createdAt,
            closedAt: null
        };
        saveTicketChannels(channels);
        // o arquivo passou a ser a fonte da numeração: libera a reserva
        // para ela não virar um número fantasma que empurra a contagem
        this.releaseTicketNumber(data.number);
    }

    static async deactivateTicketChannel(channelId) {
        try {
            const TicketQueue = require('./TicketQueue');
            TicketQueue.cancel(channelId, { removerRefs: true });
        } catch (e) {}
        const channels = loadTicketChannels();
        if (channels[channelId]) {
            channels[channelId].status = 'desativado';
            channels[channelId].closedAt = Date.now();
            saveTicketChannels(channels);
        }
    }

    static async isTicketChannelActive(channelId) {
        const channels = loadTicketChannels();
        return channels[channelId]?.status === 'ativo';
    }

    // ============================================================
    // NUMERAÇÃO DOS TICKETS
    //
    // A contagem mora em data/ticketChannels.json, e a entrada do ticket
    // é REMOVIDA quando o canal é apagado. Efeito: apagar o ticket #0027
    // libera o 27, e apagar todos os tickets volta a contagem para #0001.
    //
    // Antes o número vivia no Mongo (doc TICKET_COUNTER), que só cresce —
    // por isso a contagem só subia e nunca voltava.
    // ============================================================

    /**
     * Números já distribuídos mas ainda não gravados no arquivo (o canal
     * do Discord é criado entre a reserva e o registro). Sem isso, dois
     * tickets abertos no mesmo instante sairiam com o mesmo número.
     */
    static _reservados = new Set();

    /** Maior número presente no arquivo de registro. */
    static _maxNumberInFile() {
        const channels = loadTicketChannels();
        let max = 0;
        for (const reg of Object.values(channels)) {
            const n = parseInt(reg && reg.number, 10);
            if (Number.isFinite(n) && n > max) max = n;
        }
        return max;
    }

    /**
     * Reserva o próximo número de ticket.
     *
     * Regra: enquanto existir ticket registrado, o próximo é o maior + 1.
     * Sem nenhum ticket, volta para 1. Não tem await no meio de propósito:
     * o event loop do Node roda o bloco inteiro de uma vez, então dois
     * tickets abertos no mesmo instante nunca recebem o mesmo número.
     */
    static nextTicketNumber() {
        let max = this._maxNumberInFile();
        for (const n of this._reservados) if (n > max) max = n;

        const proximo = max === 0 ? 1 : max + 1;
        this._reservados.add(proximo);
        return proximo;
    }

    /** Libera a reserva: o número já está no arquivo, que passa a valer. */
    static releaseTicketNumber(number) {
        this._reservados.delete(parseInt(number, 10));
    }

    /** Esse número já foi gravado no arquivo de registro? */
    static isTicketRegistered(number) {
        const alvo = parseInt(number, 10);
        if (!Number.isFinite(alvo)) return false;
        return Object.values(loadTicketChannels())
            .some((reg) => parseInt(reg && reg.number, 10) === alvo);
    }

    /**
     * Apaga o registro do ticket. Usado quando o canal não existe mais:
     * é o que devolve o número para o contador.
     */
    static async removeTicketChannel(channelId) {
        const channels = loadTicketChannels();
        const reg = channels[channelId];
        if (!reg) return false;
        delete channels[channelId];
        saveTicketChannels(channels);
        this.releaseTicketNumber(reg.number);
        return true;
    }

    static async getTicketChannelStatus(channelId) {
        const channels = loadTicketChannels();
        return channels[channelId] || null;
    }

    /**
     * Canais fechados pelo /close (ou botao). O channelDelete chega alguns
     * segundos depois, quando o bot apaga o canal; sem este registro ele
     * confundiria a delecao automatica com uma delecao manual da staff e
     * geraria a transcricao duas vezes.
     */
    static _closedByBot = new Map();

    static markClosedByBot(channelId, data) {
        this._closedByBot.set(String(channelId), { ...data, em: Date.now() });
        // limpeza de seguranca: entradas velhas nao podem vazar memoria
        if (this._closedByBot.size > 500) {
            const corte = Date.now() - 30 * 60 * 1000;
            for (const [k, v] of this._closedByBot) {
                if (v.em < corte) this._closedByBot.delete(k);
            }
        }
    }

    /** Consome o registro: true se o bot deletou o canal. */
    static consumeClosedByBot(channelId) {
        const k = String(channelId);
        const info = this._closedByBot.get(k);
        if (info) this._closedByBot.delete(k);
        return info || null;
    }

    static async handleChannelDeleted(channel) {
        try {
            const TicketQueue = require('./TicketQueue');
            TicketQueue.cancel(channel.id, { removerRefs: true });
        } catch (e) {}
        // consome o marcador ANTES de olhar o registro: se o registro já
        // tiver sumido, sair aqui sem consumir deixava a entrada na
        // memória para sempre (vazamento, um por ticket fechado)
        const fechadoPeloBot = this.consumeClosedByBot(channel.id);
        const registry = await this.getTicketChannelStatus(channel.id);
        if (!registry) {
            activeSessions.delete(channel.id);
            return false;
        }

        // O bot acabou de fechar este ticket: a transcricao JA foi enviada e o
        // embed JA foi publicado. Nao ha nada a fazer aqui.
        if (fechadoPeloBot) {
            await this.deactivateTicketChannel(channel.id);
            activeSessions.delete(channel.id);
            try { await db.closeTicket(channel.id); } catch (e) {}
            sendLog(
                '🗑️ Canal do ticket #' + String(registry.number).padStart(4, '0') +
                ' removido pelo bot (fechamento já registrado)',
                'info', 'tickets'
            );
            await this.removeTicketChannel(channel.id);
            return true;
        }

        console.log(`🗑️ Canal de ticket deletado manualmente: ${channel.name} (#${String(registry.number).padStart(4, '0')})`);

        // Extrai Q&A do transcript e alimenta a KB automatica (antes do cleanup)
        try {
            const TicketKB = require('./TicketKB');
            const t = await db.getTicket(channel.id).catch(() => null);
            const ticket = t || { userId: registry.userId, number: registry.number, userTag: registry.userTag };
            const pares = TicketKB.extract(channel.id, ticket);
            TicketKB.record(channel.id, ticket, pares);
        } catch (e) { console.error('[TicketKB] channelDelete:', e && e.message); }

        // O canal JA foi deletado: o historico nao pode ser lido do Discord.
        // Por isso usamos o arquivo de mensagens accumulated pelo messageCreate.
        const transcriptsOn = await TranscriptArchive.isEnabled(channel.guild.id);
        if (!transcriptsOn) TranscriptArchive.cleanup(channel.id);

        let resumo = null;
        try {
            if (transcriptsOn) {
                const querResumo = await db.getTranscriptAiStatus(channel.guild.id);
                resumo = querResumo
                    ? await TranscriptArchive.resumir(channel.id, { guildId: channel.guild.id })
                    : TranscriptArchive.resumoHeuristico(TranscriptArchive.get(channel.id));
            }
        } catch (e) {}

        let arquivo = null;
        try {
            if (!transcriptsOn) throw new Error('transcricoes desligadas');
            arquivo = TranscriptArchive.buildHtml(channel.id, {
                number: registry.number,
                category: registry.category,
                userId: registry.userId,
                userTag: registry.userTag,
                channelName: channel.name,
                channelId: channel.id,
                guildId: channel.guild.id,
            }, {
                motivo: 'Canal deletado manualmente',
                closedBy: 'Sistema',
                openedAt: registry.createdAt || null,
                servidor: channel.guild?.name || null,
                resumo,
            });
        } catch (e) {
            console.error('Erro ao gerar PDF no channelDelete:', e.message);
        }

        await this.deactivateTicketChannel(channel.id);
        activeSessions.delete(channel.id);
        try { await db.closeTicket(channel.id); } catch (e) {}

        // arquivo de referencia no canal de arquivo (outro servidor)
        const transcricaoUrl = arquivo
            ? await this.arquivarTranscricao(arquivo, {
                ticket: { number: registry.number, category: registry.category, userId: registry.userId, channelName: channel.name },
                motivo: 'Canal deletado manualmente',
                closedBy: 'Sistema',
                resumo,
            })
            : null;

        // publica a transcrição no canal de logs, se houver
        if (arquivo) {
            try {
                const conn = await db.getConnection(channel.guild.id);
                const logChannel = channel.guild.channels.cache.get(this.LOG_CLOSE)
                    || (conn?.logChannelId ? channel.guild.channels.cache.get(conn.logChannelId) : null);
                if (logChannel) {
                        let porAutor = [];
                        if (arquivo.stats?.porAutor?.size) {
                            porAutor = [...arquivo.stats.porAutor.values()]
                                .map(({ tag, count, authorId }) => ({
                                    tag: authorId ? `<@${authorId}>` : tag,
                                    count,
                                }))
                                .sort((a, b) => b.count - a.count);
                        } else {
                            const c = await db.getConnection(channel.guild.id);
                            porAutor = await this.contarMensagens(channel, {
                                ownerId: registry.userId,
                                staffRoleId: c?.staffRoleId,
                            });
                        }

                        const embed = this.buildCloseEmbed({
                            number: registry.number,
                            category: registry.category,
                            userId: registry.userId,
                            channelName: channel.name,
                            channelId: channel.id,
                            guildId: channel.guild.id,
                        }, {
                            motivo: 'Canal deletado manualmente',
                            closedByTag: 'Sistema',
                            openedAt: registry.createdAt || null,
                            endedAt: new Date(),
                            porAutor,
                            transcricaoUrl,
                        });
                        const payload = { embeds: [embed] };
                        if (typeof transcricaoUrl === 'string' && transcricaoUrl.startsWith('https://')) {
                            payload.components = [{
                                type: 1,
                                components: [{ type: 2, style: 5, label: '📄 Baixar HTML', url: transcricaoUrl }],
                            }];
                        }
                        await logChannel.send(payload);
                }
            } catch (e) { /* canal pode ter sumido tambem */ }
        } else {
            // sem buffer nao ha PDF; descarta o que sobrou
            try { TranscriptArchive.cleanup(channel.id); } catch (e) {}
        }

        // registro removido só aqui, no fim: o número volta para o contador e
        // o próximo ticket reaproveita esta numeração
        await this.removeTicketChannel(channel.id);
        sendLog('🗑️ Canal do ticket #' + String(registry.number).padStart(4, '0') + ' deletado manualmente' + (arquivo ? ' | transcrição arquivada' : '') + ' | número liberado', 'warn', 'tickets');
        return true;
    }

    static async createTicket(interaction, category) {
        const guild = interaction.guild;
        const user = interaction.user;
        const connection = await db.getConnection(guild.id);
        if (!connection) {
            if (interaction.deferred) return interaction.editReply({ content: '❌ Sistema não configurado.' });
            return interaction.reply({ content: '❌ Sistema não configurado.', flags: 64 });
        }

        const ticketNumber = this.nextTicketNumber();
        const categoryNames = { denuncias: 'denuncia', suporte: 'suporte', duvidas: 'duvida' };
        const shortName = categoryNames[category] || category;
        const channelName = `🎫・${shortName}-${ticketNumber.toString().padStart(4, '0')}`;

        try {
            const ticketChannel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: '1466936076366118912',
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                ]
            });

            await db.addTicket(ticketChannel.id, {
                guildId: guild.id, channelId: ticketChannel.id, userId: user.id,
                category, number: ticketNumber, createdAt: Date.now(), status: 'open', claimedBy: null
            });

            await this.registerTicketChannel(ticketChannel.id, {
                guildId: guild.id, userId: user.id,
                category, number: ticketNumber, createdAt: Date.now()
            });

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('ticket_close').setLabel('Fechar Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
                new ButtonBuilder().setCustomId('ticket_claim').setLabel('Assumir').setStyle(ButtonStyle.Primary).setEmoji('🙋')
            );

            const roleMention = connection?.staffRoleId ? `<@&${connection.staffRoleId}>` : '';
            await ticketChannel.send({ content: `${user} ${roleMention}`, components: [buttons] });
            await this.startAutoAttendant(ticketChannel, user, guild.id);
            
            await this.logTicketOpen(guild, {
                number: ticketNumber,
                channelName: ticketChannel.name,
                channelId: ticketChannel.id,
                guildId: guild.id,
                category,
                userId: user.id,
                createdAt: Date.now(),
            });

            sendLog('🎫 Ticket #' + String(ticketNumber).padStart(4, '0') + ' criado por ' + user.username + ' | ' + category, 'info', 'tickets');

            const msg = { content: `✅ Ticket criado: ${ticketChannel}` };
            if (interaction.deferred) return interaction.editReply(msg);
            return interaction.reply({ ...msg, flags: 64 });
        } catch (error) {
            // se o ticket não chegou a ser registrado, o número reservado
            // volta para o contador (senão a contagem pula um número)
            if (!this.isTicketRegistered(ticketNumber)) this.releaseTicketNumber(ticketNumber);
            console.error('❌ ERRO TICKET:', error.message);
            sendLog('❌ Erro ao criar ticket: ' + error.message, 'error', 'system');
            const msg = { content: '❌ Erro ao criar ticket.' };
            if (interaction.deferred) return interaction.editReply(msg);
            return interaction.reply({ ...msg, flags: 64 });
        }
    }

    static async startAutoAttendant(channel, user, guildId) {
        const ticket = await db.getTicket(channel.id);
        const category = ticket?.category || 'suporte';

        if (category === 'denuncias') {
            await TicketDenuncias.start(channel, user, guildId);
            activeSessions.set(channel.id, { state: 'active', step: 0, userId: user.id, guildId, category: 'denuncias' });
        } else if (category === 'suporte') {
            await TicketSuporte.start(channel, user, guildId);
            activeSessions.set(channel.id, { state: 'active', step: 0, userId: user.id, guildId, category: 'suporte' });
        } else if (category === 'duvidas') {
            await TicketDuvidas.start(channel, user, guildId);
            activeSessions.set(channel.id, { state: 'active', step: 0, userId: user.id, guildId, category: 'duvidas' });
        } else if (category === 'atendimento') {
            await TicketAtendimento.start(channel, user, guildId);
            activeSessions.set(channel.id, { state: 'active', step: 0, userId: user.id, guildId, category: 'atendimento' });
        }
    }

    static async processAutoAttendant(message) {
        try {
            const Features = require('./FeatureRegistry');
            if (!Features.ligadoSync('atendente_auto', message.guild?.id)) return false;
        } catch (e) { /* registry indisponível: mantém o comportamento */ }

        let session = activeSessions.get(message.channel.id);

        // Sessão sumiu? Recria a partir do registro (auto-cura pós-restart)
        if (!session) {
            try {
                const reg = await this.getTicketChannelStatus(message.channel.id);
                const ticket = await db.getTicket(message.channel.id);
                const claimed = ticket?.claimedBy;
                if (reg?.status === 'ativo' && reg.userId === message.author.id && !claimed) {
                    session = {
                        state: 'active',
                        step: 1,
                        userId: reg.userId,
                        guildId: reg.guildId,
                        category: getSessionCategory(reg.category)
                    };
                    activeSessions.set(message.channel.id, session);
                }
            } catch (e) {
                console.error('[ticket] falha na auto-cura:', e.message);
            }
        }

        // Denúncia concluída ainda roteia pro process, que avisa que já foi registrada.
        const doneDenuncia = session && session.category === 'denuncias' && session.state === 'done';
        if (!session || message.author.id !== session.userId || session.claimedBy || (session.state === 'done' && !doneDenuncia)) {
            return false;
        }
        if (!(await this.isTicketChannelActive(message.channel.id))) {
            return false;
        }

        // Guarda referência da mensagem no disco: se o bot cair/desligar antes de
        // responder, ela é re-respondida no próximo boot (mesmo fluxo do chat global).
        if (!message._viaQueue) {
            try {
                const QueueManager = require('./QueueManager');
                QueueManager.enqueueRef(message, { ticket: true });
            } catch (e) { /* não impede o atendimento */ }
        }

        try {
            const QueueManager = require('./QueueManager');
            QueueManager.markRefInFlight(message.id);
        } catch (e) { /* protege contra a fila reprocessar enquanto respondemos */ }

        // Enfileira na fila do ticket (debounce/coalescência) em vez de
        // processar direto. A IA é chamada uma vez por lote.
        try {
            const TicketQueue = require('./TicketQueue');
            TicketQueue.enqueue(message, session, (lote) => this._processTicketBatch(lote));
        } catch (e) {
            console.error('[ticket] falha ao enfileirar:', e.message);
        }
        return true;
    }

    /**
     * Processa um lote de mensagens de ticket (debounce/coalescência).
     * Chamado por TicketQueue quando o debounce expira.
     */
    static async _processTicketBatch(lote) {
        if (!Array.isArray(lote) || !lote.length) return;
        const session = (lote[lote.length - 1].session) || lote[0].session;
        const messages = lote.map(x => x.message);
        const channel = messages[0].channel;

        // Lote só de saudação: resposta pronta, sem IA.
        const GREETING = /^\s*(oi|ola|olá|eai|e ai|salve|bom dia|boa tarde|boa noite|opa|hey|hi|hello|fala|beleza|blz|tudo bem|td bem|tudo bom)[!?.\s]*$/i;
        const allGreeting = messages.every(m => GREETING.test(String(m.content || '').trim()));
        if (allGreeting) {
            try { await channel.send('Olá! 👋 Como posso ajudar?'); } catch (e) {}
            for (const m of messages) {
                try { const QM = require('./QueueManager'); QM.removeRefByMessage(m.id); } catch (e) {}
            }
            return;
        }

        // IA desligada neste ticket: não gera resposta, chama a staff.
        const usaIA = session.category !== 'denuncias';
        if (usaIA && !TicketManager.isAiEnabled(session.guildId, channel.id)) {
            if (!session.aiAvisou) {
                session.aiAvisou = true;
                try {
                    const conn = await db.getConnection(session.guildId);
                    const aviso = '🤖 A resposta automática está desligada neste ticket. A equipe vai te responder por aqui.';
                    await channel.send(conn?.staffRoleId ? `${aviso}\n<@&${conn.staffRoleId}>` : aviso).catch(() => {});
                } catch (e) {}
            }
            for (const m of messages) {
                try { const QM = require('./QueueManager'); QM.removeRefByMessage(m.id); } catch (e) {}
            }
            return;
        }

        // Mensagem combinada: shallow clone com content unificado.
        const base = messages[0];
        const combined = {
            content: messages.map(m => m.content || '').join('\n'),
            channel: base.channel,
            author: base.author,
            client: base.client,
            guild: base.guild,
            id: base.id,
            createdTimestamp: base.createdTimestamp,
            attachments: base.attachments,
            embeds: base.embeds,
            reference: base.reference,
            _viaQueue: true,
        };

        let delivered = true;
        try {
            if (session.category === 'denuncias') {
                await TicketDenuncias.process(combined, session);
            } else if (session.category === 'suporte') {
                await TicketSuporte.process(combined, session);
            } else if (session.category === 'duvidas') {
                await TicketDuvidas.process(combined, session);
            } else if (session.category === 'atendimento') {
                await TicketAtendimento.process(combined, session);
            }
        } catch (e) {
            delivered = false;
            console.error(`[ticket] ERRO ao processar ${session.category}:`, e);
        }

        if (delivered) {
            for (const m of messages) {
                try { const QM = require('./QueueManager'); QM.removeRefByMessage(m.id); } catch (e) {}
            }
        }
    }

    /**
     * Transcricao legada em .txt.
     *
     * Mantida apenas como fallback para quando o PDF falha por erro tecnico.
     * NUNCA gera arquivo quando as transcricoes estao desligadas no servidor
     * e NUNCA e chamada pelo /close nesse caso.
     */
    static async saveTranscript(channel) {
        try {
            // guarda explicita: nao grava nada se o servidor desativou
            if (!(await TranscriptArchive.isEnabled(channel.guild.id))) return null;

            const ticket = await db.getTicket(channel.id);
            if (!ticket) return null;

            let transcript = `=== Ticket #${String(ticket.number).padStart(4, '0')} ===\n`;
            transcript += `Categoria: ${ticket.category}\nUsuário: ${ticket.userId}\n`;
            transcript += `Aberto: ${new Date(ticket.createdAt).toLocaleString('pt-BR')}\n${'='.repeat(40)}\n\n`;
            try {
                const messages = await channel.messages.fetch({ limit: 100 });
                Array.from(messages.values()).reverse().forEach(msg => {
                    transcript += `[${msg.createdAt.toLocaleString('pt-BR')}] ${msg.author.tag}: ${msg.content || '[Mídia]'}\n`;
                });
            } catch (e) {}

            const dir = path.join(__dirname, '..', 'transcripts');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const filename = `ticket-${ticket.number}-${Date.now()}.txt`;
            const filepath = path.join(dir, filename);
            fs.writeFileSync(filepath, transcript);
            return { path: filepath, content: transcript, filename };
        } catch (e) {
            return null;
        }
    }
    static async contarMensagens(channel, { ownerId = null, staffRoleId = null } = {}) {
        try {
            const todas = await channel.messages.fetch({ limit: 100 });
            const contagem = new Map();

            for (const msg of todas.values()) {
                if (msg.author.bot) continue; // embeds automaticos nao contam
                const id = msg.author.id;
                const atual = contagem.get(id) || { count: 0, staff: false };
                atual.count++;
                // staff = tem o cargo da equipe
                if (staffRoleId && msg.member?.roles?.cache?.has(staffRoleId)) {
                    atual.staff = true;
                }
                contagem.set(id, atual);
            }

            // staff primeiro, depois maior volume; dono do ticket por ultimo
            return [...contagem.entries()]
                .map(([id, { count, staff }]) => ({
                    tag: `<@${id}>`,
                    count,
                    staff: staff || (ownerId ? id === ownerId : false),
                }))
                .sort((a, b) => {
                    if (a.staff !== b.staff) return a.staff ? -1 : 1;
                    return b.count - a.count;
                });
        } catch (e) {
            return [];
        }
    }

    /**
     * Monta o embed de ticket ABERTO.
     * @param {object} ticket { number, channelName, category, userId, createdAt }
     * @param {object} extras  { staffId, motivo }
     */
    static buildOpenEmbed(ticket, { staffId = null, motivo = null } = {}) {
        const num = String(ticket.number).padStart(4, '0');
        const emoji = this.TIPO_EMOJI[String(ticket.category || '').toLowerCase()];
        const rotulo = ticket.category || 'suporte';

        const embed = new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle('Ticket Aberto')
            .addFields(
                {
                    name: 'Nome do Ticket',
                    value: this.linkTicket(ticket, num),
                    inline: true,
                },
                { name: 'Criado Por', value: ticket.userId ? `<@${ticket.userId}>` : '—', inline: true },
                {
                    name: 'Data de Abertura',
                    value: ticket.createdAt
                        ? new Date(ticket.createdAt).toLocaleString('pt-BR', {
                            day: 'numeric', month: 'long', year: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                        })
                        : '—',
                    inline: true,
                },
                { name: 'Tipo de Ticket', value: `${emoji || '🎫'} ${rotulo}`, inline: true },
            )
            .setFooter({ text: `HostVille • Ticket #${num}` })
            .setTimestamp();

        if (staffId) {
            embed.addFields({ name: 'Aberto por', value: `<@${staffId}>`, inline: true });
        }
        if (motivo) {
            embed.addFields({ name: 'Motivo', value: motivo.slice(0, 1024), inline: false });
        }

        return embed;
    }

    /**
     * Nome do ticket como link para o canal.
     * Sem guildId devolve o nome em texto puro, para nunca quebrar o embed.
     */
    static linkTicket(ticket, num) {
        const nome = ticket.channelName || `ticket-${num}`;
        const gid = ticket.guildId;
        if (!gid || !ticket.channelId) return nome;
        return `[${nome}](https://discord.com/channels/${gid}/${ticket.channelId})`;
    }

    /**
     * Envia o arquivo da transcricao no canal de arquivo e devolve a URL.
     * Se nao conseguir, devolve null e o embed segue sem link.
     */
    static async arquivarTranscricao(arquivo, { ticket, motivo, closedBy, resumo }) {
        try {
            const client = global.client;
            if (!client) return null;

            let canal = client.channels.cache.get(this.ARQUIVO_CHANNEL);
            if (!canal) {
                const g = await client.guilds.fetch(this.ARQUIVO_GUILD).catch(() => null);
                canal = g ? await g.channels.fetch(this.ARQUIVO_CHANNEL).catch(() => null) : null;
            }
            if (!canal) return null;

            const num = String(ticket?.number ?? 0).padStart(4, '0');
            const embed = new EmbedBuilder()
                .setColor(0xd4af37)
                .setTitle(`📄 Transcrição — Ticket #${num}`)
                .addFields(
                    { name: 'Ticket', value: ticket?.channelName || `ticket-${num}`, inline: true },
                    { name: 'Autor', value: ticket?.userTag || (ticket?.userId ? `<@${ticket.userId}>` : '—'), inline: true },
                    { name: 'Fechado por', value: closedBy || '—', inline: true },
                    { name: 'Motivo', value: motivo ? String(motivo).slice(0, 1024) : '⚠️ não informado', inline: false },
                )
                .setFooter({ text: 'HostVille • transcrição arquivada' })
                .setTimestamp();

            if (resumo?.problema) {
                embed.addFields({
                    name: 'Resumo',
                    value: `**Problema:** ${String(resumo.problema).slice(0, 400)}
**Solução:** ${String(resumo.solucao || '—').slice(0, 400)}`,
                    inline: false,
                });
            }

            const msg = await canal.send({
                embeds: [embed],
                files: [{ attachment: arquivo.path, name: arquivo.filename, description: `Transcrição do ticket #${num}` }],
            });
            return msg.attachments.first()?.url || null;
        } catch (e) {
            console.error('Erro ao arquivar transcrição:', e.message);
            return null;
        }
    }

    /** Publica o embed de ticket aberto no canal de log. Nunca bloqueia o fluxo. */
    static async logTicketOpen(guild, ticket, extras = {}) {
        try {
            const canal = guild.channels.cache.get(this.LOG_OPEN);
            if (!canal) return false;
            await canal.send({ embeds: [this.buildOpenEmbed(ticket, extras)] });
            return true;
        } catch (e) {
            console.error('Erro ao logar ticket aberto:', e.message);
            return false;
        }
    }

    /**
     * Monta o embed de ticket fechado no formato solicitado.
     */
    static buildCloseEmbed(ticket, { motivo, closedByTag, closedById, openedAt, endedAt, porAutor, semTranscricao = false, transcricaoUrl = null }) {
        const num = String(ticket.number).padStart(4, '0');
        const fmt = d => d.toLocaleString('pt-BR', {
            day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
        });

        const embed = new EmbedBuilder()
            .setColor(0xd4af37)
            .setTitle('Ticket Fechado')
            .addFields(
                {
                    name: 'Nome do Ticket',
                    value: this.linkTicket(ticket, num),
                    inline: true,
                },
                { name: 'Autor do Ticket', value: ticket.userId ? `<@${ticket.userId}>` : (ticket.userTag || '—'), inline: true },
                { name: 'Fechado por', value: closedById ? `<@${closedById}>` : closedByTag || '—', inline: true },
                { name: 'Data de Abertura', value: openedAt ? fmt(new Date(openedAt)) : '—', inline: true },
                { name: 'Data de encerramento', value: endedAt ? fmt(new Date(endedAt)) : '—', inline: true },
                { name: 'Motivo para fechar o Ticket', value: motivo ? `${String(motivo).slice(0, 1024)}` : '⚠️ **não informado**', inline: false },
            );

        // Contagem de mensagens por staff
        if (porAutor && porAutor.length) {
            const linhas = porAutor
                .slice(0, 20)
                .map(({ tag, count }) => `[ ${count} ] - ${tag}`);
            embed.addFields({ name: 'Contagem de Mensagens Staff', value: linhas.join('\n').slice(0, 1024), inline: false });
        }

        // Transcricao: so aparece se existe PDF de verdade para baixar.
        // Com /transcript off nao ha arquivo, entao nao ha link nem botao.
        if (semTranscricao) {
            embed.addFields({ name: 'Transcrição', value: '🔕 Desativada neste servidor (`/transcript off`)', inline: false });
        } else if (transcricaoUrl) {
            embed.addFields({
                name: 'Transcrição',
                value: `[💬 Ver transcrição completa](${transcricaoUrl})`,
                inline: false,
            });
        }

        return embed;
    }

    static async closeTicket(channel, closer, motivo) {
        // O motivo é OBRIGATÓRIO. É ele que explica o fechamento no embed de
        // log e no arquivo de transcrição, então "Não informado" não serve:
        // um ticket fechado sem justificativa não deixa rastro de por quê.
        const motivoLimpo = String(motivo || '').trim();
        if (motivoLimpo.length < 3) {
            throw new Error('motivo do fechamento é obrigatório (mínimo 3 caracteres)');
        }
        motivo = motivoLimpo;

        try {
            const ticket = await db.getTicket(channel.id);
            if (!ticket) return;

            // Extrai Q&A do transcript e alimenta a KB automatica (antes do cleanup)
            try {
                const TicketKB = require('./TicketKB');
                const pares = TicketKB.extract(channel.id, ticket);
                TicketKB.record(channel.id, ticket, pares);
            } catch (e) { console.error('[TicketKB] close:', e && e.message); }

            activeSessions.delete(channel.id);
            try {
                const TicketQueue = require('./TicketQueue');
                TicketQueue.cancel(channel.id, { removerRefs: true });
            } catch (e) {}
            await this.deactivateTicketChannel(channel.id);

            const openedAt = ticket.createdAt || null;
            const endedAt = new Date();

            // Gera o PDF a partir do arquivo de mensagens (o canal ainda existe,
            // mas preferimos o buffer por causa dos embeds do bot).
            const transcriptsOn = await TranscriptArchive.isEnabled(channel.guild.id);

            // txt legado: se a transcricao esta desligada, o bot ainda envia o .txt antigo
            if (!transcriptsOn) {
                TranscriptArchive.cleanup(channel.id);
            }

            let resumo = null;
            try {
                if (transcriptsOn) {
                    const querResumo = await db.getTranscriptAiStatus(channel.guild.id);
                    resumo = querResumo
                        ? await TranscriptArchive.resumir(channel.id, { guildId: channel.guild.id })
                        : TranscriptArchive.resumoHeuristico(TranscriptArchive.get(channel.id));
                }
            } catch (e) {}

            let transcricao = null;
            try {
                if (!transcriptsOn) throw new Error('transcricoes desligadas');
                transcricao = TranscriptArchive.buildHtml(channel.id, {
                    number: ticket.number,
                    category: ticket.category,
                    userId: ticket.userId,
                    userTag: ticket.userTag,
                    channelName: channel.name,
                    channelId: channel.id,
                    guildId: channel.guild.id,
                }, {
                    motivo,
                    closedBy: closer?.tag || '—',
                    closedById: closer?.id,
                    openedAt,
                    servidor: channel.guild?.name || null,
                    resumo,
                });
            } catch (e) {
                console.error('Erro ao gerar PDF da transcrição:', e.message);
            }

            // txt legado so como fallback quando o PDF falhou por erro tecnico.
            // Se as transcricoes estao DESLIGADAS, nao gera nada.
            let transcript = null;
            if (!transcricao && transcriptsOn) transcript = await this.saveTranscript(channel);

            await db.closeTicket(channel.id);

            sendLog('🔒 Ticket #' + String(ticket.number).padStart(4, '0') + ' fechado por ' + (closer?.tag || '?') + ' | ' + ticket.category, 'warn', 'tickets');

            const arquivo = transcricao || transcript;

            // Contagem de mensagens: usa as stats do PDF quando existe,
            // senao conta direto do Discord (funciona com transcricoes off).
            let porAutor = [];
            if (transcricao?.stats?.porAutor?.size) {
                porAutor = [...transcricao.stats.porAutor.values()]
                    .map(({ tag, count, authorId }) => ({
                        tag: authorId ? `<@${authorId}>` : tag,
                        count,
                        bot: false,
                    }))
                    .sort((a, b) => b.count - a.count);
            } else {
                const connPreto = await db.getConnection(channel.guild.id);
                porAutor = await this.contarMensagens(channel, {
                    ownerId: ticket.userId,
                    staffRoleId: connPreto?.staffRoleId,
                });
            }
            const conn = await db.getConnection(channel.guild.id);
            // canal dedicado de fechamento; se nao existir, cai no configurado
            const logChannel = channel.guild.channels.cache.get(this.LOG_CLOSE)
                || (conn?.logChannelId ? channel.guild.channels.cache.get(conn.logChannelId) : null);

            // manda o arquivo para o canal de arquivo e usa a URL no embed
            const transcricaoUrl = arquivo
                ? await this.arquivarTranscricao(arquivo, { ticket, motivo, closedBy: closer?.tag, resumo })
                : null;

            if (!logChannel) {
                sendLog('⚠️ Ticket #' + String(ticket.number).padStart(4, '0') + ' fechado sem canal de log', 'warn', 'system');
            } else {
                try {
                    if (!arquivo) {
                        // sem transcricao: embed apenas, sem botao e sem link
                        await logChannel.send({
                            embeds: [this.buildCloseEmbed(ticket, {
                                motivo,
                                closedByTag: closer?.tag,
                                closedById: closer?.id,
                                openedAt,
                                endedAt,
                                porAutor,
                                semTranscricao: true,
                            })],
                        });
                    } else {
                        // O arquivo JA foi enviado no canal de arquivo; aqui
                        // publica so o embed, com o link para aquele anexo.
                        const embed = this.buildCloseEmbed(
                            { ...ticket, channelId: channel.id, guildId: channel.guild.id },
                            {
                                motivo,
                                closedByTag: closer?.tag,
                                closedById: closer?.id,
                                openedAt,
                                endedAt,
                                porAutor,
                                transcricaoUrl,
                            }
                        );

                        const payload = { embeds: [embed] };
                        // botao so com URL valida do arquivo arquivado
                        if (typeof transcricaoUrl === 'string' && transcricaoUrl.startsWith('https://')) {
                            payload.components = [{
                                type: 1,
                                components: [{
                                    type: 2,
                                    style: 5,          // 5 = Link (transparente)
                                    label: '📄 Baixar HTML',
                                    url: transcricaoUrl,
                                }],
                            }];
                        }

                        await logChannel.send(payload);
                    }
                } catch (e) {
                    console.error('Erro ao enviar log do ticket:', e.message);
                }
            }

            // fecha na hora: o marcador precisa estar gravado ANTES do delete,
            // senão o channelDelete chega antes e arquiva a transcrição duas vezes
            this.markClosedByBot(channel.id, {
                number: ticket.number,
                category: ticket.category,
                userId: ticket.userId,
                motivo,
                closedBy: closer?.tag || '—',
                closedById: closer?.id,
                openedAt,
            });
            try {
                // o motivo vai para o audit log do Discord, então astaff
                // descobre o motivo de um ticket deletado olhando o log do canal
                await channel.delete(`Ticket #${String(ticket.number).padStart(4, '0')} fechado — ${motivo.slice(0, 100)}`);
            } catch (e) {
                // canal continua aberto: avisa para a staff não ficar sem saber
                await channel.send('❌ **Ticket fechado, mas não consegui deletar este canal:** ' + e.message).catch(() => {});
            }
        } catch (e) {
            console.error('Erro ao fechar:', e.message);
            sendLog('❌ Erro ao fechar ticket: ' + e.message, 'error', 'system');
        }
    }

    static async claimTicket(channel, staff) {
        const ticket = await db.getTicket(channel.id);
        if (!ticket || ticket.claimedBy) { await channel.send('❌ Já assumido.'); return false; }
        await db.claimTicket(channel.id, staff.id);
        activeSessions.delete(channel.id);
        try {
            const TicketQueue = require('./TicketQueue');
            TicketQueue.cancel(channel.id, { removerRefs: true });
        } catch (e) {}
        await channel.send({ embeds: [new EmbedBuilder().setColor(0x5865F2).setDescription(`🙋 ${staff} assumiu o atendimento.`)] });
        sendLog('🙋 Ticket #' + String(ticket.number).padStart(4, '0') + ' assumido por ' + staff.user.tag, 'info', 'tickets');
        return true;
    }

    static async createTicketForUser(interaction, targetUser, motivo) {
        const guild = interaction.guild;
        const staff = interaction.user;
        const connection = await db.getConnection(guild.id);
        if (!connection) {
            if (interaction.deferred) return interaction.editReply({ content: '❌ Sistema não configurado.' });
            return interaction.reply({ content: '❌ Sistema não configurado.', flags: 64 });
        }

        const ticketNumber = this.nextTicketNumber();
        const channelName = `🎫・atendimento-${ticketNumber.toString().padStart(4, '0')}`;

        try {
            const ticketChannel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: '1466936076366118912',
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: targetUser.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                    { id: connection?.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                ]
            });

            await db.addTicket(ticketChannel.id, {
                guildId: guild.id, channelId: ticketChannel.id, userId: targetUser.id,
                category: 'atendimento', number: ticketNumber, createdAt: Date.now(), status: 'open', claimedBy: null
            });

            await this.registerTicketChannel(ticketChannel.id, {
                guildId: guild.id, userId: targetUser.id,
                category: 'atendimento', number: ticketNumber, createdAt: Date.now()
            });

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('ticket_close').setLabel('Fechar Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
                new ButtonBuilder().setCustomId('ticket_claim').setLabel('Assumir').setStyle(ButtonStyle.Primary).setEmoji('🙋')
            );

            const roleMention = connection?.staffRoleId ? `<@&${connection.staffRoleId}>` : '';
            const motivoEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🎓 Atendimento Aberto')
                .setDescription(`**Staff:** ${staff}\n**Motivo:** ${motivo}`)
                .setTimestamp();

            await ticketChannel.send({ content: `${targetUser} ${roleMention}`, embeds: [motivoEmbed], components: [buttons] });
            await this.startAutoAttendant(ticketChannel, targetUser, guild.id);

            await this.logTicketOpen(guild, {
                number: ticketNumber,
                channelName: ticketChannel.name,
                channelId: ticketChannel.id,
                guildId: guild.id,
                category: 'atendimento',
                userId: targetUser.id,
                createdAt: Date.now(),
            }, { staffId: staff.id, motivo });

            sendLog('🎓 Atendimento #' + String(ticketNumber).padStart(4, '0') + ' aberto por ' + staff.tag + ' para ' + targetUser.tag + ' | ' + motivo, 'info', 'tickets');

            const msg = { content: `✅ Atendimento criado para ${targetUser}: ${ticketChannel}`, flags: 64 };
            if (interaction.deferred) return interaction.editReply(msg);
            return interaction.reply(msg);
        } catch (error) {
            // mesmo tratamento do createTicket: numero reservado e nao
            // registrado volta para o contador
            if (!this.isTicketRegistered(ticketNumber)) this.releaseTicketNumber(ticketNumber);
            console.error('❌ ERRO ATENDIMENTO:', error.message);
            sendLog('❌ Erro ao criar atendimento: ' + error.message, 'error', 'system');
            const msg = { content: '❌ Erro ao criar atendimento.' };
            if (interaction.deferred) return interaction.editReply(msg);
            return interaction.reply({ ...msg, flags: 64 });
        }
    }

    static delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = TicketManager;