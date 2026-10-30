/**
 * Escrita na Knowledge Base: cria documentos em ai/knowledge/auto-kb/ e
 * registra a entrada no index.json.
 *
 * O index.json é curado, mas o usuário pediu que os aprendizados aprovados
 * apareçam nele (para dar pra revisar em PR/diff). Por isso as duas escritas
 * são atômicas e o arquivo .md é gravado ANTES do índice: se a escrita do
 * índice falhar, sobra um .md sem entrada (inofensivo, o loader ignora);
 * se fosse o contrário, o índice apontaria para um arquivo inexistente.
 *
 * Regra da KB (ai/knowledge/README.md): documentos guardam FATOS, a IA
 * escreve. Nada aqui grava "frase pronta de resposta".
 */
const fs = require('fs');
const path = require('path');

const KB_DIR = path.join(__dirname, '..', 'ai', 'knowledge');
// Overrides por env: sem eles o writer grava sempre no index.json real, e um
// teste (ou uma instalação paralela) acaba污染ando a KB de produção.
const INDEX_FILE = process.env.AUTO_KB_INDEX || path.join(KB_DIR, 'index.json');
const AUTO_DIR = process.env.AUTO_KB_DIR || path.join(KB_DIR, 'auto-kb');

/** Categoria dos documentos aprendidos. NÃO entra em SISTEMA_ARENAS de propósito:
 *  um doc aprendido nunca deve ser eliminado pelo filtro de arena, senão a
 *  pergunta que o originou (que pode ser de outra arena) não o encontra. */
const CATEGORY = 'auto-kb';

/** Prioridade baixa: score *= 1 + (priority-5)/50, então priority 2 = 0.94x.
 *  O doc curado vence o aprendido no empate — o bot não pode passar a
 *  confiar mais no que ele mesmo aprendeu do que no texto auditado. */
const PRIORITY = 2;

function atomicWrite(file, conteudo) {
    const tmp = file + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, conteudo);
    fs.renameSync(tmp, file);
}

function lerIndice() {
    try {
        const idx = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
        if (!Array.isArray(idx.documents)) idx.documents = [];
        return idx;
    } catch (e) {
        return { documents: [] };
    }
}

/** Slug seguro para nome de arquivo e id. */
function slugify(texto, max = 48) {
    return String(texto || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, max) || 'aprendizado';
}

/** Gera as keywords de retrieval a partir do próprio texto do documento. */
function derivarKeywords(markdown, extras = []) {
    const palavras = new Set();
    for (const m of String(markdown).matchAll(/\b([a-zçãõáéíóúâêô]{4,24})\b/gi)) {
        const w = m[1].toLowerCase();
        palavras.add(w);
    }
    for (const e of extras) if (e) palavras.add(String(e).toLowerCase());
    // ordena pelo peso: o que aparece mais vezes no texto tem mais chance de
    // ser a palavra que o usuário vai usar
    const contagem = new Map();
    for (const m of String(markdown).toLowerCase().matchAll(/\b([a-zçãõáéíóúâêô]{4,24})\b/g)) {
        const w = m[1];
        contagem.set(w, (contagem.get(w) || 0) + 1);
    }
    return [...palavras]
        .sort((a, b) => (contagem.get(b) || 0) - (contagem.get(a) || 0))
        .slice(0, 12);
}

/**
 * Cria (ou atualiza) um documento aprendido.
 *
 * @param {Object} d
 * @param {string} d.titulo     título do documento
 * @param {string} d.fatos      texto dos fatos (sem o cabeçalho markdown)
 * @param {string[]} [d.keywords]
 * @param {string} [d.origem]   de onde veio (ex.: "Ticket #0007")
 * @param {string} [d.aprovadoPor] id do usuário que aprovou
 * @returns {{id, path, jaExistia:boolean}}
 */
function addDoc({ titulo, fatos, keywords = [], origem = '', aprovadoPor = '' }) {
    if (!titulo || !fatos) throw new Error('addDoc precisa de titulo e fatos');

    const id = 'auto-kb-' + slugify(titulo);
    // caminho RELATIVO que vai no index.json (é assim que o loader lê),
    // e caminho ABSOLUTO de escrita (que o env pode redirecionar)
    const relPath = path.join('ai', 'knowledge', 'auto-kb', id + '.md');
    const absPath = path.join(AUTO_DIR, id + '.md');

    const jaExistia = fs.existsSync(absPath);
    const hoje = new Date().toISOString().slice(0, 10);

    const markdown = [
        `# ${titulo}`,
        '',
        '## Fatos',
        String(fatos).trim(),
        '',
        '## Fonte',
        origem ? `- ${origem} — aprovado por ${aprovadoPor ? `<@${aprovadoPor}>` : 'staff'}` : '- Aprendizado automático aprovado em canal de revisão',
        `- Verificado em ${hoje}`,
        '',
        '<!-- confidence: low -->',
        '',
    ].join('\n');

    if (!fs.existsSync(AUTO_DIR)) fs.mkdirSync(AUTO_DIR, { recursive: true });
    atomicWrite(absPath, markdown);

    const index = lerIndice();
    const entry = {
        id,
        title: `# ${titulo}`,
        path: relPath.split(path.sep).join('/'),
        category: CATEGORY,
        priority: PRIORITY,
        keywords: derivarKeywords(markdown, keywords),
        commands: (String(markdown).match(/['`;$][a-z_]{3,24}/gi) || []).map(c => c.slice(1).toLowerCase()).slice(0, 8),
        source: origem || 'aprendizado automático',
        confidence: 'low',
        lastVerified: hoje,
    };

    const i = index.documents.findIndex(d => d.id === id);
    if (i >= 0) index.documents[i] = entry;
    else index.documents.push(entry);

    atomicWrite(INDEX_FILE, JSON.stringify(index, null, 2) + '\n');

    // o processo tem o índice em cache: sem invalidar, o doc novo não seria
    // retrievable até o próximo restart
    try {
        require('./knowledge-loader').invalidateCache();
    } catch (e) {}

    return { id, path: entry.path, jaExistia };
}

/** Existe já um documento aprendido com essa pergunta? */
function findByTitle(titulo) {
    const id = 'auto-kb-' + slugify(titulo);
    const idx = lerIndice();
    const doc = idx.documents.find(d => d.id === id);
    if (!doc) return null;
    const esperado = path.join(AUTO_DIR, path.basename(doc.path || ''));
    return { ...doc, existeArquivo: fs.existsSync(esperado) };
}

module.exports = { addDoc, findByTitle, slugify, derivarKeywords, CATEGORY, PRIORITY, AUTO_DIR, INDEX_FILE };
