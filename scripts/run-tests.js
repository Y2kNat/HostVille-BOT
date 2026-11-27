const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'tests');
const EXCLUIR = new Set(['kilo.live.test.js', 'kilo-fallback.test.js', 'fallback.test.js']);
const arquivos = fs.readdirSync(dir)
    .filter(f => f.endsWith('.test.js') && !EXCLUIR.has(f))
    .sort();

let falhas = 0;
for (const arq of arquivos) {
    try {
        execFileSync('node', [path.join(dir, arq)], { stdio: 'inherit' });
        console.log(`✅ ${arq}`);
    } catch {
        falhas++;
        console.error(`❌ ${arq}`);
    }
}
console.log(`\n${arquivos.length - falhas}/${arquivos.length} passaram`);
process.exit(falhas ? 1 : 0);