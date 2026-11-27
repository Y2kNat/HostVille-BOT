const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'deleted-messages.json');
const MAX = 3000;
const DIAS_MAX = 7;

let cache = null;
let cacheMtime = 0;
let cacheSize = -1;
let timer = null;

function ler() {
    let st = null;
    try { st = fs.statSync(FILE); } catch (e) {}
    if (cache && st && st.mtimeMs === cacheMtime && st.size === cacheSize) return cache;
    if (st) {
        try {
            const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
            cache = Array.isArray(d) ? d : [];
        } catch (e) {
            try {
                const d = JSON.parse(fs.readFileSync(FILE + '.bak', 'utf8'));
                cache = Array.isArray(d) ? d : [];
            } catch (e2) { cache = []; }
        }
        cacheMtime = st.mtimeMs;
        cacheSize = st.size;
    }
    if (!cache) cache = [];
    return cache;
}
function salvar() {
    try {
        if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
        const tmp = FILE + '.tmp-' + process.pid;
        fs.writeFileSync(tmp, JSON.stringify(cache.slice(-MAX)));
        try { fs.copyFileSync(FILE, FILE + '.bak'); } catch (e) {}
        fs.renameSync(tmp, FILE);
        try { const st = fs.statSync(FILE); cacheMtime = st.mtimeMs; cacheSize = st.size; } catch (e) {}
        return true;
    } catch (e) {
        console.error('[deletedStore] falha ao gravar:', e.message);
        return false;
    }
}

function agendar() {
    if (timer) return;
    timer = setTimeout(() => {
        timer = null;
        salvar();
    }, 1500);
    if (timer.unref) timer.unref();
}

function add(entry) {
    const limite = Date.now() - DIAS_MAX * 24 * 60 * 60 * 1000;
    const dados = ler().filter(e => (e.ts || 0) >= limite);
    dados.push(Object.assign({ ts: Date.now() }, entry));
    if (dados.length > MAX) dados.splice(0, dados.length - MAX);
    cache = dados;
    agendar();
    return dados.length;
}

function all() { return ler().slice(); }
function clear() { cache = []; salvar(); }

const limpezaDiaria = setInterval(() => {
    const limite = Date.now() - DIAS_MAX * 24 * 60 * 60 * 1000;
    const dados = ler().filter(e => (e.ts || 0) >= limite);
    if (dados.length !== cache.length) { cache = dados; salvar(); }
}, 24 * 60 * 60 * 1000);
if (limpezaDiaria.unref) limpezaDiaria.unref();

module.exports = { add, all, clear, FILE, DIAS_MAX };
