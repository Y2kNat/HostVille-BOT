// Pool de API keys: round-robin + cooldown por key.
function parseKeys(raw) {
    const items = Array.isArray(raw) ? raw : [raw];
    const out = [];
    for (const item of items) {
        out.push(...String(item || '').split(','));
    }
    return [...new Set(out.map(k => String(k || '').trim()).filter(Boolean))];
}

const COOLDOWN = { auth: 600000, quota: 300000, rate: 300000, transient: 10000 };

class KeyPool {
    constructor(keys) {
        this.keys = parseKeys(keys);
        this.index = 0;
        this.cooldown = new Map();
    }
    get size() { return this.keys.length; }
    next() {
        if (!this.keys.length) return null;
        const now = Date.now();
        for (let n = 0; n < this.keys.length; n++) {
            const key = this.keys[this.index];
            this.index = (this.index + 1) % this.keys.length;
            if ((this.cooldown.get(key) || 0) <= now) return key;
        }
        return null;
    }
    ok(key) { this.cooldown.delete(key); }
    fail(key, erro) {
        const st = erro && erro.status;
        let ms = 0;
        if (st === 401 || st === 403) ms = COOLDOWN.auth;
        else if (st === 402) ms = COOLDOWN.quota;
        else if (st === 429) ms = COOLDOWN.rate;
        // Erros transitorios (408/5xx/rede): nao colocar a key em cooldown,
        // para que o retry/backoff possa reutiliza-la (ou a proxima da roda).
        if (ms) this.cooldown.set(key, Date.now() + ms);
        return ms;
    }
    mask(key) { return key ? '...' + key.slice(-4) : '?'; }
}

const pools = new Map();
function getPool(keys) {
    const list = parseKeys(keys);
    if (!list.length) return new KeyPool([]);
    const id = list.join('\n');
    if (!pools.has(id)) pools.set(id, new KeyPool(list));
    return pools.get(id);
}

module.exports = { parseKeys, getPool, KeyPool };
