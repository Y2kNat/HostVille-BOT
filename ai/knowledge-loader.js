const fs = require('fs');
const path = require('path');

const KNOWLEDGE_DIR = path.join(__dirname, '..', 'ai', 'knowledge');
const INDEX_FILE = path.join(KNOWLEDGE_DIR, 'index.json');

// Teto de contexto injetado. Com num_ctx=8192 (configurado em .env) cabem as
// regras do sistema (~2.1k tokens) + 6.000 chars de contexto (~1.7k tokens)
// + histórico e pergunta, sem truncar a base.
const MAX_CONTEXT_CHARS = 6000;

let cache = null;

function loadIndex() {
    if (cache) return cache;
    try {
        cache = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
        return cache;
    } catch (e) {
        return { documents: [] };
    }
}

// Abreviações e gírias comuns no Discord brasileiro.
// A pergunta do usuário chega assim ("vc deletu meu carro?"); sem isso a
// busca não acha o documento e o modelo não entende.
const SLANG = [
    [/\bvc\b/g, 'voce'], [/\bvcs\b/g, 'voces'], [/\buce\b/g, 'voce'], [/\bce\b/g, 'voce'],
    [/\btbm\b/g, 'tambem'], [/\btmbm\b/g, 'tambem'], [/\bmsm\b/g, 'mesmo'], [/\bmsma\b/g, 'mesma'],
    [/\bpq\b/g, 'porque'], [/\bporq\b/g, 'porque'], [/\bqnd\b/g, 'quando'], [/\bqndo\b/g, 'quando'],
    [/\bcmg\b/g, 'comigo'], [/\bcg\b/g, 'comigo'], [/\bvlw\b/g, 'valeu'], [/\bblz\b/g, 'beleza'],
    [/\bhj\b/g, 'hoje'], [/\bontem\b/g, 'ontem'], [/\bagr\b/g, 'agora'], [/\bagr\b/g, 'agora'],
    [/\bqlq\b/g, 'qualquer'], [/\bqql\b/g, 'qualquer'], [/\bfds\b/g, 'fim de semana'],
    [/\btd\b/g, 'tudo'], [/\btds\b/g, 'todos'], [/\btud\b/g, 'tudo'], [/\btdb\b/g, 'tudo bem'],
    [/\bta\b/g, 'esta'], [/\bto\b/g, 'estou'], [/\btô\b/g, 'estou'], [/\btao\b/g, 'estão'],
    [/\bta\b/g, 'esta'], [/\bpro\b/g, 'para'], [/\bpra\b/g, 'para'], [/\bproblema\b/g, 'problema'],
    [/\bdeleto\b/g, 'deletar'], [/\bdeleta\b/g, 'deletar'], [/\bdeletu\b/g, 'deletar'],
    [/\bdele\b/g, 'dele'], [/\bkkk+\b/g, 'rindo'], [/\bhehe\b/g, 'rindo'], [/\bkkkkk\b/g, 'rindo'],
    [/\bblz\b/g, 'beleza'], [/\bslc\b/g, 'salve'], [/\bfzr\b/g, 'fazer'], [/\bfazend\b/g, 'fazendo'],
    [/\bconsegui\b/g, 'consegui'], [/\bnao\b/g, 'nao'], [/\bqdo\b/g, 'quando'], [/\bqdo\b/g, 'quando'],
    [/\bqual\b/g, 'qual'], [/\bcmo\b/g, 'como'], [/\bcmg\b/g, 'comigo'], [/\bnd\b/g, 'onde'],
    [/\bdnv\b/g, 'de novo'], [/\bagrd\b/g, 'agora'], [/\bcrack\b/g, 'crack'],
    [/\brapid[oa]\b/g, 'rapido'], [/\bfacil\b/g, 'facil'], [/\bdificil\b/g, 'dificil'],
    [/\bprecisa\b/g, 'precisa'], [/\bpreciso\b/g, 'preciso'], [/\bposso\b/g, 'posso'],
];

function deslugar(texto) {
    let t = String(texto || '');
    for (const [re, para] of SLANG) {
        try { t = t.replace(re, para); } catch (e) {}
    }
    return t.replace(/\bn\s+(?=[a-zà-ú])/g, 'nao ');
}

function normalize(text) {
    return deslugar(text)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\b(veiculo|veiculos|carro|carros|moto|motos)\b/g, 'veiculo')
        .replace(/\b(casa|casas|imovel|imoveis|propriedade|propriedades)\b/g, 'propriedade')
        .replace(/\b(bairro|bairros)\b/g, 'bairro')
        .replace(/\b(placa|placas)\b/g, 'placa')
        .replace(/\b(sessao|sessoes|ginasio|academia)\b/g, 'sessao')
        .replace(/\b(apag|remov|delet|delec|exclu|retir|tir)\w*/g, 'deletar')
        .replace(/\b(registrar|registro|cadastrar|cadastro|criar|criei|criou|criacao)\b/g, 'registro')
        .replace(/\b(bloquear|bloqueio|bloqueia|bloqueado)\b/g, 'bloquear')
        // Sinônimos de moderação: sem isso "como bane alguem" não encontra
        // nenhum documento, porque a KB escreve "banir" e a pessoa escreveu "bane".
        .replace(/\b(bane|banir|banimento|banido|bans|bannato)\b/g, 'banir')
        .replace(/\b(expulsar|expulsa|expulso|expulsao|kick|kickar)\b/g, 'expulsar')
        .replace(/\b(silenciar|silencia|silenciado|silencio|mute|mutar|timeout)\b/g, 'silenciar')
        .replace(/\b(aviso|avisar|avisos|advertencia|advertir|warn)\b/g, 'aviso')
        .replace(/\b(denuncia|denunciar|denunciado|denuncias|acusar|acusacao)\b/g, 'denuncia')
        .replace(/\b(duvida|duvidas|pergunto|pergunta)\b/g, 'duvida')
        .replace(/\b(spam|spamagem|flood|floodar)\b/g, 'spam')
        .replace(/\b(apagar|apaga|limpar|limpa|clear|purge)\b/g, 'apagar')
        .replace(/\b(convite|convidar|invite)\b/g, 'convite')
        .replace(/\b(ticket|tickets)\b/g, 'ticket')
        .replace(/\b(mostrar|mostro|ve|vejo|ver|listar|lista|consultar|consulto|buscar|busco|procurar)\b/g, 'consultar');
}

// Palavras-fortes que identificam o SISTEMA da pergunta. Como há docs equivalentes
// nos 3 sistemas (ex.: "registro" existe no Atlas imóveis e no Vehix veículos), uma
// pergunta de veículo pode puxar o doc de imóveis e o modelo pequeno MISTURA as
// regras. Detectando o sistema, excluímos docs de sistemas diferentes.
// Categorias que possuem REGRAS PRÓPRIAS e podem se confundir entre si.
// Só elas são filtradas por arena: misturar tier de veículo com tier de imóvel
// produz resposta errada, mas um documento de ticket/moderação nunca conflita
// com um documento de sistema — por isso geral/tickets/moderacao ficam sempre
// como candidatos.
const SISTEMA_ARENAS = {
    vehix: ['veiculo', 'placa', 'carro', 'carros', 'moto', 'motos', 'booster', 'workcar'],
    atlas: ['propriedade', 'bairro', 'terreno', 'moradia', 'imovel', 'imoveis', 'casa', 'casas', 'gangue'],
    ascend: ['sessao', 'link', 'treino', 'treinar', 'treino']
};
const OUTRAS_CATEGORIAS = ['geral', 'tickets', 'moderacao'];

function isSistema(cat) {
    return Object.prototype.hasOwnProperty.call(SISTEMA_ARENAS, cat);
}

function detectArena(words) {
    let arena = null, max = 0;
    for (const [cat, hints] of Object.entries(SISTEMA_ARENAS)) {
        const n = hints.filter(h => words.includes(h)).length;
        if (n > max) { max = n; arena = cat; }
    }
    return max > 0 ? arena : null;
}

// Palavras que reforçam docs de VALORES/LIMITES quando a pergunta envolve dinheiro
// (ex.: "carro de 90 mil" → o doc de tetos/limites precisa pontuar e ter o snippet escolhido).
const VALUE_EXPANSION = ['teto', 'preco', 'maximo', 'valor', 'limite', 'mil'];

// A pergunta pede um VALOR/LIMITE? (ex.: "90 mil", "80k", "200.000", "teto", "preço")
function hasValueIntent(raw) {
    const r = String(raw || '').toLowerCase();
    if (/\d/.test(r) && /(mil|k|reais|real|dolar|usd|\d{3})/.test(r)) return true;
    return VALUE_EXPANSION.some(w => r.includes(w));
}

// A pergunta menciona mais de um sistema (ex.: "veículo e minha casa") → não excluir.
function isMixed(words) {
    let present = 0;
    for (const hints of Object.values(SISTEMA_ARENAS)) {
        if (hints.some(h => words.includes(h))) present++;
    }
    return present >= 2;
}

function loadDocContent(doc) {
    try {
        const p = path.join(__dirname, '..', doc.path);
        return fs.readFileSync(p, 'utf8');
    } catch (e) {
        return null;
    }
}

// Título do doc (# ...), cacheado — usado para melhorar o score.
let titleCache = null;
function loadDocTitle(doc) {
    if (!titleCache) titleCache = {};
    if (titleCache[doc.id]) return titleCache[doc.id];
    const content = loadDocContent(doc);
    const title = content ? content.split('\n').find(l => l.startsWith('#')) || '' : '';
    titleCache[doc.id] = title;
    return title;
}

// Conta quantos documentos possuem determinada palavra em topics/comandos.
// Palavras raras (presentes em poucos docs) têm mais peso → prioriza doc específico.
let wordFreqCache = null;
function computeWordFreq() {
    if (wordFreqCache) return wordFreqCache;
    const index = loadIndex();
    const freq = {};
    for (const doc of index.documents || []) {
        const kw = doc.keywords || doc.topics || [];
        const terms = `${kw.join(' ')} ${(doc.commands || []).join(' ')} ${doc.category} ${doc.id}`;
        for (const w of new Set(normalize(terms).split(/[^a-z0-9]+/))) {
            if (w.length < 4) continue;
            freq[w] = (freq[w] || 0) + 1;
        }
    }
    wordFreqCache = freq;
    return freq;
}

// Intenção da pergunta: quando o usuário pergunta uma AÇÃO ("como deletar",
// "como bloquear"), o doc que documenta essa ação tem que subir, mesmo que
// outro doc fale mais do assunto (veículo, imóvel, sessão).
const INTENT_TERMS = {
    deletar: 'deletar',
    registrar: 'registro',
    bloquear: 'bloquear',
    consultar: 'consultar'
};

function detectIntentOf(words) {
    const set = new Set(words);
    if (set.has('deletar')) return 'deletar';
    if (set.has('bloquear')) return 'bloquear';
    if (set.has('consultar')) return 'consultar';
    if (set.has('registro')) return 'registrar';
    return null;
}

/**
 * Calcula uma vez por busca e repassa para todos os documentos.
 * NÃO pode ser cacheado no módulo: o boost depende da pergunta, e guardar o
 * de uma consulta para aplicar na seguinte daria peso ao documento errado.
 */
function getBoosts(words) {
    try {
        return require('../utils/learnedPatterns').boostsFor(words);
    } catch (e) {
        return new Map();
    }
}

function scoreDoc(doc, words, boosts) {
    const freq = computeWordFreq();
    const kw = doc.keywords || doc.topics || [];
    const topics = normalize(kw.join(' '));
    const commands = normalize((doc.commands || []).join(' '));
    const docsWords = normalize((doc.category + ' ' + doc.id).replace(/[^a-z0-9]+/g, ' '));
    const title = normalize(loadDocTitle(doc));
    const isGeneric = /(erros|comandos)$/.test(doc.id);

    let score = 0;
    for (const w of words) {
        if (w.length < 4) continue;
        const weight = Math.max(1, 3 - (freq[w] || 3));
        const base = isGeneric ? 0.6 : 1;
        if (title.includes(w)) score += weight * 2 * base;
        else if (topics.includes(w)) score += weight * base;
        else if (commands.includes(w)) score += weight * 0.5 * base;
        else if (docsWords.includes(w)) score += weight * 0.3 * base;
    }

    const intent = detectIntentOf(words);
    if (intent) {
        const term = INTENT_TERMS[intent];
        if (topics.includes(term) || commands.includes(term) || title.includes(term)) score += 3;
    }

    // Prioridade editorial do documento: regra específica > configuração do
    // sistema > documentação geral. Escala pequena para não virar %.
    const priority = Number(doc.priority) || 5;
    score *= 1 + (priority - 5) / 50;

    // Documento aprendido (auto-kb) e o proprio bot escrevendo: nao pode
    // sobrepor conteudo auditado. O damping e maior que a prioridade porque
    // o score base do doc aprendido dispara (o titulo dele E a pergunta),
    // e sem isso ele dominava o ranking na primeira vez que era criado.
    if (doc.category === 'auto-kb') score *= 0.75;

    // Padrao aprendido: quando a MESMA pergunta ja foi respondida com este
    // doc, ele ganha peso. Require tardio para nao criar ciclo com o proprio
    // loader (o learnedPatterns nao importa o loader).
    if (boosts && doc.category !== 'auto-kb' && boosts.has(doc.id)) {
        score += boosts.get(doc.id);
    }

    return score;
}

function findRelevantDocs(question, limit = 3, arenaOverride = null, mixedOverride = null) {
    const index = loadIndex();
    const words = normalize(question).split(/[^a-z0-9]+/).filter(w => w.length >= 4);
    addValueExpansion(question, words);
    const arena = arenaOverride || detectArena(words);
    const mixed = mixedOverride === null ? isMixed(words) : mixedOverride;
    const boosts = getBoosts(words);
    const scored = (index.documents || [])
        .filter(doc => {
            // Arena só elimina documentos de OUTRO sistema. Docs de geral/tickets/
            // moderacao nunca são eliminados por não serem da arena.
            if (!arena || mixed) return true;
            if (!isSistema(doc.category)) return true;
            return doc.category === arena;
        })
        .map(doc => ({
            doc,
            score: scoreDoc(doc, words, boosts)
        }))
        .sort((a, b) => b.score - a.score);

    const achados = scored.filter(s => s.score > 0);

    // Documento aprendido (auto-kb) é anotação de baixo confiança escrita
    // pelo próprio bot. Ele só ENTRA no ranking se realmente vencer o melhor
    // documento curado — e o miner só o cria para pergunta que a KB não cobre,
    // então isso acontece na lacuna e em nenhum outro lugar. Quando existe
    // qualquer curado mais forte, o aprendido é descartado: não trocamos
    // texto auditado por anotação própria.
    const melhorCurado = achados.find(s => s.doc.category !== 'auto-kb');
    const aprendidos = achados.filter(s => s.doc.category === 'auto-kb');
    const aprendidosRelevantes = melhorCurado
        ? aprendidos.filter(s => s.score > melhorCurado.score)
        : aprendidos;

    const finais = (aprendidosRelevantes.length ? aprendidosRelevantes : achados).slice(0, limit);
    return finais.map(s => s.doc);
}

function addValueExpansion(question, words) {
    if (!hasValueIntent(question)) return;
    for (const w of VALUE_EXPANSION) {
        if (!words.includes(w)) words.push(w);
    }
}

// Localiza a tabela markdown mais próxima da linha que bateu (dentro da seção),
// para que um trecho truncado nunca perca as linhas de números.
function findNearbyTable(lines, start, end, bestIdx) {
    let sepIdx = -1;
    for (let i = start; i <= end && i < lines.length; i++) {
        if (/^\s*\|[\s\-|:]+\|?\s*$/.test(lines[i]) && lines[i].includes('-')) { sepIdx = i; break; }
    }
    if (sepIdx === -1) return null;
    let ts = sepIdx;
    while (ts > 0 && lines[ts - 1].trim().startsWith('|')) ts--;
    if (ts < start || ts > bestIdx + 15) return null;
    let te = sepIdx + 1;
    while (te < end && lines[te].trim().startsWith('|')) te++;
    return lines.slice(ts, te);
}

// Extrai apenas o trecho do documento mais relacionado à pergunta,
// em vez de injetar o documento inteiro (evita resposta-pasta de tudo).
function extractRelevantSnippet(content, words) {
    if (!content) return null;
    const lines = content.split('\n');

    // Prioriza linha de CONTEÚDO (não cabeçalho/vazia) que mais bate com a pergunta
    let bestIdx = -1, bestScore = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim() || /^#{1,4}\s/.test(line)) continue;
        const n = normalize(line).slice(0, 200);
        let s = 0;
        for (const w of words) {
            if (n.includes(w)) s += w.length >= 8 ? 4 : 3;
        }
        // Linha de FAQ ("- **Pergunta?** resposta") é resposta pronta: vale mais que
        // a tabela, senão o modelo responde pela última linha da tabela.
        if (/^\s*[-*]\s*\*\*[^*?]{3,60}\?\*\*/.test(line)) s += 3;
        if (s > bestScore) { bestScore = s; bestIdx = i; }
    }
    if (bestIdx === -1) return null;

    // Expande até os limites da seção (cabeçalhos #, ##, ###...)
    let start = bestIdx, end = bestIdx;
    while (start > 0 && !/^#{1,4}\s/.test(lines[start - 1])) start--;
    while (end < lines.length - 1 && !/^#{1,4}\s/.test(lines[end + 1])) end++;

    let section = lines.slice(start, end + 1);
    if (section.join('\n').length > 2400) {
        // Seção grande: mantém a tabela próxima (se houver) + linha que bateu + vizinhança
        const table = findNearbyTable(lines, start, end, bestIdx);
        section = table ? [...table] : [lines[bestIdx]];
        let total = section.join('\n').length;
        const used = new Set(table ? section : [lines[bestIdx]]);
        let up = bestIdx - 1, down = bestIdx + 1;
        while (total < 1200 && (up >= start || down <= end)) {
            if (up >= start) {
                const l = lines[up];
                if (!used.has(l) && total + l.length + 1 <= 1300) { section.unshift(l); used.add(l); total += l.length + 1; }
                up--;
            }
            if (down <= end) {
                const l = lines[down];
                if (!used.has(l) && total + l.length + 1 <= 1300) { section.push(l); used.add(l); total += l.length + 1; }
                down++;
            }
        }
    }

    // Inclui o cabeçalho da seção se estiver logo acima
    if (start > 0 && /^#{1,4}\s/.test(lines[start - 1]) && bestIdx - (start - 1) <= 12) {
        section.unshift(lines[start - 1]);
    }

    // Se ainda sobra orçamento, continua para a seção SEGUINTE. Pergunta de
    // procedimento quase sempre precisa do passo a passo, que costuma estar na
    // seção logo depois dos dados (ex.: o bot pergunta 3 coisas na denúncia).
    let totalLen = section.join('\n').length;
    let next = end + 1;
    while (totalLen < 900 && next < lines.length) {
        if (!/^#{1,4}\s/.test(lines[next])) break;
        let nEnd = next + 1;
        while (nEnd < lines.length && !/^#{1,4}\s/.test(lines[nEnd])) nEnd++;
        const nextSection = lines.slice(next, nEnd);
        const size = nextSection.join('\n').length;
        if (totalLen + size > 1600) break;
        section.push(...nextSection);
        totalLen += size;
        next = nEnd;
    }

    // Teto por documento: um doc não pode estourar o orçamento do contexto.
    const joined = section.join('\n');
    return joined.length > 2600 ? joined.slice(0, 2600) : joined;
}

function buildContext(question, maxChars = MAX_CONTEXT_CHARS, extraQuery = '') {
    const currentWords = normalize(question).split(/[^a-z0-9]+/).filter(w => w.length >= 4);
    const currentArena = detectArena(currentWords);
    const currentMixed = isMixed(currentWords);
    let arena = currentArena;
    let mixed = currentMixed;
    if (!arena && extraQuery) {
        const historyWords = normalize(extraQuery).split(/[^a-z0-9]+/).filter(w => w.length >= 4);
        arena = detectArena(historyWords);
    }

    const query = extraQuery ? `${question} ${extraQuery}` : question;
    const docs = findRelevantDocs(query, 3, arena, mixed);
    if (docs.length === 0) return { context: '', docs: [] };

    const words = normalize(query).split(/[^a-z0-9]+/).filter(w => w.length >= 4);
    addValueExpansion(query, words);

    let context = 'CONHECIMENTO OFICIAL (use SOMENTE isto, nunca invente):\n\n';
    const used = [];
    const usedCats = new Set();
    let remaining = maxChars;

    for (const doc of docs) {
        const content = loadDocContent(doc);
        if (!content) continue;

        const snippet = extractRelevantSnippet(content, words);
        if (!snippet) continue;

        let block = `--- ${doc.id} (${doc.category}) ---\n${snippet}\n\n`;
        // Pergunta de procedimento → junta também a resposta direta do topo do doc
        // (canal, botão, passos documentados), se a seção principal não a cobriu.
        if (isProcedural(question)) {
            const direct = findDirectAnswerSection(content);
            if (direct && direct !== snippet && !snippet.includes(direct.slice(0, 40))) {
                const extra = '\n' + direct;
                if (used.length > 0 && remaining - (block.length + extra.length) < 0) break;
                block += '\n' + direct + '\n\n';
            }
        }
        if (used.length > 0 && remaining - block.length < 0) break;
        context += block;
        used.push(doc.id);
        usedCats.add(doc.category);
        remaining -= block.length;
    }

    // Pergunta ambígua (docs de mais de um sistema) → avisa para não misturar regras.
    if (used.length && usedCats.size > 1) {
        context += 'AVISO: os blocos acima vêm de SISTEMAS DIFERENTES (Atlas = imóveis; Vehix = veículos; Ascend = sessões e tiers; tickets/moderacao = regras do servidor). Use SOMENTE o bloco do sistema sobre o qual a pergunta é. NUNCA misture regras entre blocos. Se a pergunta não deixar claro o sistema, pergunte antes de responder.\n';
    }

    return used.length ? { context, docs: used } : { context: '', docs: [] };
}

// Perguntas que precisam da seção de DADOS (canal, botão, comando, limite)
// do documento, e não só do trecho que bateu com a palavra da pergunta.
const PROC_WORDS = ['como', 'registro', 'registrar', 'solicitar', 'fazer', 'criar', 'adicionar', 'procedimento', 'passo', 'onde', 'comando', 'qual', 'limite', 'teto', 'valor', 'preco', 'quanto', 'erro', 'problema', 'duvida', 'denuncia', 'abrir', 'pedir', 'preciso'];
function isProcedural(question) {
    const n = normalize(question);
    return PROC_WORDS.some(w => n.includes(w));
}

// Pega a 1ª seção cujo título indica resposta direta/curta (ex.: "## Resposta curta").
function findDirectAnswerSection(content) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (!/^#{1,4}\s/.test(lines[i])) continue;
        const head = normalize(lines[i]);
        if (!/(resposta curta|respostas diretas)/.test(head)) continue;
        let j = i + 1;
        while (j < lines.length && !/^#{1,4}\s/.test(lines[j])) j++;
        return lines.slice(i, j).join('\n');
    }
    return null;
}

function DEBUG_SCORES(question) {
    const words = normalize(question).split(/[^a-z0-9]+/).filter(w => w.length >= 4);
    addValueExpansion(question, words);
    const boosts = getBoosts(words);
    return { words, scores: loadIndex().documents.map(d => ({ id: d.id, score: scoreDoc(d, words, boosts) })).sort((a, b) => b.score - a.score) };
}

/**
 * Resposta direta da base, sem passar pela IA.
 *
 * As guias da KB tem linhas no formato:
 *   - **Pergunta?** Resposta.
 * Se a pergunta bater com uma delas, a resposta ja e deterministica e
 * nao ha razao para gastar um request no modelo.
 *
 * @returns {{texto, docId, fonte}|null}
 */

// Interrogativos: nao dizem NADA sobre o assunto. Medido na base real:
//   "quantos veiculos posso ter"      -> casa "veiculo"  (KB cobre)
//   "onde fica a vitrine de artes"    -> casa so "onde"  (lacuna)
// Contar qualquer match como cobertura faria "quem ganhou a copa de 2022"
// passar por pergunta de servidor, e o chat global pararia de usar a web.
const INTERROGATIVOS = new Set(['como', 'onde', 'quando', 'quanto', 'quais', 'qual', 'quem', 'porque', 'por', 'voce', 'ter']);

/**
 * A base responde MESMO essa pergunta?
 *
 * Nao usa score: usa casamento de palavra de CONTEUDO. Um documento cobre a
 * pergunta se alguma palavra que nao seja interrogativo aparece no titulo,
 * nas keywords, nos topics ou nos comandos dele. "onde"/"como" aparecem em
 * qualquer documento e nao dizem nada sobre o assunto.
 *
 * @param {string} pergunta
 * @param {Array} docs  retorno de findRelevantDocs
 */
function cobreConhecimento(pergunta, docs) {
    if (!pergunta || !docs || !docs.length) return false;

    const conteudo = normalize(pergunta).split(/[^a-z0-9]+/)
        .filter(w => w.length >= 4 && !INTERROGATIVOS.has(w));
    if (!conteudo.length) return false; // so interrogativo: nao da para saber

    const lista = Array.isArray(docs) ? docs : [docs];
    for (const ref of lista) {
        const doc = ref && ref.id ? ref : (ref && ref.path ? ref : findDocById(String(ref)));
        if (!doc) continue;
        const titulo = (loadDocContent(doc) || '').split('\n').find(l => l.startsWith('#')) || '';
        const superficie = normalize([
            titulo,
            (doc.keywords || []).join(' '),
            (doc.topics || []).join(' '),
            (doc.commands || []).join(' '),
            doc.id,
        ].join(' '));
        if (conteudo.some(w => superficie.includes(w))) return true;
    }
    return false;
}

function findDocById(id) {
    return (loadIndex().documents || []).find(d => d.id === id) || null;
}

/**
 * Limpa o cache do índice e dos títulos.
 * Necessário depois que um documento novo é escrito em auto-kb/: sem isso o
 * processo continua usando o index.json antigo até o próximo restart.
 */
function invalidateCache() {
    cache = null;
    titleCache = null;
}

module.exports = { loadIndex, findRelevantDocs, loadDocContent, buildContext, deslugar, normalize, invalidateCache, cobreConhecimento, findDocById, KNOWLEDGE_DIR, MAX_CONTEXT_CHARS, DEBUG_SCORES };
