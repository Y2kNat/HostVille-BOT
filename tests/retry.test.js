const assert = require('assert');
const { comRetry, padraoRetentavel } = require('../utils/retry');

(async () => {
    let n = 0;
    const r = await comRetry(async () => { n++; return 'ok'; }, { baseMs: 1 });
    assert.strictEqual(r, 'ok');
    assert.strictEqual(n, 1);

    n = 0;
    const r3 = await comRetry(async () => {
        n++;
        if (n < 3) { const e = new Error('fetch failed'); throw e; }
        return 'ok3';
    }, { baseMs: 1 });
    assert.strictEqual(r3, 'ok3');
    assert.strictEqual(n, 3);

    n = 0;
    await assert.rejects(() => comRetry(async () => { n++; const e = new Error('bad request'); e.status = 400; throw e; }, { baseMs: 1 }));
    assert.strictEqual(n, 1);

    n = 0;
    await assert.rejects(() => comRetry(async () => { n++; throw new Error('fetch failed'); }, { tentativas: 2, baseMs: 1 }));
    assert.strictEqual(n, 2);

    assert.strictEqual(padraoRetentavel({ message: 'fetch failed' }), true);
    assert.strictEqual(padraoRetentavel({ message: 'bad request', status: 400 }), false);
    console.log('retry: 5 testes passaram');
})().catch(e => { console.error(e); process.exit(1); });