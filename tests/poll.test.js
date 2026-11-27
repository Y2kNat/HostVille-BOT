const assert = require('assert');
const PollManager = require('../managers/PollManager');

assert.strictEqual(PollManager.validarOpcoes(['a', 'b']), null);
assert.ok(PollManager.validarOpcoes(['a']));
assert.ok(PollManager.validarOpcoes(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']));
assert.ok(PollManager.validarOpcoes(['a', 'x'.repeat(51)]));
const sp = PollManager.agoraSP();
assert.ok(typeof sp.day === 'number' && sp.day >= 0 && sp.day <= 6);
assert.match(sp.time, /^\d{2}:\d{2}$/);
assert.match(sp.key, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
assert.strictEqual(PollManager.DIAS.length, 7);
console.log('poll: 6 testes passaram');