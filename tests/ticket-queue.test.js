const assert = require('assert');
const path = require('path');
const RAIZ = path.join(__dirname, '..');

let passou = 0, falhou = 0;
async function teste(nome, fn) {
    try { await fn(); console.log('  ok   ' + nome); passou++; }
    catch (e) {
        console.log('  FALHA ' + nome);
        console.log('       ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n       ') : e));
        falhou++;
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function makeMsg(id, channelId = 'c1') {
    return { id, channelId, content: 'msg ' + id, author: { id: 'u1' }, channel: { id: channelId, send: async () => {} } };
}

(async () => {
    const TicketQueue = require(path.join(RAIZ, 'managers', 'TicketQueue'));

    await teste('coalescencia: 2 mensagens -> 1 chamada com 2 itens', async () => {
        let calls = 0;
        let lastLen = 0;
        const proc = async (lote) => { calls++; lastLen = lote.length; };
        const m1 = makeMsg('m1');
        const m2 = makeMsg('m2');
        TicketQueue.enqueue(m1, { category: 'duvidas' }, proc);
        await sleep(200);
        TicketQueue.enqueue(m2, { category: 'duvidas' }, proc);
        await sleep(2000);
        assert.strictEqual(calls, 1, 'processor deve ser chamado 1 vez');
        assert.strictEqual(lastLen, 2, 'lote deve ter 2 itens');
    });

    await teste('cancel antes do flush: processor nao chamado', async () => {
        let calls = 0;
        const proc = async (lote) => { calls++; };
        const m1 = makeMsg('m3', 'c2');
        TicketQueue.enqueue(m1, { category: 'duvidas' }, proc);
        TicketQueue.cancel('c2', { removerRefs: false });
        await sleep(2000);
        assert.strictEqual(calls, 0, 'processor nao deve ser chamado apos cancel');
    });

    await teste('lotes separados: segundo lote apos primeiro terminar', async () => {
        let calls = 0;
        const proc = async (lote) => { calls++; await sleep(300); };
        const m1 = makeMsg('m4', 'c3');
        TicketQueue.enqueue(m1, { category: 'duvidas' }, proc);
        await sleep(1500); // primeiro flush
        const m2 = makeMsg('m5', 'c3');
        TicketQueue.enqueue(m2, { category: 'duvidas' }, proc);
        await sleep(2000);
        assert.strictEqual(calls, 2, 'devem ser 2 chamadas (2 lotes)');
    });

    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou ? 1 : 0);
})();
