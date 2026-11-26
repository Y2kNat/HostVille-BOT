/**
 * tests/protect.test.js
 *
 * Suíte COMPLETA de Anti-Raid + Honeypot (o que foi adicionado nesta sessão).
 *
 * ESTE ARQUIVO CODIFICA O COMPORTAMENTO-ALVO. Um caso que falha é um bug
 * real a corrigir, não um teste errado.
 *
 *   node tests/protect.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
process.env.LOG_FILE = process.env.LOG_FILE || 'teste.log';

// Arquivos de persistência isolados (não tocam a produção).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'protect-'));
process.env.ANTIRAID_GRANTS_FILE = path.join(TMP, 'grants.json');
process.env.ANTIRAID_INCIDENTS_FILE = path.join(TMP, 'incidents.json');
process.env.HONEYPOT_CHANNEL_FILE = path.join(TMP, 'honeypot-channel.json');

const config = require(path.join(RAIZ, 'config'));
const { setFetchImpl, clearFetchImpl } = require(path.join(RAIZ, 'utils/httpDispatcher'));
const AntiRaid = require(path.join(RAIZ, 'managers/AntiRaidManager'));
const Honeypot = require(path.join(RAIZ, 'managers/HoneypotManager'));

let passou = 0, falhou = 0;
const falhas = [];

async function teste(nome, fn) {
    try {
        await fn();
        console.log('  ok   ' + nome);
        passou++;
    } catch (e) {
        console.log('  FALHA ' + nome);
        console.log('       ' + (e && e.message ? e.message : e));
        falhas.push(nome);
        falhou++;
    }
}

let seq = 0;
function id(prefix = 'id') { return prefix + (++seq) + Date.now().toString().slice(-4); }

// ════════════════════════════════════════════════════════════════════════
// MOCKS
// ════════════════════════════════════════════════════════════════════════

/** Resposta fake para o httpDispatcher (download de mídia). */
function fakeResponse(buf, { ok = true, status = 200 } = {}) {
    return {
        ok, status,
        arrayBuffer: async () => buf,
    };
}

/** Member mock (discord.js GuildMember) para whitelist. */
function memberMock({ userId, joinedAgoMs = 0, hasAdmin = false, bot = false }) {
    const ADMIN_ROLE = (config.ADMIN_ROLES && config.ADMIN_ROLES[0]) || 'admin-role';
    return {
        id: userId,
        bannable: true,
        moderatable: true,
        joinedAt: new Date(Date.now() - joinedAgoMs),
        user: { id: userId, tag: 'user#' + userId, bot, createdAt: new Date() },
        roles: {
            cache: {
                has: (r) => hasAdmin && r === ADMIN_ROLE,
                some: (fn) => hasAdmin && fn({ id: ADMIN_ROLE }),
                filter: () => new Map(),
                [Symbol.iterator]: function* () {},
            },
        },
    };
}

/** Guild mock para AntiRaid (_record/trigger) e Honeypot. */
function guildMock(opts = {}) {
    const bans = [];
    const members = {};
    const guild = {
        id: opts.guildId || id('g'),
        name: opts.guildName || 'Servidor Teste',
        ownerId: opts.ownerId || 'owner-1',
        members: {
            me: { id: 'bot-1' },
            async fetch(uid) {
                if (opts.member === false) return null;
                return members[uid] || memberMock({ userId: uid, joinedAgoMs: opts.joinedAgoMs || 0, hasAdmin: opts.hasAdmin });
            },
            async ban(uid, o) { bans.push({ uid, o }); },
        },
        channels: { cache: new Map() },
        fetchAuditLogs: async () => ({ entries: { values: () => [] } }),
    };
    return { guild, bans, members };
}

/** Message mock para Honeypot. */
function messageMock(opts = {}) {
    const sent = [];
    const deleted = { count: 0 };
    const author = {
        id: opts.userId || id('u'),
        tag: opts.tag || ('user#' + (opts.userId || 'x')),
        bot: !!opts.bot,
        createdAt: new Date(Date.now() - (opts.accountAgoMs || 0)),
        async send(payload) { sent.push(payload); return { attachments: { first: () => null } }; },
    };
    const guild = opts.guild || guildMock({ joinedAgoMs: opts.joinedAgoMs || 0 }).guild;
    const attachments = new Map();
    (opts.attachments || []).forEach((a, i) => attachments.set(String(i), {
        url: a.url, name: a.name, contentType: a.contentType || '', size: a.size || 0,
    }));
    const member = opts.member === undefined
        ? memberMock({ userId: author.id, joinedAgoMs: opts.joinedAgoMs || 0, hasAdmin: opts.hasAdmin })
        : opts.member;
    const message = {
        author, guild, member,
        content: opts.content || '',
        attachments,
        deletable: opts.deletable !== false,
        channel: { id: config.HONEYPOT.CHANNEL_ID, name: 'honeypot' },
        async delete() { deleted.count++; },
    };
    return { message, author, guild, sent, deleted };
}

// ════════════════════════════════════════════════════════════════════════
// CLIENT mock para Honeypot (global.client)
// ════════════════════════════════════════════════════════════════════════
function clientMock() {
    const state = {
        alertMessages: [],   // mensagens enviadas no canal de alerta
        mediaMessages: [],   // mensagens enviadas no canal de mídia
        ownerDMs: [],        // DMs enviadas ao dono
    };

    function fakeChannel(sink) {
        return {
            isSend: true,
            async send(payload) {
                const attachments = (payload && payload.files) || [];
                const record = { payload, files: attachments };
                sink.push(record);
                // devolve uma mensagem com anexo (url permanente fake)
                const first = attachments[0];
                return {
                    attachments: {
                        first: () => (first ? { url: 'https://cdn.discord.test/' + (first.name || 'file') } : null),
                    },
                };
            },
            messages: { async fetch() { return new Map(); } },
            bulkDelete: async () => {},
        };
    }

    const alertCh = fakeChannel(state.alertMessages);
    const mediaCh = fakeChannel(state.mediaMessages);

    const channels = new Map();
    channels.set(String(config.HONEYPOT.ALERT_CHANNEL_ID), alertCh);
    channels.set(String(config.HONEYPOT.MEDIA_CHANNEL_ID), mediaCh);

    const client = {
        channels: {
            cache: {
                get: (id) => channels.get(String(id)) || null,
            },
            async fetch(id) { return channels.get(String(id)) || null; },
        },
        guilds: {
            cache: new Map(),
            async fetch() {
                return { channels: { cache: { get: () => null }, async fetch(id) { return channels.get(String(id)) || null; } } };
            },
        },
        users: {
            async fetch(uid) {
                if (String(uid) === String(config.OWNER_ID)) {
                    return {
                        id: String(config.OWNER_ID),
                        async send(payload) { state.ownerDMs.push(payload); return {}; },
                    };
                }
                return null;
            },
        },
        user: { id: 'bot-1' },
    };
    return { client, state };
}

// ════════════════════════════════════════════════════════════════════════
// ANTI-RAIL
// ════════════════════════════════════════════════════════════════════════
async function testarAntiRaid() {
    console.log('\n=== AntiRaidManager ===\n');
    AntiRaid._estado.clear();
    AntiRaid._cooldown.clear();

    await teste('3 deletes em 3 min → bane', async () => {
        AntiRaid._estado.clear(); AntiRaid._cooldown.clear();
        const { guild, bans } = guildMock({ joinedAgoMs: 60000 });
        const ex = id('ex');
        await AntiRaid._record(guild, ex, 'deletes');
        await AntiRaid._record(guild, ex, 'deletes');
        assert.strictEqual(bans.length, 0, 'não bane antes do 3º');
        await AntiRaid._record(guild, ex, 'deletes');
        assert.strictEqual(bans.length, 1, 'bane no 3º delete');
    });

    await teste('3 creates / 3 bans / 3 everyones → bane', async () => {
        AntiRaid._estado.clear(); AntiRaid._cooldown.clear();
        for (const tipo of ['creates', 'bans', 'everyones']) {
            AntiRaid._cooldown.clear();
            const { guild, bans } = guildMock({ joinedAgoMs: 60000 });
            const ex = id('ex');
            for (let i = 0; i < 3; i++) await AntiRaid._record(guild, ex, tipo);
            assert.strictEqual(bans.length, 1, 'bane por ' + tipo);
        }
    });

    await teste('abaixo do limite → NÃO bane', async () => {
        AntiRaid._estado.clear(); AntiRaid._cooldown.clear();
        const { guild, bans } = guildMock({ joinedAgoMs: 60000 });
        const ex = id('ex');
        await AntiRaid._record(guild, ex, 'deletes');
        await AntiRaid._record(guild, ex, 'deletes');
        assert.strictEqual(bans.length, 0);
    });

    await teste('tipos diferentes NÃO somam (limite é por tipo)', async () => {
        AntiRaid._estado.clear(); AntiRaid._cooldown.clear();
        const { guild, bans } = guildMock({ joinedAgoMs: 60000 });
        const ex = id('ex');
        for (const t of ['deletes', 'creates', 'bans', 'everyones']) {
            await AntiRaid._record(guild, ex, t);
            await AntiRaid._record(guild, ex, t);
        }
        assert.strictEqual(bans.length, 0);
    });

    await teste('janela deslizante: ações antigas não contam', async () => {
        AntiRaid._estado.clear(); AntiRaid._cooldown.clear();
        const { guild, bans } = guildMock({ joinedAgoMs: 60000 });
        const ex = id('ex');
        // injeta 2 timestamps antigos (fora da janela) + 1 recente
        const entrada = AntiRaid._estado.get(guild.id) || new Map();
        AntiRaid._estado.set(guild.id, entrada);
        const antigo = Date.now() - (config.ANTI_RAID.WINDOW_MS + 10000);
        entrada.set(ex, { deletes: [antigo, antigo], creates: [], bans: [], everyones: [] });
        await AntiRaid._record(guild, ex, 'deletes'); // só 1 recente → não bane
        assert.strictEqual(bans.length, 0, '2 antigos + 1 recente < 3 na janela');
    });

    await teste('whitelist: owner do servidor nunca é banido', async () => {
        AntiRaid._estado.clear(); AntiRaid._cooldown.clear();
        const owner = id('owner');
        const { guild, bans } = guildMock({ ownerId: owner, joinedAgoMs: 60000 });
        for (let i = 0; i < 3; i++) await AntiRaid._record(guild, owner, 'deletes');
        assert.strictEqual(bans.length, 0);
    });

    await teste('whitelist: staff da rede não é banido', async () => {
        AntiRaid._estado.clear(); AntiRaid._cooldown.clear();
        const staffId = (config.STAFF_USER_ID && config.STAFF_USER_ID[0]) || null;
        if (!staffId) { assert.ok(true, 'sem staff configurado, pula'); return; }
        const { guild, bans } = guildMock({ joinedAgoMs: 60000 });
        for (let i = 0; i < 3; i++) await AntiRaid._record(guild, staffId, 'deletes');
        assert.strictEqual(bans.length, 0);
    });

    await teste('whitelist: admin com cargo há >= 1 dia não é banido', async () => {
        AntiRaid._estado.clear(); AntiRaid._cooldown.clear();
        const { guild, bans } = guildMock({ joinedAgoMs: 2 * 86400000, hasAdmin: true });
        const ex = id('admin');
        // registra o grant (como guildMemberUpdate faria)
        let grants = {};
        try { grants = JSON.parse(fs.readFileSync(process.env.ANTIRAID_GRANTS_FILE, 'utf8')); } catch (e) {}
        grants[guild.id] = { [ex]: { roleId: (config.ADMIN_ROLES || [])[0], grantedAt: Date.now() - 2 * 86400000 } };
        fs.writeFileSync(process.env.ANTIRAID_GRANTS_FILE, JSON.stringify(grants));
        for (let i = 0; i < 3; i++) await AntiRaid._record(guild, ex, 'deletes');
        assert.strictEqual(bans.length, 0);
    });

    await teste('membro comum recente (<1 dia) NÃO é whitelist → bane', async () => {
        AntiRaid._estado.clear(); AntiRaid._cooldown.clear();
        const { guild, bans } = guildMock({ joinedAgoMs: 3600000 }); // 1h
        const ex = id('new');
        for (let i = 0; i < 3; i++) await AntiRaid._record(guild, ex, 'deletes');
        assert.strictEqual(bans.length, 1, 'membro novo é banido');
    });

    await teste('cooldown: não repete o ban em rajada', async () => {
        AntiRaid._estado.clear(); AntiRaid._cooldown.clear();
        const { guild, bans } = guildMock({ joinedAgoMs: 60000 });
        const ex = id('cd');
        for (let i = 0; i < 3; i++) await AntiRaid._record(guild, ex, 'deletes');
        assert.strictEqual(bans.length, 1);
        // mais ações dentro do cooldown não banem de novo
        await AntiRaid._record(guild, ex, 'deletes');
        await AntiRaid._record(guild, ex, 'deletes');
        assert.strictEqual(bans.length, 1, 'cooldown evita re-ban');
    });

    await teste('incidente é persistido em disco após o ban', async () => {
        AntiRaid._estado.clear(); AntiRaid._cooldown.clear();
        const { guild } = guildMock({ joinedAgoMs: 60000 });
        const ex = id('inc');
        for (let i = 0; i < 3; i++) await AntiRaid._record(guild, ex, 'deletes');
        const lista = JSON.parse(fs.readFileSync(process.env.ANTIRAID_INCIDENTS_FILE, 'utf8'));
        assert.ok(lista.some(i => i.executorId === ex), 'incidente do executor certo');
    });

    await teste('onMemberUpdate: registra grant ao ganhar cargo, remove ao perder', () => {
        AntiRaid.onMemberUpdate; // existe
        const ADMIN_ROLE = (config.ADMIN_ROLES && config.ADMIN_ROLES[0]) || 'admin-role';
        const mk = (has) => ({
            id: '5', guild: { id: 'g-role' }, user: { tag: 'x' },
            roles: { cache: new Map(has ? [[ADMIN_ROLE, { id: ADMIN_ROLE }]] : []) },
        });
        const gid = 'g-role-' + id('x');
        const gm = (has) => {
            const m = mk(has); m.guild = { id: gid }; return m;
        };
        AntiRaid.onMemberUpdate(gm(false), gm(true));
        let grants = JSON.parse(fs.readFileSync(process.env.ANTIRAID_GRANTS_FILE, 'utf8'));
        assert.ok(grants[gid] && grants[gid]['5'] && grants[gid]['5'].grantedAt, 'grant gravado');
        AntiRaid.onMemberUpdate(gm(true), gm(false));
        grants = JSON.parse(fs.readFileSync(process.env.ANTIRAID_GRANTS_FILE, 'utf8'));
        assert.ok(!grants[gid]['5'], 'grant removido ao perder cargo');
    });

    await teste('_record ignora executor nulo/vazio sem quebrar', async () => {
        const { guild } = guildMock();
        await AntiRaid._record(guild, null, 'deletes');
        await AntiRaid._record(guild, '', 'deletes');
        assert.ok(true);
    });
}

// ════════════════════════════════════════════════════════════════════════
// HONEYPOT
// ════════════════════════════════════════════════════════════════════════
async function testarHoneypot() {
    console.log('\n=== HoneypotManager ===\n');

    // Stub do gate (evita require do FeatureRegistry/db no teste).
    Honeypot.ativadoNoGuild = () => true;

    await teste('handleMessage: mensagem de BOT é ignorada', async () => {
        const { message, deleted } = messageMock({ bot: true });
        await Honeypot.handleMessage(message);
        assert.strictEqual(deleted.count, 0, 'não apaga nada de bot');
    });

    await teste('handleMessage: usuário de TESTE → modo teste (apaga isca, NÃO bane)', async () => {
        const cfg = config.HONEYPOT;
        const tid = String(cfg.TEST_USER_ID || '');
        assert.ok(tid, 'TEST_USER_ID definido');
        const { message, deleted } = messageMock({ userId: tid, content: 'teste' });
        const banaOriginal = message.guild.members.ban;
        let baniu = false;
        message.guild.members.ban = async () => { baniu = true; };
        await Honeypot.handleMessage(message);
        message.guild.members.ban = banaOriginal;
        assert.strictEqual(deleted.count, 1, 'apaga a mensagem da isca');
        assert.strictEqual(baniu, false, 'NÃO bane no modo teste');
    });

    await teste('handleMessage: isento (staff/admin) → não pune (mensagem fica)', async () => {
        const staffId = (config.STAFF_USER_ID && config.STAFF_USER_ID[0]) || null;
        if (!staffId) { assert.ok(true, 'sem staff, pula'); return; }
        const { message, deleted } = messageMock({ userId: staffId });
        await Honeypot.handleMessage(message);
        assert.strictEqual(deleted.count, 0, 'isento: mensagem não apagada');
    });

    await teste('handleMessage: usuário normal → pune (apaga isca + bane)', async () => {
        const { message, deleted } = messageMock({ userId: id('normal'), content: 'oi' });
        let baniu = false;
        const orig = message.guild.members.ban;
        message.guild.members.ban = async () => { baniu = true; };
        // global.client undefined → salvarMidia/enviarAlerta no-op (não quebra)
        global.client = undefined;
        await Honeypot.handleMessage(message);
        message.guild.members.ban = orig;
        assert.strictEqual(deleted.count, 1, 'apaga a isca');
        assert.strictEqual(baniu, true, 'bane usuário normal');
    });

    await teste('punir (teste=false): DM é enviada ANTES do ban', async () => {
        const ordem = [];
        const { message } = messageMock({ userId: id('ord'), content: 'spam' });
        message.author.send = async () => { ordem.push('dm'); return {}; };
        const orig = message.guild.members.ban;
        message.guild.members.ban = async () => { ordem.push('ban'); };
        global.client = undefined;
        await Honeypot.punir(message, { teste: false });
        message.guild.members.ban = orig;
        assert.deepStrictEqual(ordem, ['dm', 'ban'], 'DM antes do ban');
    });

    await teste('extrairAnexos: extrai url/nome/contentType/size', () => {
        const { message } = messageMock({ attachments: [
            { url: 'https://cdn/x.png', name: 'x.png', contentType: 'image/png', size: 1234 },
        ] });
        const a = Honeypot.extrairAnexos(message);
        assert.strictEqual(a.length, 1);
        assert.strictEqual(a[0].url, 'https://cdn/x.png');
        assert.strictEqual(a[0].contentType, 'image/png');
        assert.strictEqual(a[0].size, 1234);
    });

    await teste('salvarMidia: baixa (com UA), reenvia ao canal de mídia e devolve buffer+url', async () => {
        const buf = Buffer.from('fake-image-bytes');
        setFetchImpl(async (url, opts) => {
            // verifica que um User-Agent foi mandado
            assert.ok(opts && opts.headers && opts.headers['User-Agent'], 'download manda User-Agent');
            return fakeResponse(buf);
        });
        const { client } = clientMock();
        global.client = client;
        const anexos = [{ url: 'https://cdn/x.png', name: 'x.png', contentType: 'image/png', size: buf.length }];
        const r = await Honeypot.salvarMidia(anexos);
        clearFetchImpl();
        assert.strictEqual(r.enviados.length, 1, '1 mídia enviada');
        assert.strictEqual(r.enviados[0].tipo, 'image');
        assert.ok(Buffer.isBuffer(r.enviados[0].buffer), 'buffer devolvido');
        assert.ok(r.enviados[0].url, 'url permanente devolvida');
        global.client = undefined;
    });

    await teste('salvarMidia: arquivo grande demais vai para "grandes" (não baixa)', async () => {
        setFetchImpl(async () => { throw new Error('não deveria baixar'); });
        const { client } = clientMock();
        global.client = client;
        const anexos = [{ url: 'https://cdn/big.mp4', name: 'big.mp4', contentType: 'video/mp4', size: 999 * 1024 * 1024 }];
        const r = await Honeypot.salvarMidia(anexos);
        clearFetchImpl();
        assert.strictEqual(r.enviados.length, 0, 'não baixou');
        assert.strictEqual(r.grandes.length, 1, 'foi para grandes');
        global.client = undefined;
    });

    await teste('salvarMidia: falha de download vai para "falhas" (não "grandes")', async () => {
        setFetchImpl(async () => { throw new Error('HTTP 403'); });
        const { client } = clientMock();
        global.client = client;
        const anexos = [{ url: 'https://cdn/x.png', name: 'x.png', contentType: 'image/png', size: 100 }];
        const r = await Honeypot.salvarMidia(anexos);
        clearFetchImpl();
        assert.strictEqual(r.enviados.length, 0, 'não enviou');
        assert.strictEqual(r.grandes.length, 0, 'NÃO foi para grandes');
        assert.strictEqual(r.falhas.length, 1, 'foi para falhas');
        assert.strictEqual(r.falhas[0].nome, 'x.png');
        global.client = undefined;
    });

    await teste('enviarAlerta: falha de download de mídia pequena NÃO some do alerta', async () => {
        const { client, state } = clientMock();
        global.client = client;
        const { guild, author } = messageMock({ userId: id('fail'), content: 'x' });
        const midia = {
            enviados: [],
            grandes: [],
            // salvarMidia agora separa falhas de download em "falhas" (qualquer tamanho)
            falhas: [{ nome: 'falhou.png', url: 'https://cdn/falhou.png', size: 100, erro: 'HTTP 403' }],
        };
        await Honeypot.enviarAlerta({
            guild, user: author, tag: author.tag, uid: author.id,
            texto: 'x', anexos: [{ url: 'https://cdn/falhou.png', name: 'falhou.png', contentType: 'image/png', size: 100 }],
            midia, banOk: true, teste: false,
        });
        const embedJson = state.alertMessages[0].payload.embeds[0].toJSON();
        assert.ok(/falhou\.png/.test(JSON.stringify(embedJson)), 'o arquivo que falhou aparece no alerta (staff precisa saber)');
        global.client = undefined;
    });

    await teste('enviarAlerta: canal recebe embed + @everyone; dono recebe a MESMA imagem', async () => {
        const { client, state } = clientMock();
        global.client = client;
        const imgBuf = Buffer.from('img');
        const midia = { enviados: [{ nome: 'x.png', url: 'https://cdn.perm/x.png', tipo: 'image', buffer: imgBuf }], grandes: [] };
        const { guild, author } = messageMock({ userId: id('alert'), content: 'olha a foto', attachments: [{ url: 'https://cdn/x.png', name: 'x.png', contentType: 'image/png', size: 3 }] });
        await Honeypot.enviarAlerta({
            guild, user: author, tag: author.tag, uid: author.id,
            texto: 'olha a foto', anexos: [{ url: 'https://cdn/x.png', name: 'x.png', contentType: 'image/png', size: 3 }],
            midia, banOk: true, teste: false,
        });
        // 2 mensagens no canal de alerta: embed + @everyone
        assert.ok(state.alertMessages.length >= 1, 'embed no canal de alerta');
        // a 1ª mensagem (embed) tem que ter o arquivo anexado (attachment:// resolve)
        const primeira = state.alertMessages[0];
        assert.ok(primeira.files && primeira.files.length === 1, 'embed do alerta anexa a imagem');
        // @everyone em mensagem separada
        const temEveryone = state.alertMessages.some(m => m.payload && m.payload.content && /@everyone/.test(m.payload.content));
        assert.ok(temEveryone, '@everyone em mensagem separada');
        // DM do dono: tem que mostrar a imagem (arquivo anexado OU url não-attachment)
        assert.strictEqual(state.ownerDMs.length, 1, 'dono recebeu 1 DM');
        const dm = state.ownerDMs[0];
        const embedImg = dm.embeds && dm.embeds[0] && dm.embeds[0].image;
        const dmTemArquivo = dm.files && dm.files.length > 0;
        const imgResolve = embedImg && !String(embedImg.url || '').startsWith('attachment://');
        assert.ok(dmTemArquivo || imgResolve, 'a imagem aparece na DM do dono (arquivo anexado ou URL válida, não attachment:// órfão)');
        global.client = undefined;
    });

    await teste('avisoExiste: detecta o embed de aviso no canal', async () => {
        const canal = {
            messages: {
                async fetch() {
                    const m = new Map();
                    m.set('1', { embeds: [{ title: '⚠️ Canal de segurança — não envie mensagens', footer: { text: 'HostVille • Honeypot' } }] });
                    return m;
                },
            },
        };
        assert.strictEqual(await Honeypot.avisoExiste(canal), true, 'detecta aviso existente');
    });

    await teste('avisoExiste: canal vazio → false', async () => {
        const canal = { messages: { async fetch() { return new Map(); } } };
        assert.strictEqual(await Honeypot.avisoExiste(canal), false);
    });

    await teste('isExento: dono e staff são isentos; membro comum não', () => {
        const owner = messageMock({ userId: String(config.OWNER_ID || 'owner-1') });
        if (config.OWNER_ID) assert.strictEqual(Honeypot.isExento(owner.message), true, 'owner isento');
        const normal = messageMock({ userId: id('n'), member: memberMock({ userId: id('n') }) });
        assert.strictEqual(Honeypot.isExento(normal.message), false, 'comum não isento');
    });

    await teste('buildIntroEmbed: aviso com título de segurança e menção a banimento', () => {
        const j = Honeypot.buildIntroEmbed().toJSON();
        assert.ok(/segurança/i.test(j.title || ''), 'título menciona segurança');
        assert.ok(/banimento/i.test(j.description || ''), 'descrição menciona banimento');
    });
}

// ════════════════════════════════════════════════════════════════════════
// HONEYPOT — WATCHDOG DO CANAL (existência + recriação automática)
// ════════════════════════════════════════════════════════════════════════
async function testarWatchdogCanal() {
    console.log('\n=== Honeypot Watchdog (canal existe? recria?) ===\n');

    // Client mock que suporta recriar canal (guild.channels.create).
    function watchdogClient(opts = {}) {
        const alertas = [];
        const criacoes = [];
        let canalAtual = opts.canalInicial || null;
        const canalAlerta = { send: async (p) => { alertas.push(p); return {}; } };
        const guildFake = {
            id: opts.guildId || 'g-rec',
            channels: {
                async create(optsCriacao) {
                    criacoes.push(optsCriacao);
                    const novo = {
                        id: 'novo-' + criacoes.length,
                        name: optsCriacao.name,
                        async send() { return { attachments: { first: () => null } }; },
                        messages: { async fetch() { return new Map(); } },
                    };
                    canalAtual = novo;
                    return novo;
                },
            },
        };
        const cache = new Map();
        cache.set(String(config.HONEYPOT.ALERT_CHANNEL_ID), canalAlerta);
        if (canalAtual) cache.set(String(canalAtual.id), canalAtual);
        const client = {
            channels: {
                cache,
                async fetch(id) {
                    const sid = String(id);
                    if (cache.has(sid)) return cache.get(sid);
                    const e = new Error('Unknown Channel'); e.code = 10003; throw e;
                },
            },
            guilds: { cache: new Map([[String(guildFake.id), guildFake]]), async fetch() { return guildFake; } },
        };
        return { client, alertas, criacoes, guildFake };
    }

    await teste('verificarCanal: cache hit → devolve o canal', async () => {
        const fakeCanal = { id: config.HONEYPOT.CHANNEL_ID, send: async () => ({}), name: 'canal' };
        const client = { channels: { cache: new Map([[String(config.HONEYPOT.CHANNEL_ID), fakeCanal]]), async fetch() { throw new Error('não deveria'); } } };
        const r = await Honeypot.verificarCanal(client);
        assert.strictEqual(r, fakeCanal, 'achou no cache');
    });

    await teste('verificarCanal: fetch 10003 → null; erro de rede → undefined', async () => {
        const c1 = { channels: { cache: new Map(), async fetch() { const e = new Error('Unknown'); e.code = 10003; throw e; } } };
        assert.strictEqual(await Honeypot.verificarCanal(c1), null, '10003 → null');
        const c2 = { channels: { cache: new Map(), async fetch() { throw new Error('ETIMEDOUT'); } } };
        assert.strictEqual(await Honeypot.verificarCanal(c2), undefined, 'rede → undefined');
    });

    await teste('recreateCanal: cria no topo, fora de categoria, atualiza ID', async () => {
        const { client, criacoes } = watchdogClient();
        Honeypot._setClientForTest(client);
        const canal = await Honeypot.recreateCanal(client, 'g-rec', '🛡️ canal', 'teste');
        assert.ok(canal, 'recriou');
        assert.strictEqual(criacoes.length, 1);
        assert.strictEqual(criacoes[0].parent, null, 'fora de categoria');
        assert.strictEqual(criacoes[0].position, 0, 'no topo');
        assert.strictEqual(Honeypot.getCanalId(), canal.id, 'ID atualizado');
        global.client = undefined;
    });

    await teste('handleChannelDelete: canal do honeypot → recria automaticamente', async () => {
        const { client, criacoes, alertas } = watchdogClient();
        Honeypot._setClientForTest(client);
        Honeypot._resetEstadoCanal();
        await Honeypot.handleChannelDelete({ id: config.HONEYPOT.CHANNEL_ID, name: 'velho', guild: { id: 'g-rec' } });
        assert.ok(criacoes.length >= 1, 'recriou o canal');
        assert.ok(alertas.length >= 1, 'avisou a staff');
        global.client = undefined;
    });

    await teste('handleChannelDelete: canal diferente → NÃO recria/alerta', async () => {
        const { client, criacoes, alertas } = watchdogClient();
        Honeypot._setClientForTest(client);
        Honeypot._resetEstadoCanal();
        await Honeypot.handleChannelDelete({ id: 'outro-canal', name: 'x', guild: { id: 'g-rec' } });
        assert.strictEqual(criacoes.length, 0);
        assert.strictEqual(alertas.length, 0);
        global.client = undefined;
    });

    await teste('checarCanal: canal sumiu → recria automaticamente', async () => {
        const { client, criacoes } = watchdogClient({ canalInicial: { id: config.HONEYPOT.CHANNEL_ID, name: 'old', send: async () => ({}), messages: { async fetch() { return new Map(); } } } });
        client.channels.cache.delete(String(config.HONEYPOT.CHANNEL_ID));
        Honeypot._setClientForTest(client);
        Honeypot._setCanalInfoTest({ channelId: config.HONEYPOT.CHANNEL_ID, guildId: 'g-rec' });
        Honeypot._resetEstadoCanal();
        const orig = config.HONEYPOT.CHECK_ENABLED; config.HONEYPOT.CHECK_ENABLED = true;
        await Honeypot.checarCanal(client);
        config.HONEYPOT.CHECK_ENABLED = orig;
        assert.ok(criacoes.length >= 1, 'recriou quando sumiu');
        global.client = undefined;
    });

    await teste('checarCanal: canal existe + aviso ausente → reposta o aviso', async () => {
        const enviados = [];
        const fakeCanal = {
            id: config.HONEYPOT.CHANNEL_ID,
            async send(p) { enviados.push(p); return {}; },
            messages: { async fetch() { return new Map(); } },
        };
        const client = {
            channels: { cache: new Map([[String(config.HONEYPOT.CHANNEL_ID), fakeCanal]]), async fetch() { return fakeCanal; } },
            guilds: { cache: new Map(), async fetch() { return null; } },
        };
        Honeypot._setClientForTest(client);
        Honeypot._resetEstadoCanal();
        const orig = config.HONEYPOT.CHECK_ENABLED; config.HONEYPOT.CHECK_ENABLED = true;
        await Honeypot.checarCanal(client);
        config.HONEYPOT.CHECK_ENABLED = orig;
        assert.ok(enviados.length >= 1, 'repostou o aviso');
        global.client = undefined;
    });
}

// ════════════════════════════════════════════════════════════════════════
(async () => {
    try {
        await testarAntiRaid();
        await testarHoneypot();
        await testarWatchdogCanal();
    } finally {
        try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
    }

    console.log(`\n${passou} ok | ${falhou} falhas\n`);
    if (falhou > 0) {
        console.log('Falhas:');
        falhas.forEach(f => console.log('  - ' + f));
    }
    process.exit(falhou > 0 ? 1 : 0);
})();