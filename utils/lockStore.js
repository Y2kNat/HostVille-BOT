const fs = require('fs');
const path = require('path');

const ARQUIVO = path.join(__dirname, '..', 'data', 'locks.json');
let cache = null;
let cacheMtime = 0;

function ler() {
    try {
        const st = fs.statSync(ARQUIVO);
        if (cache && st.mtimeMs === cacheMtime) return cache;
        cache = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
        cacheMtime = st.mtimeMs;
        return cache;
    } catch { return cache || {}; }
}
function gravar(dados) {
    fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
    const tmp = ARQUIVO + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(dados, null, 2));
    fs.renameSync(tmp, ARQUIVO);
    cache = dados;
    cacheMtime = fs.statSync(ARQUIVO).mtimeMs;
}
module.exports = {
    get: id => ler()[String(id)] || null,
    set(id, v) { const d = ler(); d[String(id)] = v; gravar(d); },
    remove(id) { const d = ler(); delete d[String(id)]; gravar(d); },
    todos: () => Object.entries(ler()).map(([canalId, v]) => ({ canalId, ...v })),
    _limpar() { cache = null; cacheMtime = 0; }
};