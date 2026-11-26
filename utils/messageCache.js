const MAX = 2000;
const TTL = 24 * 60 * 60 * 1000;
const cache = new Map();

function resumo(m) {
    return {
        id: m.id,
        guildId: m.guild?.id || null,
        channelId: m.channel?.id || null,
        authorId: m.author?.id || null,
        authorTag: m.author?.tag || 'Desconhecido',
        content: String(m.content || ''),
        attachments: (m.attachments || []).map(a => ({ name: a.name, url: a.url })),
        embeds: (m.embeds || []).map(e => ({ title: e.title, description: e.description })),
        ts: m.createdTimestamp || Date.now()
    };
}

function prune() {
    const now = Date.now();
    for (const [id, v] of cache) {
        if (now - v.ts > TTL) cache.delete(id);
    }
    if (cache.size > MAX) {
        const ids = [...cache.keys()].slice(0, cache.size - MAX);
        for (const id of ids) cache.delete(id);
    }
}

function add(m) {
    if (!m || !m.id) return;
    cache.set(m.id, resumo(m));
    if (cache.size > MAX + 200) prune();
}

function update(m) {
    if (!m || !m.id || !cache.has(m.id)) return;
    const old = cache.get(m.id);
    cache.set(m.id, Object.assign({}, old, resumo(m)));
}

function get(id) { return cache.get(String(id)) || null; }
function size() { return cache.size; }

module.exports = { add, update, get, size };