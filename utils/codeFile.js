const fs = require('fs');
const path = require('path');

const NOME_MARCADO = /\[(?:\s*)(?:ARQUIVO|ARQUIVOS|FILE|FILES|ARQUIVE|FICHEIRO)(?:\s*):\s*([^\]\n]+?)\s*\]/i;
const ROTULOS = /^\s*(FILE|FILES|ARQUIVO|ARQUIVOS|ACTION|ACAO|AÇÃO|CODE|CODIGO|CÓDIGO|TEXT|TEXTO|OUTPUT|SADA|SÍDA)\s*:\s*/gim;
const LINGUAGENS = {
    '.js': 'javascript', '.mjs': 'javascript', '.jsx': 'jsx', '.ts': 'typescript', '.tsx': 'tsx',
    '.html': 'html', '.htm': 'html', '.css': 'css', '.scss': 'scss', '.json': 'json', '.md': 'markdown',
    '.py': 'python', '.sql': 'sql', '.sh': 'bash', '.yml': 'yaml', '.yaml': 'yaml', '.java': 'java',
    '.go': 'go', '.rb': 'ruby', '.php': 'php'
};

function extrairNomeMarcado(bruto) {
    const m = String(bruto || '').match(NOME_MARCADO);
    if (m) return m[1].trim();
    const alt = String(bruto || '').match(/\[[^\]\n]{0,20}?:\s*([\w./\\-]+\.\w{1,5})\s*\]/i);
    return alt ? alt[1].trim() : '';
}

function extrairConteudo(bruto, nome = '') {
    const texto = String(bruto || '');
    const blocos = [...texto.matchAll(/```[a-zA-Z0-9_+-]*\n?([\s\S]*?)```/g)].map(m => m[1]);
    if (blocos.length) return blocos.reduce((a, b) => (b.length > a.length ? b : a)).replace(/\s+$/, '').trim();
    const aberta = texto.match(/```[a-zA-Z0-9_+-]*\n([\s\S]*)$/);
    if (aberta) return aberta[1].replace(/\s+$/, '').trim();
    let t = texto;
    t = t.replace(/\[ARQUIVO:\s*.+?\]/gi, '');
    t = t.replace(/\[ACAO:\s*.+?\]/gi, '');
    t = t.replace(ROTULOS, '');
    t = t.replace(/^(Claro|Certo|Ok|Entendido|Perfeito)[^\n:]*:\s*/i, '').trim();
    const rotulo = String(nome || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (rotulo) {
        t = t.replace(new RegExp(`^\\s*${rotulo}\\s*[:=]\\s*`, 'i'), '');
        const base = rotulo.split('/').pop();
        t = t.replace(new RegExp(`^\\s*${base}\\s*$`, 'im'), '');
    }
    return t.replace(/^\n+/, '').replace(/\s+$/, '').trim();
}
function nomeDeArquivo(nome) {
    let n = String(nome == null ? '' : nome).replace(/\\/g, '/').trim();
    const url = n.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/]*)(\/.*)?$/);
    if (url) n = url[2] || '';
    n = n.replace(/^[a-zA-Z]:/, '').replace(/^\/+/, '');
    const partes = n.split('/').filter(p => p && p !== '.' && p !== '..');
    if (!partes.length || !partes.some(p => /\.\w{1,5}$/.test(p))) return 'arquivo.txt';
    return partes.join('/');
}

function sanitizar(nome) {
    const limpo = String(nome == null ? '' : nome).replace(/\\/g, '/').replace(/^[a-zA-Z]:/, '').split('/').filter(p => p && p !== '.' && p !== '..').join('/');
    return limpo || 'arquivo';
}

function garantirPasta(caminhoCompleto) {
    const pasta = path.dirname(caminhoCompleto);
    if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
    return caminhoCompleto;
}

function linguagemDe(nome) { return LINGUAGENS[path.extname(String(nome || '')).toLowerCase()] || ''; }

module.exports = { NOME_MARCADO, extrairNomeMarcado, extrairConteudo, nomeDeArquivo, sanitizar, garantirPasta, linguagemDe };
