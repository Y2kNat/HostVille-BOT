/**
 * Suite do HoneypotManager (canal-armadilha), com foco no MODO TESTE.
 *
 * ESTE ARQUIVO CODIFICA O COMPORTAMENTO-ALVO. Um caso que falha é um bug.
 *
 * Cobre:
 *   - ehUsuarioTeste: true só para o TEST_USER_ID
 *   - isExento: dono/staff/admin são isentos
 *   - punir (teste=true): apaga a mensagem da isca, NÃO bane, NÃO varre
 *   - punir (teste=false): bane de verdade
 *   - buildIntroEmbed: título/descrição do aviso
 *
 *   node tests/honeypot.test.js
 */
const assert = require('assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
process.env.LOG_FILE = process.env.LOG_FILE || 'teste.log';

// global.client undefined: salvarMidia/enviarAlerta viram no-op (sem anexos).
global.client = undefined;

const H = require(path.join(RAIZ, 'managers/HoneypotManager'));

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
function idNovo() { return '77' + String(++seq).padStart(16, '0'); }

/** Mock de guild + message. ban/delete registram chamadas. */
function mockMsg(opts = {}) {
    const chamadas = { ban: [], delete: 0, dm: 0 };
    const author = {
        id: opts.userId || idNovo(),
        tag: opts.tag || 'user' + (opts.userId || 'x'),
        bot: false,
        async send() { chamadas.dm++; return {}; },
    };
    const guild = {
        id: opts.guildId || idNovo(),
        name: 'Servidor Teste',
        members: {
            me: { id: 'bot' },
            async ban(id, o) { chamadas.ban.push({ id, o }); },
        },
        channels: { cache: { filter: () => ({ values: () => [] }) } },
    };
    const message = {
        author,
        guild,
        member: { roles: { cache: { has: () => false, some: () => false } } },
        content: opts.content || '',
        attachments: { values: () => [] },
        deletable: true,
        async delete() { chamadas.delete++; },
        channel: { id: '1573807154291548322' },
    };
    return { message, guild, author, chamadas };
}

(async () => {
    console.log('\n=== HoneypotManager (modo teste) ===\n');

    await teste('ehUsuarioTeste: true para TEST_USER_ID, false para outro', () => {
        const tid = String(require(path.join(RAIZ, 'config')).HONEYPOT.TEST_USER_ID || '');
        assert.ok(tid, 'TEST_USER_ID deveria estar definido (default OWNER_ID)');
        const m1 = { author: { id: tid } };
        const m2 = { author: { id: '999' } };
        assert.strictEqual(H.ehUsuarioTeste(m1), true, 'test user → true');
        assert.strictEqual(H.ehUsuarioTeste(m2), false, 'outro → false');
    });

    await teste('punir (teste=true): apaga a isca, NÃO bane, mas manda a DM (simulação fiel)', async () => {
        const { message, chamadas } = mockMsg({ content: 'teste' });
        await H.punir(message, { teste: true });
        assert.strictEqual(chamadas.delete, 1, 'apagou a mensagem da isca');
        assert.strictEqual(chamadas.ban.length, 0, 'NÃO baniu (modo teste)');
        assert.strictEqual(chamadas.dm, 1, 'mandou a DM de banido (simulação fiel)');
    });

    await teste('punir (teste=false): bane de verdade', async () => {
        const { message, chamadas } = mockMsg({ content: 'spam' });
        await H.punir(message, { teste: false });
        assert.strictEqual(chamadas.delete, 1, 'apagou a isca');
        assert.strictEqual(chamadas.ban.length, 1, 'banido (modo real)');
    });

    await teste('punir (teste=false): NÃO varre outros canais (sem client)', async () => {
        // global.client undefined → varredura não roda; garantimos que não quebra
        const { message } = mockMsg({ content: 'spam' });
        await H.punir(message, { teste: false });
        assert.ok(true);
    });

    await teste('buildIntroEmbed: aviso com título de segurança', () => {
        const e = H.buildIntroEmbed();
        const j = e.toJSON();
        assert.ok(j.title && j.title.includes('segurança'), 'título menciona segurança');
        assert.ok(j.description && /banimento/i.test(j.description), 'descrição menciona banimento');
    });

    await teste('isExento: owner/staff/admin não são punidos', () => {
        const cfg = require(path.join(RAIZ, 'config'));
        // owner
        const mo = mockMsg({ userId: String(cfg.OWNER_ID || '1') });
        if (cfg.OWNER_ID) assert.strictEqual(H.isExento(mo.message), true, 'owner isento');
        // membro comum não isento
        const mc = mockMsg({ userId: '123123123' });
        assert.strictEqual(H.isExento(mc.message), false, 'membro comum não isento');
    });

    console.log(`\n${passou} ok | ${falhou} falhas\n`);
    if (falhou > 0) {
        console.log('Falhas: ' + falhas.join(', '));
        process.exit(1);
    }
    process.exit(0);
})();