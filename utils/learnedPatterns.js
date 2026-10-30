/**
 * Padrões aprendidos: qual documento da KB responde qual tipo de pergunta.
 *
 * O bot anota, toda vez que uma resposta é aprovada pelo ResponseValidator,
 * quais documentos responderam bem. Na próxima pergunta parecida, esses
 * documentos ganham peso no ranking — a busca acerta o doc certo de primeira.
 *
 * O que NÃO existe aqui, de propósito: cache de resposta. Nada é replayed.
 * A IA continua escrevendo a resposta. O que se guarda é só "onde olhar",
 * porque replay de texto fixo é o que transforma a IA num bot pré-programado.
 *
 * Formato (data/learnedPatterns.json):
 *   { "<tokens ordenados>": { "docIds": [...], "hits": 3, "validadoEm": 1790… } }
 */
const fs = require('fs');
const path = require('path');

const FILE = process.env.LEARNED_PATTERNS_FILE
    || path.join(__dirname, '..', 'data', 'learnedPatterns.json');

const TTL_CACHE_MS = 60 * 1000;   // relê o arquivo no máximo 1x por minuto
const MAX_KEYS = 500;             // teto de padrões guardados
const DIAS = parseInt(process.env.AUTO_KB_DAYS || '60', 10);

let cache = null;
let cacheAt = 0;
let cacheMtime = null;
let gravou = false;

/** Só tokens com 4+ letras: é o mesmo corte do retrieval. */
function tokensDe(words) {
    return [...new Set(
        (Array.isArray(words) ? words : String(words || '').split(/\s+/))
            .map(w => String(w).toLowerCase().replace(/[^a-z0-9]/g, ''))
            .filter(w => w.length >= 4)
    )].sort();
}

function chave(tokens) {
    return tokens.join(' ');
}

/**
 * Lê o arquivo respeitando TTL E mtime.
 *
 * Só o TTL não bastava: se o arquivo fosse apagado, editado ou corrompido
 * por fora, o bot continuava usando a memória velha e podia "ressuscitar"
 * um padrão que já não existia. O mtime pega esses casos.
 */
function load() {
    const agora = Date.now();
    if (!gravou && cache && agora - cacheAt < TTL_CACHE_MS) {
        if (assinaturaAtual() === cacheMtime) return cache;
    }
    let mtime = null;
    try {
        const st = fs.statSync(FILE);
        mtime = `${st.mtimeMs}:${st.size}`;
    } catch (e) {
        mtime = null; // arquivo não existe (ainda ou deletado)
    }
    try {
        cache = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
    } catch (e) {
        cache = {};
    }
    cacheAt = agora;
    cacheMtime = mtime;
    gravou = false;
    return cache;
}

/**
 * mtime + tamanho em vez de mtime sozinho.
 *
 * Medido neste filesystem: escritas no mesmo tick recebem mtimeMs igual, e
 * o cache de 60s devolvia memoria velha depois do arquivo ser corrompido
 * por fora — o bot "ressuscitava" padrao que ja nao existia. Ver o mesmo
 * comentario em managers/ChatMemory.js.
 */
function assinaturaAtual() {
    try {
        const st = fs.statSync(FILE);
        return `${st.mtimeMs}:${st.size}`;
    } catch (e) { return null; }
}

function save(dados) {
    try {
        const tmp = FILE + '.tmp-' + process.pid;
        fs.writeFileSync(tmp, JSON.stringify(dados, null, 2) + '\n');
        fs.renameSync(tmp, FILE);
        cacheMtime = assinaturaAtual();
    } catch (e) {
        // memória de aprendizado é acessória: nunca derruba o bot por falhar
        console.error('❌ Não consegui salvar learnedPatterns.json:', e.message);
    }
}

/** Remove padrões velhos e estoura o teto. */
function prune(dados) {
    const agora = Date.now();
    const limite = agora - DIAS * 24 * 60 * 60 * 1000;
    let removidos = 0;

    for (const [k, v] of Object.entries(dados)) {
        if (!v || !v.validadoEm || v.validadoEm < limite) { delete dados[k]; removidos++; }
    }

    const chaves = Object.keys(dados);
    if (chaves.length > MAX_KEYS) {
        // mantém os mais usados
        chaves
            .sort((a, b) => (dados[b].hits || 0) - (dados[a].hits || 0))
            .slice(MAX_KEYS)
            .forEach(k => { delete dados[k]; removidos++; });
    }
    return removidos;
}

/**
 * Registra um padrão bem-sucedido.
 * @param {string[]} words  tokens normalizados da pergunta
 * @param {string[]} docIds documentos que responderam
 */
function record(words, docIds) {
    const tokens = tokensDe(words);
    const docs = [...new Set((docIds || []).filter(Boolean))];
    // sem tokens suficientes ou sem documento não há padrão a aprender
    if (tokens.length < 2 || docs.length === 0) return false;

    const dados = load();
    const k = chave(tokens);
    const atual = dados[k];

    if (atual) {
        atual.hits = (atual.hits || 0) + 1;
        atual.validadoEm = Date.now();
        // junta os docs: com o tempo a pergunta pode ser respondida por mais de um
        atual.docIds = [...new Set([...(atual.docIds || []), ...docs])].slice(0, 6);
    } else {
        dados[k] = { docIds: docs, hits: 1, validadoEm: Date.now() };
    }

    prune(dados);
    cache = dados;
    cacheAt = Date.now();
    gravou = true;
    save(dados);
    cacheMtime = assinaturaAtual();
    return true;
}

/**
 * Peso extra por documento para ESTA consulta.
 * Satura em 5 acertos: um padrão muito usado não pode virar monopólio do ranking.
 */
function boostsFor(words) {
    const consulta = new Set(tokensDe(words));
    if (consulta.size < 2) return new Map();

    const dados = load();
    const out = new Map();

    for (const [k, padrao] of Object.entries(dados)) {
        if (!padrao || !Array.isArray(padrao.docIds) || !padrao.docIds.length) continue;

        const tokens = k.split(' ').filter(Boolean);
        if (!tokens.length) continue;

        let acertos = 0;
        for (const t of tokens) if (consulta.has(t)) acertos++;
        const cobertura = acertos / tokens.length;

        // precisa ser realmente a mesma pergunta, não só uma palavra em comum
        if (cobertura < 0.6 || acertos < 2) continue;

        // peso por acerto, saturando em 5 e com teto: um padrão muito usado
        // não pode virar monopólio do ranking
        const peso = Math.min((padrao.hits || 1) * 0.8 * cobertura, 4);
        for (const id of padrao.docIds) {
            out.set(id, Math.max(out.get(id) || 0, peso));
        }
    }
    return out;
}

function stats() {
    const dados = load();
    const chaves = Object.keys(dados);
    return {
        padroes: chaves.length,
        acertosTotal: chaves.reduce((s, k) => s + (dados[k].hits || 0), 0),
        maisUsados: chaves
            .sort((a, b) => (dados[b].hits || 0) - (dados[a].hits || 0))
            .slice(0, 5)
            .map(k => ({ pergunta: k, hits: dados[k].hits, docIds: dados[k].docIds })),
    };
}

module.exports = { record, boostsFor, tokensDe, chave, prune, stats, load, FILE, MAX_KEYS, DIAS };
