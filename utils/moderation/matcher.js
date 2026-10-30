/**
 * Matcher: casa termos do banco contra os tokens.
 *
 * Três famílias de match, com confiança própria:
 *
 *   token exato       "cu"       conf 0.98  (fronteira garantida pela tokenização)
 *   frase exata       "vai tomar no cu"  conf 0.96
 *   embutido          "seuidiota"        conf 0.90  (concatenação)
 *   compacto+fuzzy   "idi0ta", "1diota" conf 0.86  (fuzzy só em candidato)
 *
 * Termos curtos (< 4 letras) NUNCA entram em fuzzy nem em embutido: sem
 * fronteira, "cu" casaria dentro de "curso", "cuidado", "executar".
 */

const { normalize, applyLeet } = require('./normalizer');
const { embeddedPosition, hasPhrase } = require('./tokenizer');

const { index, fuzzyBlocked, fuzzyBlockedTerms } = require('../../data/offensiveWords');

// Índice de termos normalizados, montado uma vez.
// category -> Set de termos normalizados (com espaço, para frases)
const TERM_SETS = new Map();
for (const [term, cats] of index) {
    for (const cat of cats) {
        if (!TERM_SETS.has(cat)) TERM_SETS.set(cat, new Set());
        TERM_SETS.get(cat).add(normalize(term).normalized || normalize(term).normalized);
    }
}
// Qualquer termo do dicionário, em qualquer categoria.
//
// BUG 1 (consequência): com fuzzy a distância 2, "caralho" casa com
// "canalha" — os dois são palavras do dicionário e os dois são palavras
// portuguesas de verdade. Não é erro de digitação, é palavra parecida.
//
// Regra: se o token JÁ é um termo do dicionário, ele não precisa de fuzzy.
// Ele foi (ou será) pego por token exato em alguma categoria, e o fuzzy só
// soma um segundo match falso. Sem esta guarda, "caralho mano" recebia
// hardBlock(profanity) + directInsult("canalha", fuzzy) ao mesmo tempo.
const QUALQUER_TERM = new Set();
for (const terms of TERM_SETS.values()) {
    for (const t of terms) QUALQUER_TERM.add(t);
}

// termos normalizados sem acento/espaço, para casar frase já normalizada
const PHRASES = new Map();
for (const [term, cats] of index) {
    const n = normalize(term).normalized;
    if (n.includes(' ')) {
        for (const cat of cats) {
            if (!PHRASES.has(cat)) PHRASES.set(cat, new Set());
            PHRASES.get(cat).add(n);
        }
    }
}

// distância de edição só para termos com 5+ caracteres
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 2) return 99;
    let prev = new Array(n + 1);
    let cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        cur[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        [prev, cur] = [cur, prev];
    }
    return prev[n];
}

/**
 * @param {object} tk  saída de tokenize()
 * @param {string} category
 * @param {object} [opts] { allowFuzzy, allowEmbedded, minTokenLen }
 * @returns {Array<{term, category, matchType, confidence, position}>}
 */
function matchCategory(tk, category, opts = {}) {
    const { allowFuzzy = true, allowEmbedded = true } = opts;
    const found = [];
    const seen = new Set();

    // cada variante é consultada como token list independente
    const tokenSets = (tk.variants && tk.variants.length ? tk.variants : [tk.tokens]);

    // BUG 13: os caminhos 3 (embutido) e 4 (fuzzy) iteravam `tokenSets.flat()`
    // sem deduplicar. Uma mensagem realista de 2000 caracteres tem 348 tokens
    // e 15 distintos: os 333 repetidos eram comparados contra todos os termos
    // das 8 categorias, sem gerar match novo — só CPU. Medido: 94% do tempo
    // do filtro estava em matchCategory, e a causa era a duplicata, não o
    // número de termos (bucket por tamanho dava só 18%).
    //
    // Seguro porque os dois caminhos já usam `seen` como guarda de
    // resultado: repetir token não gerava match novo.
    const uniqToks = [...new Set(tokenSets.flat())];

    // 1) frase exata
    for (const phrase of (PHRASES.get(category) || [])) {
        const pTokens = phrase.split(' ');
        for (const toks of tokenSets) {
            if (hasPhrase(toks, pTokens)) {
                const key = 'phrase:' + phrase;
                if (!seen.has(key)) {
                    seen.add(key);
                    found.push({ term: phrase, category, matchType: 'phrase', confidence: 0.96 });
                }
                break;
            }
        }
    }

    // 2) token exato
    for (const toks of tokenSets) {
        for (const tok of toks) {
            if ((TERM_SETS.get(category) || new Set()).has(tok) && !seen.has('tok:' + tok)) {
                seen.add('tok:' + tok);
                found.push({ term: tok, category, matchType: 'token', confidence: 0.98 });
            }
        }
    }

    // 3) embutido em token maior (concatenação: "seuidiota", "aaaaidiotaaaa")
    //
    // BUG 11 (consequência): depois de o embedded passar a funcionar, um
    // mesmo termo podia casar de DUAS formas na mesma categoria — exato e
    // embutido — e o classifier soma o peso das duas. Medido: "kkkk cuzao
    // kkkkk" foi de low 0.24 para medium 0.367 e passou a ser moderado, e
    // "que merda de sistema" foi de low 0.33 para medium 0.469. Ou seja:
    // corrigir o código morto quebrou dois casos que eram(elemento
    // verificados como corretos.
    //
    // A guarda abaixo é a do caminho 4 (fuzzy), que já fazia isto: se o
    // termo já casou exato, o embutido é redundante.
    if (allowEmbedded) {
        for (const tok of uniqToks) {
            for (const term of (TERM_SETS.get(category) || [])) {
                if (term.length < 4) continue;
                if (seen.has('emb:' + term)) continue;
                if (seen.has('tok:' + term)) continue;
                // Termo que colide com palavra real não entra por
                // concatenação. Medido: "meu sapato novo" colava em
                // "sapaton" + "ovo" e era moderado por este caminho.
                if (fuzzyBlockedTerms.has(term)) continue;
                const at = embeddedPosition(tok, term);
                if (at !== null) {
                    seen.add('emb:' + term);
                    found.push({ term, category, matchType: 'embedded', confidence: 0.90, position: at });
                }
            }
        }
    }

    // 4) fuzzy: só em token candidato, só termo 6+, distância 1
    //
    // BUG 1: a regra antiga era `term.length >= 5` com `levenshtein === 1`.
    // Isso ligava a distância mínima a um termo curto, e termo curto em
    // português é palavra comum. Medido: 12 de 56 palavras comuns
    // disparavam (21% de falso positivo) — vinda, vida, porta, manda, mota,
    // pata, poca, roca, viara. "Bem vinda ao Sv, minha vd!" era moderate
    // como "viada" com conf 0.815.
    //
    // A regra nova: sem fuzzy abaixo de 6 letras, distância 1 a partir de 6.
    //
    // DISTÂNCIA 2 FOI TESTADA E REVERTIDA. O plano original dizia "dist<=2
    // a partir de 6", e a medição de falso positivo que existia era só da
    // distância 1 (21%). A 2 não foi medida — e em produçãomoderateu
    // innocent, medido:
    //   "Vamo passar o fuzil no marcio"  -> "karaio"  (Márcio, dist 2)
    //   "Agr tô com peso na consciência Jenny" -> "putona" ("peso"+"na"
    //                                     colados = "pesona", dist 2)
    //   "Agr tô..." (fragmento colado)     -> "aborto" (dist 2)
    // Três casos de nome e palavra comum a distância 2. Distância 2 em
    // português gera palavra de verdade, não erro de digitação.
    //
    // E não comprava evasão: "idiotass", "cuzaooo", "idiottta" e "burrooo"
    // continuam pegos na distância 1 porque o normalizer colapsa repetição
    // antes do matcher. O ganho da distância 2 era só falso positivo.
    //
    // O QUE ESTÁ COBERTO DEPOIS: o leet não passa por fuzzy. O
    // normalizer/applyLeet converte 0->o, 3->e, 1->i e gera variante de
    // token, e é ali que cuza0/m3rda/f0der/v1ad0 são pegados. O fuzzy só
    // cobre o que o leet não pega.
    //
    // A ÚNICA regressão medida: "cuz1o" (dígito no meio, que não é
    // conversion de letra). Está coberto por entrada explícita em
    // circumventionTerms — ver data/offensiveWords.js.
    if (allowFuzzy) {
        for (const tok of uniqToks) {
            if (tok.length < 6) continue;
            if (seen.has('tok:' + tok)) continue;
            // já é palavra do dicionário: o match exato cobre, o fuzzy
            // só adicionaria palavra parecida como segundo match
            if (QUALQUER_TERM.has(tok)) continue;
            const leetTok = applyLeet(tok);
            const cands = leetTok !== tok ? [tok, leetTok] : [tok];
            for (const cand of cands) {
                if (cand.length < 6 || cand.length > 12) continue;
                for (const term of (TERM_SETS.get(category) || [])) {
                    if (term.length < 6 || Math.abs(term.length - cand.length) > 2) continue;
                    if (seen.has('emb:' + term) || seen.has('tok:' + term)) continue;
                    // Par medido que o fuzzy não pode casar: "sapato" ~ "sapatão".
                    // Ver data/offensiveWords.js (fuzzyBlockedPairs) e o teste
                    // "fuzzy não casa palavra real" em tests/moderacao-filtro.
                    if (fuzzyBlocked.get(cand + '|' + term)) continue;
                    if (levenshtein(cand, term) === 1) {
                        seen.add('tok:' + cand);
                        found.push({ term, category, matchType: 'fuzzy', confidence: 0.86, matchedText: cand });
                        break;
                    }
                }
                if (seen.has('tok:' + cand)) break;
            }
        }
    }

    return found;
}

module.exports = { matchCategory, levenshtein, TERM_SETS, PHRASES, QUALQUER_TERM };
