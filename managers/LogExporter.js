const fs = require('fs');
const path = require('path');
const deletedStore = require('../utils/deletedStore');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const MAX_BYTES = 7.5 * 1024 * 1024;
const ANSI_RE = /\u001b\[[0-9;]*m/g;
const LINE_RE = /^\[([^\]]+)\]\s+([A-ZÇÃÕÁÉÍÓÚÂÊÔ]+):\s?(.*)$/;
const LEVELS = ['ERRO', 'AVISO', 'MODERAÇÃO', 'SUCESSO', 'INFO', 'ENTRADA', 'SAÍDA'];

function latestFile() {
    if (!fs.existsSync(LOG_DIR)) return null;
    const files = fs.readdirSync(LOG_DIR)
        .filter(f => /^bot-.*\.log$/.test(f))
        .map(f => ({ file: f, mtime: fs.statSync(path.join(LOG_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    return files.length ? path.join(LOG_DIR, files[0].file) : null;
}
function parse(content) {
    const entries = [];
    const stats = { total: 0, byLevel: {} };
    for (const raw of String(content).split(/\r?\n/)) {
        const line = raw.replace(ANSI_RE, '');
        const m = line.match(LINE_RE);
        if (m) {
            const time = (m[1].split(', ')[1] || m[1]).trim();
            const level = m[2].toUpperCase();
            entries.push({ time, level, text: m[3] || '' });
            stats.total++;
            stats.byLevel[level] = (stats.byLevel[level] || 0) + 1;
        } else if (entries.length && line.trim()) {
            entries[entries.length - 1].text += '\n' + line;
        }
    }
    return { entries, stats };
}

function buildMarkdown(file, entries, stats, generatedAt) {
    const out = [];
    out.push('# Log do HostVille • BOT');
    out.push('');
    out.push(`**Arquivo:** \`${path.basename(file)}\``);
    out.push(`**Gerado em:** ${generatedAt}`);
    out.push(`**Linhas:** ${stats.total}`);
    out.push('');
    out.push('## Resumo');
    out.push('');
    out.push('| Nível | Quantidade |');
    out.push('|---|---:|');
    for (const level of LEVELS) out.push(`| ${level} | ${stats.byLevel[level] || 0} |`);
    out.push('');
    for (const level of LEVELS) {
        out.push(`## ${level}`);
        out.push('');
        const lista = entries.filter(e => e.level === level);
        if (!lista.length) { out.push('Nenhum registro.'); out.push(''); continue; }
        for (const e of lista) {
            const text = String(e.text || '').replace(/\r?\n/g, '<br>').trim();
            out.push(`- **[${e.time}]** ${text}`);
        }
        out.push('');
    }
    let md = out.join('\n');
    if (Buffer.byteLength(md, 'utf8') > MAX_BYTES) {
        md = md.slice(0, MAX_BYTES) + '\n\n> ⚠️ Export truncado por tamanho.';
    }
    return md;
}

function exportLatest() {
    const file = latestFile();
    if (!file) return null;
    const content = fs.readFileSync(file, 'utf8');
    const { entries, stats } = parse(content);
    const generatedAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const md = buildMarkdown(file, entries, stats, generatedAt);
    const day = path.basename(file).replace(/^bot-|\.log$/g, '');
    return {
        buffer: Buffer.from(md, 'utf8'),
        filename: `log-hostville-${day}.md`,
        stats,
        file
    };
}

function buildDeletedMarkdown(entries, generatedAt) {
    const out = [];
    const fonte = e => (e.source === 'moderacao' || String(e.deleter || '').includes('moderação')) ? 'Moderação' : 'Manual';
    const detalhe = e => fonte(e) === 'Moderação'
        ? ['HostVille • BOT (moderação)', [e.palavra, e.severidade].filter(Boolean).join(' / ')].filter(Boolean).join(' — ')
        : '-';
    out.push('# Mensagens deletadas — HostVille • BOT');
    out.push('');
    out.push(`**Gerado em:** ${generatedAt}`);
    out.push(`**Total:** ${entries.length}`);
    out.push('');
    out.push('## Classificação');
    out.push('');
    out.push('| Tipo | Quantidade |');
    out.push('|---|---:|');
    const porTipo = { 'Moderação': 0, 'Manual': 0 };
    for (const e of entries) porTipo[fonte(e)]++;
    for (const [k, v] of Object.entries(porTipo)) out.push(`| ${k} | ${v} |`);
    out.push('');
    out.push('## Registros');
    out.push('');
    out.push('| Data | Autor | Classificação | Canal | Conteúdo | Detalhe |');
    out.push('|---|---|---|---|---|---|');
    const esc = s => String(s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 200);
    for (const e of entries.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))) {
        const d = new Date(e.ts || Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        out.push(`| ${esc(d)} | ${esc(e.authorTag)} | ${fonte(e)} | #${esc(e.channelName)} | ${esc(e.content)} | ${esc(detalhe(e))} |`);
    }
    let md = out.join('\n');
    if (Buffer.byteLength(md, 'utf8') > MAX_BYTES) md = md.slice(0, MAX_BYTES) + '\n\n> ⚠️ Export truncado por tamanho.';
    return md;
}

function exportDeleted(opts = {}) {
    const days = Math.min(7, Math.max(1, parseInt(opts.days, 10) || 3));
    const userId = opts.userId ? String(opts.userId) : null;
    const limite = Date.now() - days * 24 * 60 * 60 * 1000;
    const entries = deletedStore.all().filter(e =>
        (e.ts || 0) >= limite &&
        e.content !== '[sem texto]' &&
        !/^\[embed:/.test(String(e.content || '')) &&
        (!userId || String(e.authorId) === userId)
    );
    const generatedAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const md = buildDeletedMarkdown(entries, generatedAt);
    const day = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).replace(/\//g, '-');
    return { buffer: Buffer.from(md, 'utf8'), filename: `deletadas-${days}d-${day}.md`, total: entries.length, days, userId };
}

module.exports = { exportLatest, exportDeleted, parse, buildMarkdown, buildDeletedMarkdown, latestFile };
