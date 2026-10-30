/**
 * Testes da numeração de tickets.
 *
 * A contagem mora em data/ticketChannels.json (não no Mongo): apagar o
 * ticket libera o número e o próximo reaproveita a numeração. Estes testes
 * rodam contra um arquivo temporário — o registro real nunca é tocado.
 *
 *   node tests/numeracao-ticket.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = path.join(os.tmpdir(), 'ticketChannels-teste-' + process.pid + '.json');
process.env.TICKET_CHANNELS_FILE = TMP;

const RAIZ = path.join(__dirname, '..');

// Log separado do bot (ver utils/logger.js: LOG_FILE). Sem isto as linhas
// de teste caem no logs/bot-*.log junto com as do bot rodando, e o
// diagnostico fica impossivel: nao da para saber qual processo escreveu.
process.env.LOG_FILE = process.env.LOG_FILE || 'teste.log';

function gravar(obj) {
    fs.writeFileSync(TMP, JSON.stringify(obj, null, 2));
}
function carregar() {
    return JSON.parse(fs.readFileSync(TMP, 'utf8'));
}
function recarregar() {
    for (const k of Object.keys(require.cache)) {
        if (k.includes('TicketManager')) delete require.cache[k];
    }
    return require(path.join(RAIZ, 'managers/TicketManager'));
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
    try {
        // 1) arquivo vazio -> comeca no 1
        await teste('arquivo vazio comeca no #0001', async () => {
            gravar({});
            const TM = recarregar();
            assert.strictEqual(TM.nextTicketNumber(), 1);
            assert.strictEqual(TM.nextTicketNumber(), 2);
        });

        // 2) comeca DEPOIS do maior numero do arquivo
        await teste('comeca depois do maior numero registrado', async () => {
            gravar({
                c1: { status: 'ativo', category: 'suporte', number: 27 },
                c2: { status: 'ativo', category: 'duvidas', number: 5 },
            });
            const TM = recarregar();
            assert.strictEqual(TM.nextTicketNumber(), 28);
        });

        // 3) dois tickets no mesmo instante nao recebem o mesmo numero
        await teste('duas alocacoes seguidas nunca colidem', async () => {
            gravar({ c1: { status: 'ativo', number: 10 } });
            const TM = recarregar();
            const a = TM.nextTicketNumber();
            const b = TM.nextTicketNumber();
            assert.notStrictEqual(a, b, `colidiu: ${a} e ${b}`);
            assert.strictEqual(b, a + 1);
        });

        // 4) apagar o ticket libera o numero (o pedido principal)
        await teste('apagar o ticket libera o numero para o proximo', async () => {
            gravar({});
            const TM = recarregar();
            const n1 = TM.nextTicketNumber();   // 1
            TM.registerTicketChannel('c1', { category: 'suporte', number: n1, guildId: 'g', userId: 'u', createdAt: 1 });
            const n2 = TM.nextTicketNumber();   // 2
            TM.registerTicketChannel('c2', { category: 'suporte', number: n2, guildId: 'g', userId: 'u', createdAt: 2 });
            assert.strictEqual(carregar()['c2'].number, 2);

            await TM.removeTicketChannel('c2');          // staff apaga o canal
            assert.strictEqual(carregar()['c2'], undefined, 'a entrada deveria sumir do arquivo');
            assert.strictEqual(TM.nextTicketNumber(), 2, 'o 2 deveria ter sido liberado');
        });

        // 5) apagar o arquivo inteiro zera a contagem
        await teste('apagar o registro zera a contagem', async () => {
            gravar({});
            const TM = recarregar();
            TM.nextTicketNumber();
            TM.nextTicketNumber();
            TM.nextTicketNumber(); // chegou em 4
            gravar({});             // "apaguei o arquivo"
            const TM2 = recarregar();
            assert.strictEqual(TM2.nextTicketNumber(), 1, 'deveria voltar ao #0001');
        });

        // 6) ticket antigo aberto NAO e renumerado (evita colisao entre vivos)
        await teste('apagar ticket antigo nao repete numero de ticket aberto', async () => {
            gravar({});
            const TM = recarregar();
            const a = TM.nextTicketNumber(); // 1 (fica aberto)
            const b = TM.nextTicketNumber(); // 2 (sera apagado)
            TM.registerTicketChannel('cA', { category: 'suporte', number: a, guildId: 'g', userId: 'u', createdAt: 1 });
            TM.registerTicketChannel('cB', { category: 'suporte', number: b, guildId: 'g', userId: 'u', createdAt: 2 });
            await TM.removeTicketChannel('cB');
            const c = TM.nextTicketNumber();
            // o #2 foi liberado e volta a ser usado (é o objetivo), mas o
            // ticket que continua aberto jamais pode ser reatribuído
            assert.notStrictEqual(c, a, `o ticket aberto #${a} nao pode ser reatribuido (veio ${c})`);
            assert.strictEqual(carregar()['cA'].number, a, 'o registro do ticket aberto foi alterado');
        });

        // 7) removeTicketChannel devolve false para canal desconhecido
        await teste('remover canal desconhecido nao quebra nada', async () => {
            gravar({});
            const TM = recarregar();
            assert.strictEqual(await TM.removeTicketChannel('nao-existe'), false);
        });

        // 8) a numeracao nao depende mais do Mongo
        await teste('nenhum caminho de criacao usa o contador do Mongo', () => {
            const src = fs.readFileSync(path.join(RAIZ, 'managers/TicketManager.js'), 'utf8');
            assert.ok(!/incrementTicketCounter\(\)/.test(src), 'ainda ha chamada ao contador do Mongo');
            assert.ok(!/db\.incrementTicketCounter/.test(src), 'ainda ha db.incrementTicketCounter');
            const usos = (src.match(/this\.nextTicketNumber\(\)/g) || []).length;
            assert.strictEqual(usos, 2, `esperava 2 usos de nextTicketNumber, achei ${usos}`);
        });
    } finally {
        try { fs.unlinkSync(TMP); } catch (e) {}
    }

    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou ? 1 : 0);
})();
