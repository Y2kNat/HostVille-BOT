/**
 * Testes do utils/warnStore.js — o store de avisos (punições).
 *
 * Aviso é PUNIÇÃO: perder um é dar reset grátis de punição. Estes testes
 * existem para travar duas garantias:
 *
 *   1. O `guildId` é gravado DENTRO do aviso (o arquivo é autodescritivo).
 *   2. NENHUMA escrita pode reduzir o histórico em silêncio. Só o `clear()`
 *      (que a staff mandou) pode.
 *
 * Todos rodam contra um arquivo TEMPORÁRIO (WARNINGS_FILE): o histórico
 * real de punição nunca é tocado por teste.
 *
 *   node tests/warnstore.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
process.env.LOG_FILE = process.env.LOG_FILE || 'teste.log';

/** Arquivo temporário próprio deste teste. */
const TMP = path.join(os.tmpdir(), `warnstore-teste-${process.pid}.json`);
process.env.WARNINGS_FILE = TMP;

/** Recarrega o store limpo (singleton com o cache zerado). */
function store() {
    delete require.cache[require.resolve(path.join(RAIZ, 'utils/warnStore'))];
    return require(path.join(RAIZ, 'utils/warnStore'));
}

function limpar() {
    for (const f of [TMP, TMP + '.bak', TMP + '.tmp-' + process.pid]) {
        try { fs.unlinkSync(f); } catch (e) {}
    }
}

let passou = 0, falhou = 0;
async function teste(nome, fn) {
    try { await fn(); console.log('  ok   ' + nome); passou++; }
    catch (e) {
        console.log('  FALHA ' + nome);
        console.log('       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e));
        falhou++;
    }
}

(async () => {
    // ============================================================
    // 1) guildId dentro do aviso
    // ============================================================

    await teste('add() grava o guildId DENTRO do aviso', () => {
        limpar();
        const S = store();
        S.add('u1', { reason: 'teste', guildId: 'g1', timestamp: 1000 });
        const dados = JSON.parse(fs.readFileSync(TMP, 'utf8'));
        const aviso = dados['g1:u1'][0];
        assert.strictEqual(aviso.guildId, 'g1',
            `o aviso precisa carregar o guildId, veio ${JSON.stringify(aviso)}`);
    });

    await teste('aviso sem guild explicito cai no legado (unknown)', () => {
        limpar();
        const S = store();
        S.add('u2', { reason: 'teste', timestamp: 2000 });
        const dados = JSON.parse(fs.readFileSync(TMP, 'utf8'));
        assert.ok(dados['unknown:u2'], `a chave deveria ser unknown:u2, veio ${Object.keys(dados)}`);
        assert.strictEqual(dados['unknown:u2'][0].guildId, 'unknown');
    });

    await teste('o get() continua devolvendo o guildId', () => {
        limpar();
        const S = store();
        S.add('u3', { reason: 'teste', guildId: 'g1', timestamp: 3000 });
        const lidos = S.get('u3', 'g1');
        assert.strictEqual(lidos.length, 1);
        assert.strictEqual(lidos[0].guildId, 'g1');
        assert.strictEqual(lidos[0].legacy, false);
    });

    await teste('aviso legado conta em qualquer servidor', () => {
        limpar();
        const S = store();
        S.add('u4', { reason: 'teste', timestamp: 4000 });   // legado
        S.add('u4', { reason: 'teste', guildId: 'g9', timestamp: 4001 });
        // no servidor g9: o do g9 + o legado
        assert.strictEqual(S.get('u4', 'g9').length, 2);
        // no servidor g1: só o legado
        assert.strictEqual(S.get('u4', 'g1').length, 1);
    });

    // ============================================================
    // 2) GUARDA: nenhuma escrita reduz o histórico em silêncio
    // ============================================================

    await teste('uma escrita que reduzir o historico é MESCLADA, não aceita', () => {
        limpar();
        const S = store();
        S.add('u1', { reason: 'a', guildId: 'g1', timestamp: 1000 });
        S.add('u2', { reason: 'b', guildId: 'g1', timestamp: 1001 });
        const antes = S._contar(S._lerDoDisco());
        assert.strictEqual(antes, 2);

        // Escrita "de estado velho": um objeto montado do zero que contem
        // SO um dos avisos. É o que sobrescrevia o arquivo e zerava a
        // escada de punição sem aviso nenhum.
        const parcial = { 'g1:u1': [{ reason: 'a', moderator: null, auto: false, timestamp: 1000 }] };
        S._gravar(parcial);

        const depois = S._contar(S._lerDoDisco());
        assert.strictEqual(depois, 2,
            `o historico nao pode diminuir: foi de ${antes} para ${depois}`);
        assert.ok(S._lerDoDisco()['g1:u2'], 'o aviso que sumiu tem que voltar');
    });

    await teste('a guarda nao atrapalha o add() normal', () => {
        limpar();
        const S = store();
        for (let i = 0; i < 5; i++) S.add('u1', { reason: 'r' + i, guildId: 'g1', timestamp: 1000 + i });
        assert.strictEqual(S._contar(S._lerDoDisco()), 5);
    });

    await teste('a guarda nao atrapalha quando um processo externo gravou', () => {
        // Cenário real: o bot carrega o store, OUTRO processo grava mais
        // avisos, e o bot grava o seu. Os avisos do outro processo têm que
        // sobreviver.
        limpar();
        const S = store();
        S.add('u1', { reason: 'a', guildId: 'g1', timestamp: 1000 });

        // "outro processo"
        const externo = JSON.parse(fs.readFileSync(TMP, 'utf8'));
        externo['g1:u2'] = [{ reason: 'b', moderator: null, auto: false, timestamp: 1001 }];
        fs.writeFileSync(TMP, JSON.stringify(externo, null, 2));

        // o bot grava o seu
        S.add('u1', { reason: 'c', guildId: 'g1', timestamp: 1002 });

        const final = S._contar(S._lerDoDisco());
        assert.strictEqual(final, 3, `os avisos do outro processo sumiram: total ${final}`);
    });

    await teste('arquivo APAGADO: o .bak traz o historico de volta', () => {
        // "Se alguém limpar data/ achando que é lixo, o histórico de
        // punição some" — é o medo do teste de moderacao. O .bak existe
        // para isso: apagado o arquivo, a leitura cai nele e o proximo
        // aviso reescreve o historico inteiro.
        limpar();
        const S = store();
        S.add('u1', { reason: 'a', guildId: 'g1', timestamp: 1000 });
        S.add('u2', { reason: 'b', guildId: 'g1', timestamp: 1001 });
        assert.ok(fs.existsSync(TMP + '.bak'), 'o .bak tem que existir');

        // simula alguém limpando data/
        fs.unlinkSync(TMP);

        // novo processo do bot
        delete require.cache[require.resolve(path.join(RAIZ, 'utils/warnStore'))];
        const S2 = require(path.join(RAIZ, 'utils/warnStore'));
        S2.add('u3', { reason: 'c', guildId: 'g1', timestamp: 1002 });

        const final = S2._contar(S2._lerDoDisco());
        assert.ok(final >= 3, `o historico nao pode sumir com o arquivo apagado: sobrou ${final}`);
        assert.strictEqual(S2.get('u1', 'g1').length, 1, 'o aviso do u1 tem que voltar pelo .bak');
    });

    await teste('clear() PODE reduzir (e so o que ele)', () => {
        limpar();
        const S = store();
        S.add('u1', { reason: 'a', guildId: 'g1', timestamp: 1000 });
        S.add('u2', { reason: 'b', guildId: 'g1', timestamp: 1001 });
        assert.strictEqual(S._contar(S._lerDoDisco()), 2);

        S.clear('u1', 'g1');
        assert.strictEqual(S._contar(S._lerDoDisco()), 1,
            'o clear tem que conseguir remover o aviso do usuário');
        assert.strictEqual(S.get('u1', 'g1').length, 0);
        assert.strictEqual(S.get('u2', 'g1').length, 1, 'o clear não pode tocar em outro usuário');
    });

    await teste('clear() de um servidor nao apaga o de outro', () => {
        limpar();
        const S = store();
        S.add('u1', { reason: 'a', guildId: 'g1', timestamp: 1000 });
        S.add('u1', { reason: 'b', guildId: 'g2', timestamp: 1001 });
        S.clear('u1', 'g1');
        assert.strictEqual(S.get('u1', 'g1').length, 0);
        assert.strictEqual(S.get('u1', 'g2').length, 1,
            'limpar no g1 nao pode apagar o historico do g2');
    });

    await teste('o legado sobrevive ao clear de um servidor', () => {
        limpar();
        const S = store();
        S.add('u1', { reason: 'legado', timestamp: 1000 });
        S.add('u1', { reason: 'do g1', guildId: 'g1', timestamp: 1001 });
        S.clear('u1', 'g1');
        assert.strictEqual(S.get('u1', 'g1').length, 1,
            'o aviso legado continua contavel (origem desconhecida)');
    });

    // ============================================================
    // 3) fundir() — a união que devolve o que sumiu
    // ============================================================

    await teste('fundir() devolve o que o novo estado perdeu', () => {
        const base = {
            'g1:u1': [{ reason: 'a', timestamp: 1 }],
            'g1:u2': [{ reason: 'b', timestamp: 2 }],
        };
        const novo = {
            'g1:u1': [{ reason: 'a', timestamp: 1 }],
        };
        const f = store()._fundir(base, novo);
        assert.strictEqual(f['g1:u1'].length, 1, 'o que existe nos dois nao duplica');
        assert.strictEqual(f['g1:u2'].length, 1, 'o que sumiu tem que voltar');
    });

    await teste('fundir() nao duplica o mesmo aviso', () => {
        const base = { 'g1:u1': [{ reason: 'a', timestamp: 1 }] };
        const novo = { 'g1:u1': [{ reason: 'a', timestamp: 1, moderator: 'x' }] };
        const f = store()._fundir(base, novo);
        assert.strictEqual(f['g1:u1'].length, 1, 'mesmo timestamp+motivo = mesmo aviso');
    });

    limpar();
    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou ? 1 : 0);
})();
