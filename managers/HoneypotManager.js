const { EmbedBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { logInfo, logWarn, logError, logSuccess } = require('../utils/logger');
const { isStaff, isAdmin } = require('../utils/permissions');

/**
 * HoneypotManager — canal-armadilha.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * O QUE É
 * ═══════════════════════════════════════════════════════════════════════
 * Um canal que NÃO deve receber mensagem nenhuma. O bot posta um aviso
 * explicando isso. Quem mandar mensagem ali (e não for isento) é banido na
 * hora, tem as mensagens apagadas, recebe uma DM e o staff recebe um alerta
 * com exatamente o que foi enviado — texto e mídia (imagem/vídeo), com a
 * mídia salva em outro canal para não expirar.
 *
 * A graça: um canal-armadilha só é pisado por quem não deveria estar ali. É
 * um detector de presença indesejada com efeito imediato — útil contra
 * raids, bots de convite e contas comprometidas que exploram o servidor.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ISENÇÕES
 * ═══════════════════════════════════════════════════════════════════════
 * Dono (OWNER_ID), staff da rede (STAFF_USER_ID) e admins (ADMIN_ROLES) NÃO
 * são punidos: se a staff postar ali por engano, nada acontece. Todo o resto
 * — inclusive outros bots — é banido.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * FLUXO
 * ═══════════════════════════════════════════════════════════════════════
 *  1. Captura o conteúdo (texto + anexos) ANTES de qualquer delete.
 *  2. Apaga a mensagem do honeypot.
 *  3. Bane com deleteMessageSeconds ( Discord apaga até 7 dias de msgs ).
 *  4. Varredura extra best-effort de mensagens antigas (se ligada).
 *  5. Salva a mídia no #admin e monta o embed de alerta (marca @everyone).
 *  6. Manda DM no banido explicando e apontando o dono.
 *  7. logInfo + StatsManager.
 *
 * Lock por usuário: duas mensagens em rajada não geram dois bans.
 */

// Teto de tamanho de anexo que o Discord aceita no envio (não é o limite de
// upload do canal, é o do send). Acima disso o reenvio falha; nesse caso
// guardamos só o link e avisamos que a mídia é grande demais para anexar.
const MAX_ANEXO_BYTES = 25 * 1024 * 1024; // ~25 MB (limite clássico)

/** Usuários sendo processados agora (lock). Evita double-ban em rajada. */
const processando = new Set();

/** Canais já varridos pela varredura extra (evita varrer o mesmo 2x). */
const jaVarri = new Set();

/** Client injetado no boot (para o watchdog buscar canais). */
let _client = null;
/** Último estado do canal-armadilha: 'presente' | 'ausente' | null. */
let _estadoCanal = null;
/** Handle do setInterval do watchdog. */
let _watchdog = null;
/** Lock: já está recriando o canal? Evita recriações concorrentes. */
let _recriando = false;

// ─── ID dinâmico do canal (muda se recriar) ───────────────────────────────
// Recriar um canal gera um NOVO id. Guardamos { channelId, guildId, name } em
// disco para o bot continuar achando o honeypot mesmo após recriar/reiniciar.
const FILE_CANAL = process.env.HONEYPOT_CHANNEL_FILE
    ? path.resolve(process.env.HONEYPOT_CHANNEL_FILE)
    : path.join(__dirname, '..', 'data', 'honeypot-channel.json');

function atomicWrite(file, conteudo) {
    const tmp = file + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, conteudo);
    fs.renameSync(tmp, file);
}

function carregarCanalInfo() {
    try {
        const o = JSON.parse(fs.readFileSync(FILE_CANAL, 'utf8'));
        return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    } catch (e) { return {}; }
}

function salvarCanalInfo(obj) {
    try { atomicWrite(FILE_CANAL, JSON.stringify(obj, null, 2)); }
    catch (e) { logWarn('Honeypot: falha ao gravar honeypot-channel.json: ' + e.message); }
}

let _canalInfo = carregarCanalInfo();

/** ID atual do canal-armadilha (persistido > config). */
function getCanalId() {
    return (_canalInfo && _canalInfo.channelId) || config.HONEYPOT.CHANNEL_ID;
}
/** Guild onde recriar o canal (aprendido do canal real; sem fallback pro staff). */
function getGuildId() {
    return (_canalInfo && _canalInfo.guildId) || null;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

class HoneypotManager {

    /**
     * Chamado no boot: garante que o aviso do canal-armadilha exista e liga o
     * watchdog que monitora se o canal continua existindo.
     *
     * IDEMPOTENTE: só posta UMA vez. Se o embed de aviso já estiver no canal,
     * não faz nada. Se não existir (canal vazio ou o embed foi deletado), limpa
     * o canal e reenvia o aviso. Assim um restart não reposta, e um embed
     * removido por alguém é restaurado no próximo boot.
     *
     * @param {import('discord.js').Client} client
     */
    static async start(client) {
        if (!config.HONEYPOT.ENABLED) return;
        if (!client) return;
        _client = client;
        try {
            const canal = await this.verificarCanal(client);
            if (canal) {
                _estadoCanal = 'presente';
                // Já existe o aviso? Então não reposta (idempotente).
                if (await this.avisoExiste(canal)) {
                    logInfo(`Honeypot: aviso já existe no canal ${getCanalId()} — nada a fazer.`);
                } else {
                    // Não existe (canal vazio ou embed deletado): limpa e reenvia.
                    await this.limparCanal(canal);
                    await canal.send({ embeds: [this.buildIntroEmbed()] });
                    logInfo(`Honeypot: aviso (re)postado no canal ${getCanalId()}.`);
                }
            } else if (canal === undefined) {
                logWarn('Honeypot: não consegui verificar o canal no boot (erro de rede?).');
            } else {
                // canal === null: não existe. Tenta recriar automaticamente.
                logWarn(`Honeypot: canal ${getCanalId()} não encontrado no boot.`);
                _estadoCanal = 'ausente';
                const gid = getGuildId();
                if (gid) {
                    await this.recreateCanal(client, gid, null, 'não encontrado no boot');
                } else {
                    await this.alertarCanalAusente('não foi encontrado no boot (e não sei em qual servidor recriar)');
                }
            }
        } catch (e) {
            logWarn('Honeypot: falha ao postar o aviso: ' + e.message);
        }

        // Watchdog periódico (backup do evento channelDelete).
        this.iniciarWatchdog(client);
    }

    /**
     * Busca o canal-armadilha pelo ID.
     * @returns {Promise<Channel|null|undefined>} canal (existe) | null (não
     *   existe/sem acesso) | undefined (erro de rede — não conclui).
     */
    static async verificarCanal(client) {
        const c = client || _client || global.client;
        if (!c || !c.channels) return undefined;
        const alvo = getCanalId();
        // 1) cache
        let canal = c.channels.cache.get(alvo);
        if (canal) { this._registrarCanalInfo(canal); return canal; }
        // 2) REST (garante que não é só cache vazio)
        try {
            canal = await c.channels.fetch(alvo);
            if (canal) this._registrarCanalInfo(canal);
            return canal || null;
        } catch (e) {
            const code = e && (e.code || (e.rawError && e.rawError.code));
            // 10003 = Unknown Channel, 10004 = Missing Access
            if (code === 10003 || code === 10004) return null;
            return undefined; // erro de rede/transitório: não conclui
        }
    }

    /** Grava { channelId, guildId, name } quando descobre/atualiza o canal. */
    static _registrarCanalInfo(canal) {
        try {
            const gid = (canal.guild && canal.guild.id) || _canalInfo.guildId;
            const nome = canal.name || _canalInfo.name;
            if (canal.id !== _canalInfo.channelId || gid !== _canalInfo.guildId || nome !== _canalInfo.name) {
                _canalInfo = { channelId: canal.id, guildId: gid, name: nome };
                salvarCanalInfo(_canalInfo);
            }
        } catch (e) { /* best-effort */ }
    }

    /**
     * Recria o canal-armadilha automaticamente (no topo, fora de categoria),
     * envia o aviso e atualiza o ID persistido.
     * @returns {Promise<Channel|null>}
     */
    static async recreateCanal(client, guildId, name, motivo) {
        if (_recriando) return null; // já recriando
        _recriando = true;
        try {
            const c = client || _client || global.client;
            if (!c) return null;
            let guild = (c.guilds.cache && c.guilds.cache.get(guildId)) || null;
            if (!guild && c.guilds.fetch) guild = await c.guilds.fetch(guildId).catch(() => null);
            if (!guild || typeof guild.channels?.create !== 'function') {
                logWarn(`Honeypot: não achei o servidor (${guildId}) para recriar o canal.`);
                await this.alertarCanalAusente('e não consegui recriar (servidor não encontrado)');
                return null;
            }
            const nomeFinal = name || _canalInfo.name || '🍯 honey-pot';
            const canal = await guild.channels.create({
                name: nomeFinal,
                type: ChannelType.GuildText,
                parent: null,   // fora de categoria
                position: 0,    // no topo
                reason: 'Honeypot: recriação automática (canal-armadilha deletado)',
            });
            _canalInfo = { channelId: canal.id, guildId: guild.id, name: canal.name };
            salvarCanalInfo(_canalInfo);
            _estadoCanal = 'presente';
            // envia o aviso no canal novo
            try { await canal.send({ embeds: [this.buildIntroEmbed()] }); } catch (e) {}
            logWarn(`Honeypot: canal recriado automaticamente (novo ID ${canal.id}).`);
            await this.alertarCanalRecriado(motivo, canal);
            return canal;
        } catch (e) {
            logError('Honeypot: falha ao recriar o canal: ' + e.message);
            await this.alertarCanalAusente('e não consegui recriar (' + e.message + ')');
            return null;
        } finally {
            _recriando = false;
        }
    }

    /**
     * Checagem única: se o canal sumiu, recria automaticamente (e avisa); se
     * voltou, zera o estado; se existe e o aviso sumiu, reposta o aviso.
     */
    static async checarCanal(client) {
        if (!config.HONEYPOT.ENABLED || !config.HONEYPOT.CHECK_ENABLED) return;
        let canal;
        try {
            canal = await this.verificarCanal(client);
        } catch (e) { return; }

        if (canal) {
            _estadoCanal = 'presente';
            // garante o aviso (reposta se sumiu)
            try {
                if (!await this.avisoExiste(canal)) {
                    await this.limparCanal(canal);
                    await canal.send({ embeds: [this.buildIntroEmbed()] });
                    logInfo('Honeypot: aviso ausente — repostado no canal.');
                }
            } catch (e) { /* best-effort */ }
            return;
        }
        if (canal === undefined) return; // rede: não conclui
        // canal === null: não existe. Recria automaticamente.
        const primeiro = _estadoCanal !== 'ausente';
        _estadoCanal = 'ausente';
        if (primeiro) await this.alertarCanalAusente('foi deletado');
        const gid = getGuildId();
        if (gid) {
            await this.recreateCanal(client, gid, null, primeiro ? 'após deleção' : 'ainda ausente');
        } else if (primeiro) {
            // não sabemos em qual servidor recriar (nunca vimos o canal).
            await this.alertarCanalAusente('e não sei em qual servidor recriar');
        }
    }

    /** Liga o setInterval do watchdog (desliga o anterior, se houver). */
    static iniciarWatchdog(client) {
        if (!config.HONEYPOT.ENABLED || !config.HONEYPOT.CHECK_ENABLED) return;
        if (_watchdog) { try { clearInterval(_watchdog); } catch (e) {} _watchdog = null; }
        const seg = Math.max(3, config.HONEYPOT.CHECK_INTERVAL_SEC || 10);
        _watchdog = setInterval(() => { this.checarCanal(client).catch(() => {}); }, seg * 1000);
        if (_watchdog.unref) _watchdog.unref();
        logInfo(`Honeypot: watchdog do canal ativo (verifica a cada ${seg}s).`);
    }

    /**
     * Evento channelDelete: se o canal deletado for o honeypot, avisa a staff
     * e recria o canal automaticamente (no topo, fora de categoria).
     * @param {import('discord.js').Channel} channel
     */
    static async handleChannelDelete(channel) {
        try {
            if (!config.HONEYPOT.ENABLED) return;
            if (!channel || channel.id !== getCanalId()) return;
            _estadoCanal = 'ausente';
            await this.alertarCanalAusente('foi DELETADO agora');
            // Recria automaticamente (usa o guild/name do canal que acabou de sair).
            const gid = (channel.guild && channel.guild.id) || getGuildId();
            if (gid) {
                await this.recreateCanal(_client || global.client, gid, channel.name, 'foi deletado agora');
            }
        } catch (e) {
            logWarn('Honeypot: erro no handleChannelDelete: ' + e.message);
        }
    }

    /** Envia um embed no canal de alerta da staff (best-effort). */
    static async enviarEmbedStaff(embed) {
        try {
            const client = _client || global.client;
            const canalId = config.HONEYPOT.ALERT_CHANNEL_ID || config.LOG_CHANNEL_ID;
            if (!client || !canalId) return;
            let canal = client.channels.cache.get(canalId);
            if (!canal) {
                const g = config.HONEYPOT.GUILD_ID
                    ? await client.guilds.fetch(config.HONEYPOT.GUILD_ID).catch(() => null)
                    : null;
                canal = g
                    ? await g.channels.fetch(canalId).catch(() => null)
                    : await client.channels.fetch(canalId).catch(() => null);
            }
            if (!canal || !canal.send) {
                logWarn('Honeypot: canal de alerta não encontrado.');
                return;
            }
            await canal.send({ embeds: [embed] });
        } catch (e) {
            logWarn('Honeypot: falha ao avisar a staff: ' + e.message);
        }
    }

    /** Avisa no canal de alerta que o canal-armadilha sumiu. */
    static async alertarCanalAusente(motivo) {
        const embed = new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('⚠️ Canal do Honeypot não encontrado')
            .setDescription(
                `O canal-armadilha (ID: \`${getCanalId()}\`) **${motivo}**.\n\n` +
                'O bot vai tentar **recriar automaticamente**. Se não conseguir (falta de permissão ' +
                '"Gerenciar Canais"), avise a staff.'
            )
            .setFooter({ text: 'HostVille • Honeypot' })
            .setTimestamp();
        await this.enviarEmbedStaff(embed);
        logWarn(`Honeypot: canal ausente — alerta enviado (${motivo}).`);
    }

    /** Avisa no canal de alerta que o canal-armadilha foi recriado. */
    static async alertarCanalRecriado(motivo, canal) {
        const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('✅ Canal do Honeypot recriado')
            .setDescription(
                `O canal-armadilha foi **recriado automaticamente** (${motivo}).\n\n` +
                `• Novo ID: \`${canal.id}\`\n` +
                `• Posição: topo, fora de categoria\n\n` +
                'O aviso já foi postado no canal novo.'
            )
            .setFooter({ text: 'HostVille • Honeypot' })
            .setTimestamp();
        await this.enviarEmbedStaff(embed);
        logWarn(`Honeypot: canal recriado — alerta enviado (${motivo}).`);
    }

    /**
     * O canal já tem o embed de aviso? Procura nas últimas mensagens por um
     * embed cujo footer/title seja o do honeypot. Best-effort: se não
     * conseguir ler, assume que NÃO existe (e reenvia — melhor duplicar que
     * ficar sem aviso).
     */
    static async avisoExiste(canal) {
        try {
            if (typeof canal.messages?.fetch !== 'function') return false;
            const msgs = await canal.messages.fetch({ limit: 20 }).catch(() => null);
            if (!msgs) return false;
            for (const m of msgs.values()) {
                if (!m.embeds || m.embeds.length === 0) continue;
                for (const e of m.embeds) {
                    const title = (e && e.title) || '';
                    const footer = (e && e.footer && e.footer.text) || '';
                    if (title.includes('Canal de segurança') || footer.includes('Honeypot')) {
                        return true;
                    }
                }
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    /**
     * Limpa o canal (apaga mensagens recentes) antes de reenviar o aviso.
     * Best-effort e limitado: o bulkDelete do Discord só apaga mensagens com
     * até 14 dias; as mais antigas ficam. Falhas não interrompem o reenvio.
     */
    static async limparCanal(canal) {
        try {
            if (typeof canal.messages?.fetch !== 'function') return;
            // 1ª tentativa: bulkDelete (rápido, até 100 por vez, < 14 dias).
            let msgs = await canal.messages.fetch({ limit: 100 }).catch(() => null);
            if (msgs && msgs.size > 0) {
                const apagaveis = msgs.filter(m => Date.now() - m.createdTimestamp < 14 * 86400000);
                if (typeof canal.bulkDelete === 'function' && apagaveis.size > 0) {
                    await canal.bulkDelete(apagaveis, true).catch(() => null);
                }
            }
            // 2ª passada: apaga individualmente o que sobrou (mais antigo).
            msgs = await canal.messages.fetch({ limit: 100 }).catch(() => null);
            if (msgs) {
                for (const m of msgs.values()) {
                    try { if (m.deletable) await m.delete(); } catch (e) { /* rate limit */ }
                    await delay(200);
                }
            }
        } catch (e) {
            logWarn('Honeypot: falha ao limpar o canal: ' + e.message);
        }
    }

    static buildIntroEmbed() {
        return new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('⚠️ Canal de segurança — não envie mensagens')
            .setDescription(
                'Este é um **canal monitorado**. Ele existe para detectar acessos indesejados.\n\n' +
                '**Qualquer mensagem enviada aqui resulta em banimento automático e imediato**, ' +
                'sem aviso prévio.\n\n' +
                'Se você chegou aqui por engano, **saia do canal** e não escreva nada. ' +
                'Se foi um erro, contate a staff.'
            )
            .setFooter({ text: 'HostVille • Honeypot' });
    }

    /**
     * Ponto de entrada: chamado pelo messageCreate quando a mensagem cai no
     * canal-armadilha. Nunca derruba o fluxo.
     * @param {import('discord.js').Message} message
     */
    static async handleMessage(message) {
        try {
            if (!config.HONEYPOT.ENABLED) return;
            if (!message || !message.guild || !message.author) return;
            if (message.author.bot) return;
            if (!this.ativadoNoGuild(message.guild.id)) return;

            const chave = message.guild.id + ':' + message.author.id;
            if (processando.has(chave)) return; // já lidando com esse user
            processando.add(chave);

            try {
                // Modo TESTE: o usuário de teste (default: dono) dispara o
                // fluxo completo como demonstração — apaga só a mensagem do
                // honeypot, NÃO bane e NÃO apaga mensagens em outros canais.
                // O alerta no #admin sai marcado como "[TESTE]".
                if (this.ehUsuarioTeste(message)) {
                    await this.punir(message, { teste: true });
                    return;
                }

                // Isenções: dono, staff da rede, admins. Não pune; a mensagem fica.
                if (this.isExento(message)) {
                    logInfo(`Honeypot: ${message.author.tag} é isento (dono/staff/admin) — não punido.`);
                    return;
                }

                await this.punir(message);
            } finally {
                processando.delete(chave);
            }
        } catch (e) {
            logError('Honeypot: erro no handleMessage: ' + e.message);
        }
    }

    /** É o usuário de teste (dono por padrão)? */
    static ehUsuarioTeste(message) {
        const tid = String(config.HONEYPOT.TEST_USER_ID || '').trim();
        if (!tid) return false;
        return String(message.author.id) === tid;
    }

    /** Dono, staff da rede ou admin do servidor? */
    static isExento(message) {
        const uid = message.author.id;
        if (config.OWNER_ID && uid === String(config.OWNER_ID)) return true;
        if (isStaff(uid)) return true;
        if (isAdmin(message.member)) return true;
        return false;
    }

    static ativadoNoGuild(guildId) {
        try {
            const Features = require('./FeatureRegistry');
            return Features.ligadoSync('honeypot', guildId);
        } catch (e) {
            return config.HONEYPOT.ENABLED;
        }
    }

    /**
     * Executa a punição completa. Recebe a mensagem original (já capturada).
     *
     * @param {import('discord.js').Message} message
     * @param {object} [opts]
     * @param {boolean} [opts.teste] true = MODO TESTE: apaga só a mensagem do
     *   honeypot e manda o alerta marcado, mas NÃO bane e NÃO apaga mensagens
     *   em outros canais (deleteMessageSeconds + varredura ficam desligados).
     */
    static async punir(message, opts = {}) {
        const teste = !!opts.teste;
        const user = message.author;
        const guild = message.guild;
        const tag = user.tag;
        const uid = user.id;

        // 1) Captura ANTES de qualquer delete.
        const texto = message.content || '';
        const anexos = this.extrairAnexos(message);
        const temMidia = anexos.length > 0;

        // 2) Apaga a mensagem do honeypot (acontece em TODO caso, inclusive teste).
        try {
            if (message.deletable) await message.delete();
        } catch (e) {
            logWarn('Honeypot: não consegui apagar a mensagem isca: ' + e.message);
        }

        let banOk = false;
        let apagadasExtra = 0;

        if (teste) {
            // ── MODO TESTE: nada destrutivo. Só demonstra o fluxo. ──
            logInfo(`Honeypot [TESTE]: ${tag} (${uid}) postou no honeypot — simulação (não bane, não apaga histórico).`);
            // No teste manda a DM (simulação fiel) — não há ban, então a ordem não importa.
            await this.enviarDM(user, guild);
        } else {
            // ── MODO REAL ──
            // 3) DM ANTES DO BAN. Depois do ban o bot e o usuário não têm mais
            //    guild em comum e o Discord bloqueia o user.send() (50007).
            //    Mandando antes, enquanto ainda dividem o servidor, a DM chega.
            await this.enviarDM(user, guild);

            // 4) Ban com deleteMessageSeconds (Discord apaga até 7 dias).
            const deleteMessageSeconds = (config.HONEYPOT.DELETE_DAYS || 0) * 86400;
            try {
                await guild.members.ban(uid, {
                    reason: 'Honeypot: enviou mensagem em canal-armadilha (HostVille • BOT)',
                    deleteMessageSeconds: Math.min(604800, Math.max(0, deleteMessageSeconds)),
                });
                banOk = true;
                logSuccess(`Honeypot: ${tag} (${uid}) BANIDO — mandou mensagem no canal-armadilha.`);
            } catch (e) {
                logError(`Honeypot: falha ao banir ${tag} (${uid}): ${e.message}`);
            }

            // 5) Varredura extra em background (não bloqueia o alerta).
            if (config.HONEYPOT.EXTRA_SCAN) {
                this.varreduraExtra(guild, uid).then(n => { apagadasExtra = n; }).catch(() => {});
            }
        }

        // 6) Salva mídia no #admin e monta o alerta.
        const midia = await this.salvarMidia(anexos);
        const alerta = await this.enviarAlerta({ guild, user, tag, uid, texto, anexos, midia, banOk, apagadasExtra, teste });

        // 7) logInfo + stats.
        if (teste) {
            logInfo(`Honeypot [TESTE]: simulação concluída para ${tag} (${uid}) — alerta enviado ao #admin.`);
        } else {
            logInfo(`Honeypot: ${tag} (${uid}) banido do servidor ${guild.name} — motivo: mensagem em canal-armadilha.`);
            try {
                const StatsManager = require('./StatsManager');
                StatsManager.trackCommand('ban');
                StatsManager.incrementMessagesDeleted(1 + apagadasExtra);
            } catch (e) { /* stats é opcional */ }
        }

        // Re-passada: varredura pode ter terminado depois do alerta; atualiza.
        void alerta;
    }

    /** Coleta anexos relevantes (imagem/vídeo/qualquer arquivo). */
    static extrairAnexos(message) {
        const out = [];
        try {
            const col = message.attachments;
            if (!col) return out;
            const arr = typeof col.values === 'function' ? Array.from(col.values()) : (Array.isArray(col) ? col : []);
            for (const a of arr) {
                if (!a || !a.url) continue;
                out.push({
                    url: a.url,
                    name: a.name || 'arquivo',
                    contentType: a.contentType || '',
                    size: a.size || 0,
                });
            }
        } catch (e) { /* sem anexos */ }
        return out;
    }

    /**
     * Salva a mídia no canal de arquivo (MEDIA_CHANNEL_ID) para não expirar e
     * devolve também o Buffer (para anexar direto no embed do alerta).
     * Devolve { enviados: [{ nome, url, tipo, buffer }], grandes: [...], falhas: [...] }.
     *   - grandes: arquivos > 25MB (grande demais pra anexar)
     *   - falhas:  arquivos que não baixaram (qualquer tamanho)
     */
    static async salvarMidia(anexos) {
        const resultado = { enviados: [], grandes: [], falhas: [] };
        if (!anexos.length) return resultado;

        const client = global.client;
        if (!client) return resultado;

        let canal = null;
        try {
            const midiaChannelId = config.HONEYPOT.MEDIA_CHANNEL_ID || config.HONEYPOT.ALERT_CHANNEL_ID;
            canal = client.channels.cache.get(midiaChannelId);
            if (!canal) {
                const g = config.HONEYPOT.GUILD_ID
                    ? await client.guilds.fetch(config.HONEYPOT.GUILD_ID).catch(() => null)
                    : null;
                canal = g
                    ? await g.channels.fetch(midiaChannelId).catch(() => null)
                    : await client.channels.fetch(midiaChannelId).catch(() => null);
            }
        } catch (e) {
            logWarn('Honeypot: não achei o canal de arquivo da mídia: ' + e.message);
            // Sem canal de mídia ainda baixamos o buffer (para o embed), mas
            // sem URL permanente.
        }
        if (canal && !canal.send) canal = null;

        const { fetch } = require('../utils/httpDispatcher');

        for (const a of anexos) {
            // Arquivo grande demais para reenviar: guarda só o link.
            if (a.size && a.size > MAX_ANEXO_BYTES) {
                resultado.grandes.push({ nome: a.name, url: a.url, size: a.size });
                continue;
            }
            let buf = null;
            try {
                // User-Agent: o CDN do Discord pode responder 403 sem um UA
                // que se identifique. Undici não manda UA por padrão em alguns
                // casos, então forçamos um.
                const resp = await fetch(a.url, { headers: { 'User-Agent': 'HostVille-BOT/5.0 (+https://discord.com)' } });
                if (!resp || !resp.ok) throw new Error('HTTP ' + (resp ? resp.status : 'sem resposta'));
                buf = Buffer.from(await resp.arrayBuffer());
            } catch (e) {
                logWarn(`Honeypot: falha ao baixar mídia ${a.name}: ${e.message}`);
                // Falha de download (qualquer tamanho) vai para "falhas" — a
                // staff precisa saber que o arquivo não pôde ser capturado.
                resultado.falhas.push({ nome: a.name, url: a.url, size: a.size, erro: e.message });
                continue;
            }

            const tipo = (a.contentType || '').split('/')[0] || this.tipoPorNome(a.name);

            // Tenta salvar no canal de mídia (URL permanente). Se falhar, o
            // buffer ainda vai no embed (attachment://), então seguimos.
            let urlPerm = null;
            if (canal) {
                try {
                    const msg = await canal.send({
                        content: `📎 Arquivo do honeypot: **${a.name}**`,
                        files: [{ attachment: buf, name: a.name }],
                    });
                    const up = msg.attachments && msg.attachments.first && msg.attachments.first();
                    if (up && up.url) urlPerm = up.url;
                    await delay(300); // respiro (rate limit)
                } catch (e) {
                    logWarn(`Honeypot: falha ao salvar mídia ${a.name} no canal de arquivo: ${e.message}`);
                }
            }

            resultado.enviados.push({ nome: a.name, url: urlPerm, tipo, buffer: buf });
        }
        return resultado;
    }

    static tipoPorNome(nome) {
        const n = String(nome || '').toLowerCase();
        if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n)) return 'image';
        if (/\.(mp4|webm|mov|mkv|avi)$/i.test(n)) return 'video';
        return 'file';
    }

    /**
     * Monta e envia o embed de alerta no #admin. Marca @everyone (pedido do
     * dono) e mostra o texto exato + a mídia (inline / link / aviso de grande).
     *
     * @param {object} p
     * @param {boolean} [p.teste] true = alerta de SIMULAÇÃO (sem @everyone e
     *   marcado como "[TESTE]"); não representa ban real.
     */
    static async enviarAlerta({ guild, user, tag, uid, texto, anexos, midia, banOk, teste }) {
        try {
            const canalId = config.HONEYPOT.ALERT_CHANNEL_ID || config.LOG_CHANNEL_ID;
            const client = global.client;
            if (!client || !canalId) return null;

            let canal = client.channels.cache.get(canalId);
            if (!canal) {
                const g = config.HONEYPOT.GUILD_ID
                    ? await client.guilds.fetch(config.HONEYPOT.GUILD_ID).catch(() => null)
                    : null;
                canal = g ? await g.channels.fetch(canalId).catch(() => null) : null;
            }
            if (!canal || !canal.send) {
                logWarn(`Honeypot: canal de alerta ${canalId} não encontrado.`);
                return null;
            }

            const primeiraImagem = midia.enviados.find(m => m.tipo === 'image' && m.buffer);
            const primeiroVideo = midia.enviados.find(m => m.tipo === 'video' && m.buffer);

            const embed = new EmbedBuilder()
                .setColor(teste ? 0xFEE75C : 0xED4245)
                .setTitle(teste ? '🧪 Honeypot [TESTE] — simulação (ninguém foi banido)' : '🚨 Honeypot: usuário banido')
                .addFields(
                    { name: 'Usuário', value: `${tag ? '@' + tag : uid}\nID: \`${uid}\``, inline: false },
                    { name: 'Servidor', value: `${guild.name} (\`${guild.id}\`)`, inline: true },
                    {
                        name: teste ? 'Ban' : 'Ban',
                        value: teste ? 'simulação (não baniu) 🧪' : (banOk ? 'aplicado ✅' : 'falhou ❌'),
                        inline: true,
                    },
                    {
                        name: 'O que enviou',
                        value: texto ? texto.slice(0, 1024) : (anexos.length ? '[somente anexo, sem texto]' : '[mensagem vazia]'),
                        inline: false,
                    },
                )
                .setFooter({ text: teste ? 'HostVille • Honeypot [TESTE]' : 'HostVille • Honeypot' })
                .setTimestamp();

            if (teste) {
                embed.addFields({
                    name: 'ℹ️ Isto foi um teste',
                    value: 'O usuário de teste postou no honeypot. O fluxo rodou como demonstração: ' +
                        'a mensagem da isca foi apagada, mas **ninguém foi banido** e **nenhuma mensagem de outros canais foi apagada**.',
                    inline: false,
                });
            }

            // Anexa os buffers ao PRÓPRIO embed (attachment://) — garante que
            // a imagem/vídeo apareçam no alerta sem depender de URL externa.
            const arquivos = [];
            if (primeiraImagem) {
                arquivos.push({ attachment: primeiraImagem.buffer, name: primeiraImagem.nome });
                embed.setImage('attachment://' + primeiraImagem.nome);
            }
            if (primeiroVideo) {
                arquivos.push({ attachment: primeiroVideo.buffer, name: primeiroVideo.nome });
                embed.addFields({ name: '🎬 Vídeo', value: `anexado abaixo (${primeiroVideo.nome})`, inline: false });
            }
            // Link permanente da mídia (salva no canal de arquivo), se houver.
            const urlsPerm = midia.enviados.filter(m => m.url).map(m => `[${m.nome}](${m.url})`);
            if (urlsPerm.length) {
                embed.addFields({ name: '📎 Arquivo salvo (permanente)', value: urlsPerm.join(' · ').slice(0, 1024), inline: false });
            }

            // Avisos de mídia grande demais para anexar.
            const grandes = (midia.grandes || []).filter(g => g.size && g.size > MAX_ANEXO_BYTES);
            if (grandes.length) {
                const linhas = grandes.map(g => `• **${g.nome}** — ${(g.size / (1024 * 1024)).toFixed(1)} MB (grande demais para anexar): ${g.url}`).join('\n');
                embed.addFields({ name: '⚠️ Mídia grande demais para anexar', value: linhas.slice(0, 1024), inline: false });
            }
            // Falhas de download (qualquer tamanho) — a staff precisa saber.
            const falhas = (midia.falhas || []);
            if (falhas.length) {
                const linhas = falhas.map(f => `• **${f.nome}** — não consegui baixar (${f.erro || 'erro'}): ${f.url}`).join('\n');
                embed.addFields({ name: '⚠️ Não consegui baixar a mídia', value: linhas.slice(0, 1024), inline: false });
            }

            // 1) Primeiro o EMBED (organizado, sem o ping junto). Os buffers
            //    de imagem/vídeo vão anexados NESTA mensagem (attachment://).
            const payloadEmbed = { embeds: [embed] };
            if (arquivos.length) payloadEmbed.files = arquivos;
            const enviado = await canal.send(payloadEmbed);

            // 2) Depois, uma mensagem separada só com o @everyone (fica organizado).
            try {
                await canal.send({
                    content: '@everyone 🚨 Honeypot acionado — um usuário foi banido por mandar mensagem no canal-armadilha.',
                    allowedMentions: { parse: ['everyone'] },
                });
            } catch (e) {
                logWarn('Honeypot: falha ao marcar @everyone no alerta: ' + e.message);
            }

            // 3) DM do alerta para o dono (mesmo embed + MESMOS arquivos, para
            //    o attachment:// resolver na DM também — sem imagem quebrada).
            await this.enviarDMOwner(embed, arquivos);

            return enviado;
        } catch (e) {
            logError('Honeypot: falha ao enviar alerta: ' + e.message);
            return null;
        }
    }

    /**
     * DM para o banido explicando o ocorrido e apontando o dono.
     *
     * IMPORTANTE: chamar ANTES do ban. Depois do ban o bot e o usuário não
     * têm mais guild em comum e o Discord bloqueia o user.send() (50007).
     */
    static async enviarDM(user, guild) {
        try {
            const donoMencao = config.OWNER_ID ? `<@${config.OWNER_ID}>` : 'a staff';
            const embed = new EmbedBuilder()
                .setColor(0xED4245)
                .setTitle('Você foi banido de ' + guild.name)
                .setDescription(
                    `Você foi **banido automaticamente** de **${guild.name}** por enviar uma mensagem em um **canal de segurança monitorado** (canal-armadilha).\n\n` +
                    'Esse canal existe para detectar acessos indesejados e **qualquer mensagem enviada nele resulta em banimento imediato**.\n\n' +
                    `Se isso foi um engano ou um erro, entre em contato com ${donoMencao}` +
                    (config.OWNER_ID ? ` (ID: \`${config.OWNER_ID}\`)` : '') + '.'
                )
                .setFooter({ text: 'HostVille • Honeypot' });
            await user.send({ embeds: [embed] });
            logInfo(`Honeypot: DM de ban enviada para ${user.tag}.`);
        } catch (e) {
            // 50007 = não pode enviar DM (DMs fechadas / sem guild em comum).
            const code = e && (e.code || (e.rawError && e.rawError.code));
            if (code === 50007) {
                logWarn(`Honeypot: DM não entregue a ${user.tag} (50007: DMs fechadas ou sem servidor em comum).`);
            } else {
                logWarn(`Honeypot: não consegui enviar DM para ${user.tag}: ${e.message}`);
            }
        }
    }

    /**
     * DM do alerta ("o que aconteceu") para o DONO, com o mesmo embed que
     * vai pro canal de alerta. DMs fechadas não derrubam o fluxo.
     *
     * @param {import('discord.js').EmbedBuilder} embed
     * @param {Array} [arquivos] buffers anexados (mesmos do alerta) — sem eles
     *   o `attachment://` do embed fica órfão e a imagem não aparece na DM.
     */
    static async enviarDMOwner(embed, arquivos = []) {
        try {
            if (!config.OWNER_ID) return;
            const client = global.client;
            if (!client || !client.users) return;
            const owner = await client.users.fetch(String(config.OWNER_ID)).catch(() => null);
            if (!owner) return;
            const payload = { embeds: [embed] };
            if (arquivos && arquivos.length) payload.files = arquivos;
            await owner.send(payload);
            logInfo('Honeypot: cópia do alerta enviada na DM do dono.');
        } catch (e) {
            logWarn('Honeypot: não consegui enviar a DM do alerta ao dono: ' + e.message);
        }
    }

    /**
     * Varredura extra best-effort: apaga mensagens antigas do usuário nos
     * canais de texto do guild. Limitada (teto de canais e de mensagens) e
     * com delays, porque o Discord impõe rate limit e não deixa apagar em
     * massa mensagens com +14 dias. Roda em background.
     *
     * @returns {Promise<number>} quantas mensagens apagou
     */
    static async varreduraExtra(guild, userId) {
        const chave = guild.id + ':' + userId;
        if (jaVarri.has(chave)) return 0;
        jaVarri.add(chave);

        const MAX_CANAIS = 30;
        const MAX_MSGS = 200;
        let apagadas = 0;
        let canaisVistos = 0;
        try {
            const canais = guild.channels.cache.filter(c =>
                c && c.type === 0 && // GuildText
                typeof c.messages?.fetch === 'function' &&
                c.permissionsFor(guild.members.me)?.has('ManageMessages')
            );
            for (const canal of canais.values()) {
                if (canaisVistos++ >= MAX_CANAIS) break;
                try {
                    const msgs = await canal.messages.fetch({ limit: 100 }).catch(() => null);
                    if (!msgs) continue;
                    const doUser = msgs.filter(m => m.author && m.author.id === userId && m.deletable);
                    for (const m of doUser.values()) {
                        if (apagadas >= MAX_MSGS) break;
                        try { await m.delete(); apagadas++; } catch (e) { /* rate limit/erro */ }
                        await delay(250);
                    }
                } catch (e) { /* segue pro próximo canal */ }
                if (apagadas >= MAX_MSGS) break;
            }
            if (apagadas > 0) {
                logInfo(`Honeypot: varredura extra apagou ${apagadas} mensagem(ns) antigas de ${userId}.`);
            }
        } catch (e) {
            logWarn('Honeypot: varredura extra falhou: ' + e.message);
        } finally {
            // libera pra uma eventual re-incidência futura poder varrer de novo
            setTimeout(() => jaVarri.delete(chave), 10 * 60 * 1000).unref?.();
        }
        return apagadas;
    }
}

module.exports = HoneypotManager;

// ── Apenas para testes (injeta client e reseta estado do watchdog) ───────
HoneypotManager._setClientForTest = (client) => { _client = client; _canalInfo = {}; };
HoneypotManager._resetEstadoCanal = () => { _estadoCanal = null; };
HoneypotManager._resetCanalInfo = () => { _canalInfo = {}; };
HoneypotManager._setCanalInfoTest = (obj) => { _canalInfo = obj || {}; };
HoneypotManager.getCanalId = getCanalId;
HoneypotManager.getGuildId = getGuildId;