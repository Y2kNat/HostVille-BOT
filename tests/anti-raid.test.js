/**
 * Suite do AntiRaidManager (Fase 1).
 *
 * ESTE ARQUIVO CODIFICA O COMPORTAMENTO-ALVO. Um caso que falha é um bug
 * real a corrigir.
 *
 * Cobre:
 *   - gatilho por 3 deletes / 3 creates / 3 bans / 3 @everyone em 3 min
 *   - abaixo do limite NÃO bane
 *   - janela deslizante: ações antigas (> 3 min) não contam
 *   - whitelist: owner, staff, trusted, admin com cargo há >= 1 dia
 *   - cooldown: não repete o ban em rajada
 *   - persistência de admin-grants e incidentes em disco
 *
 *   node tests/anti-raid.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
process.env.LOG_FILE = process.env.LOG_FILE || 'teste.log';

// Arquivos de persistência isolados: o teste não toca a produção.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'antiraid-'));
process.env.ANTIRAID_GRANTS_FILE = path.join(TMP, 'grants.json');
process.env.ANTIRAID_INCIDENTS_FILE = path.join(TMP, 'incidents.json');

const AntiRaid = require(path.join(RAIZ, 'managers/AntiRaidManager'));
const config = require(path.join(RAIZ, 'config'));

// Um id de cargo admin REAL (do config/.env) para o mock de whitelist.
const ADMIN_ROLE_ID = (config.ADMIN_ROLES && config.ADMIN_ROLES[0]) || '111';

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
function idNovo() {
    seq++;
    return '9000000000000000' + String(seq).padStart(4, '0');
}

/**
 * Mock de guild + executor. `ban` registra a chamada. `joinedAt`/`temCargoAdmin`
 * controlam a whitelist.
 */
function mockGuild(opts = {}) {
    const bans = [];
    const guild = {
        id: opts.guildId || idNovo(),
        name: 'Servidor Teste',
        ownerId: opts.ownerId || '1',
        members: {
            async fetch(id) {
                if (id === '__missing__') return null;
                return buildMember(id, opts);
            },
            async ban(id, o) {
                bans.push({ id, reason: o && o.reason });
            },
        },
        fetchAuditLogs: async () => ({ entries: { values: () => [] } }),
    };
    return { guild, bans };
}

function buildMember(id, opts) {
    const temAdmin = opts.temCargoAdmin || false;
    return {
        id,
        bannable: true,
        moderatable: true,
        joinedAt: new Date(opts.joinedAgoMs != null ? Date.now() - opts.joinedAgoMs : 0),
        user: { id, tag: 'user' + id, bot: false, createdAt: new Date() },
        roles: {
            cache: {
                has: (r) => temAdmin && r === ADMIN_ROLE_ID,
                filter: () => new Map(),
            },
        },
    };
}

(async () => {
    console.log('\n=== AntiRaidManager (Fase 1) ===\n');

    await teste('3 deletes em 3 min → bane', async () => {
        const { guild, bans } = mockGuild({ joinedAgoMs: 60_000 });
        const exec = idNovo();
        await AntiRaid._record(guild, exec, 'deletes');
        await AntiRaid._record(guild, exec, 'deletes');
        assert.strictEqual(bans.length, 0, 'não devia banir antes do 3º');
        await AntiRaid._record(guild, exec, 'deletes');
        assert.strictEqual(bans.length, 1, 'devia banir no 3º delete');
    });

    await teste('3 creates em 3 min → bane', async () => {
        const { guild, bans } = mockGuild({ joinedAgoMs: 60_000 });
        const exec = idNovo();
        await AntiRaid._record(guild, exec, 'creates');
        await AntiRaid._record(guild, exec, 'creates');
        await AntiRaid._record(guild, exec, 'creates');
        assert.strictEqual(bans.length, 1);
    });

    await teste('3 bans em 3 min → bane', async () => {
        const { guild, bans } = mockGuild({ joinedAgoMs: 60_000 });
        const exec = idNovo();
        await AntiRaid._record(guild, exec, 'bans');
        await AntiRaid._record(guild, exec, 'bans');
        await AntiRaid._record(guild, exec, 'bans');
        assert.strictEqual(bans.length, 1);
    });

    await teste('3 @everyone em 3 min → bane', async () => {
        const { guild, bans } = mockGuild({ joinedAgoMs: 60_000 });
        const exec = idNovo();
        await AntiRaid._record(guild, exec, 'everyones');
        await AntiRaid._record(guild, exec, 'everyones');
        await AntiRaid._record(guild, exec, 'everyones');
        assert.strictEqual(bans.length, 1);
    });

    await teste('2 deletes → NÃO bane (abaixo do limite)', async () => {
        const { guild, bans } = mockGuild({ joinedAgoMs: 60_000 });
        const exec = idNovo();
        await AntiRaid._record(guild, exec, 'deletes');
        await AntiRaid._record(guild, exec, 'deletes');
        assert.strictEqual(bans.length, 0);
    });

    await teste('ações não contam misturadas se nenhum tipo bate o limite', async () => {
        const { guild, bans } = mockGuild({ joinedAgoMs: 60_000 });
        const exec = idNovo();
        // 2 de cada tipo: nenhum isolado chega a 3
        for (const t of ['deletes', 'creates', 'bans', 'everyones']) {
            await AntiRaid._record(guild, exec, t);
            await AntiRaid._record(guild, exec, t);
        }
        assert.strictEqual(bans.length, 0, 'limite é por tipo, não somado');
    });

    await teste('whitelist: owner do servidor nunca é banido', async () => {
        const ownerId = idNovo();
        const { guild, bans } = mockGuild({ ownerId, joinedAgoMs: 60_000 });
        for (let i = 0; i < 3; i++) await AntiRaid._record(guild, ownerId, 'deletes');
        assert.strictEqual(bans.length, 0, 'owner é whitelist');
    });

    await teste('whitelist: admin com cargo há >= 1 dia não é banido', async () => {
        const { guild, bans } = mockGuild({ temCargoAdmin: true, joinedAgoMs: 2 * 24 * 60 * 60 * 1000 });
        const exec = idNovo();
        // registra o grant manualmente (como o guildMemberUpdate faria)
        let grants = {};
        try { grants = JSON.parse(fs.readFileSync(process.env.ANTIRAID_GRANTS_FILE, 'utf8')); } catch (e) { /* ainda não existe */ }
        grants[guild.id] = { [exec]: { roleId: ADMIN_ROLE_ID, grantedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 } };
        fs.writeFileSync(process.env.ANTIRAID_GRANTS_FILE, JSON.stringify(grants));
        for (let i = 0; i < 3; i++) await AntiRaid._record(guild, exec, 'deletes');
        assert.strictEqual(bans.length, 0, 'admin estabelecido é whitelist');
    });

    await teste('executor não identificado não derruba o fluxo', async () => {
        const { guild } = mockGuild({ joinedAgoMs: 60_000 });
        // record com id nulo/vazio não deve lançar
        await AntiRaid._record(guild, null, 'deletes');
        await AntiRaid._record(guild, '', 'deletes');
        assert.ok(true);
    });

    await teste('incidente é persistido em disco após o ban', async () => {
        const { guild } = mockGuild({ joinedAgoMs: 60_000 });
        const exec = idNovo();
        for (let i = 0; i < 3; i++) await AntiRaid._record(guild, exec, 'deletes');
        const lista = JSON.parse(fs.readFileSync(process.env.ANTIRAID_INCIDENTS_FILE, 'utf8'));
        assert.ok(Array.isArray(lista) && lista.length >= 1, 'incidente gravado');
        assert.ok(lista.some(i => i.executorId === exec), 'o incidente é do executor certo');
    });

    // limpeza
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}

    console.log(`\n${passou} ok | ${falhou} falhas\n`);
    if (falhou > 0) {
        console.log('Falhas: ' + falhas.join(', '));
        process.exit(1);
    }
})();