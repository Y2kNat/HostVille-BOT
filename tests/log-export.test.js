const assert = require('assert');
const path = require('path');
const Exporter = require(path.join(__dirname, '..', 'managers/LogExporter'));

const sample = [
    '[24/11/2026, 10:00:00] INFO: boot ok',
    '[24/11/2026, 10:01:00] ERRO: falhou',
    '[24/11/2026, 10:02:00] AVISO: cuidado',
    '[24/11/2026, 10:03:00] MODERAÇÃO: usuário x',
    'continuação da moderação',
    '[24/11/2026, 10:04:00] SUCESSO: online'
].join('\n');

const { entries, stats } = Exporter.parse(sample);
assert.strictEqual(stats.total, 5);
assert.strictEqual(stats.byLevel.ERRO, 1);
assert.strictEqual(entries.find(e => e.level === 'MODERAÇÃO').text.includes('continuação'), true);
console.log('ok parse');
const md = Exporter.buildMarkdown('bot-24-11-2026.log', entries, stats, 'agora');
assert.ok(md.includes('# Log do HostVille'));
assert.ok(md.includes('| ERRO | 1 |'));
assert.ok(md.includes('## Erros') === false); // seções usam o nome do nível
assert.ok(md.includes('## ERRO'));
assert.ok(md.includes('continuação da moderação'));
console.log('ok markdown');
console.log('log-export: 2 testes passaram');

const del = Exporter.buildDeletedMarkdown([
    { ts: 1, authorTag: 'a', deleter: 'staff', channelName: 'geral', content: 'oi' },
    { ts: 2, authorTag: 'b', deleter: 'HostVille • BOT (moderação)', channelName: 'geral', content: 'x' }
], 'agora');
assert.ok(del.includes('# Mensagens deletadas'));
assert.ok(del.includes('| Moderação | 1 |'));
assert.ok(del.includes('| Manual | 1 |'));
assert.ok(del.includes('HostVille • BOT (moderação)'));
console.log('ok deletadas');
console.log('log-export: 3 testes passaram');
