/**
 * Detecção de circumvenção.
 *
 * Não decide nada: só descreve COMO a pessoa tentou esconder. O valor disso
 * é duplo — vira evidência de score (esconder é intenção) e vira sinal de
 * que o filtro determinístico merece confiança extra naquela mensagem.
 */

const { normalize } = require('./normalizer');
const { index } = require('../../data/offensiveWords');

// B12: estas duas NAO podem ter a flag /g.
// Sao usadas so com .test(), e em JS .test() com /g avanca lastIndex: a
// proxima chamada comeca de onde a anterior parou. Como o objeto e
// module-level (singleton), o estado vazava entre mensagens de usuarios
// diferentes e a MESMA frase alternava de severidade conforme a ordem de
// chegada. Medido antes da correcao: 0.35 0 0.35 0 -- o peso da tecnica
// sumia em toda chamada par, o que fazia um caso no limite de 0.35 cair
// de DELETE_WARN para ALLOW. Sem /g nao ha lastIndex para vazar.
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/;
const BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/;
const HOMOGLYPH_RE = /[аαеορсԁԛ]/;   // cirílico grego confundido com latino
const SEP_CHARS = /[.\-_*+=~^]/;

/**
 * @param {string} original
 * @returns {Array<{technique:string, detail?:string}>}
 */
function detect(original) {
    const raw = String(original || '');
    const out = [];

    if (ZERO_WIDTH_RE.test(raw)) out.push({ technique: 'zero_width' });
    if (BIDI_RE.test(raw)) out.push({ technique: 'bidi_control' });
    if (HOMOGLYPH_RE.test(raw)) out.push({ technique: 'homoglyph' });

    const n = normalize(raw);
    if (n.hasLeet) out.push({ technique: 'leet', detail: n.trace.join(',') });
    if (n.hasStretched) out.push({ technique: 'stretched_chars' });
    if (n.hasSeparated) out.push({ technique: 'separated_letters' });

    // separadores entre letras: "f.d.p", "p-0-r-r-a"
    if (SEP_CHARS.test(raw.replace(/\s/g, ''))) {
        out.push({ technique: 'in_word_separators' });
    }

    // emoji no lugar de letra: "🅲🆄"
    if (/\p{Extended_Pictographic}/u.test(raw) && /[\p{L}]/u.test(raw)) {
        out.push({ technique: 'emoji_substitute' });
    }

    // BUG 8: fragmento separado que forma termo do dicionário ao colar.
    //
    // "mer da" -> "merda", "cuza o" -> "cuzao", "idi ota" -> "idiota". O
    // emoji e o separador viram espaço na normalização, então estes são o
    // contorno mais usado e o mais trivial de digitar.
    //
    // Precisava virar EVIDÊNCIA, não só match: sem esta técnica, "mer da"
    // casava com "merda" e era tratado como exclamação (portanto passa) —
    // o gate do BUG 6 comia a própria evasão. Medido: "mer da" caía para
    // low 0.38 e não era pego.
    //
    // A checagem é barata e precisa: só dois tokens adjacentes, e o
    // resultado tem que ser termo do dicionário. "seu servidor" -> "seuservidor"
    // não é termo, então não vira evidência.
    if (fragmentoComTermo(raw)) {
        out.push({ technique: 'split_fragment' });
    }

    return out;
}

// Índice de termos normalizados, montado uma vez.
const TERM_NORMALIZADO = new Set();
for (const term of index.keys()) TERM_NORMALIZADO.add(term);

/** Dois tokens adjacentes, colados, formam um termo do dicionário? */
function fragmentoComTermo(raw) {
    const tokens = normalize(raw).normalized.split(' ').filter(Boolean);
    for (let i = 0; i < tokens.length - 1; i++) {
        if (TERM_NORMALIZADO.has(tokens[i] + tokens[i + 1])) return true;
    }
    return false;
}

/**
 * Peso de score por técnica. Esconder é agravante.
 */
const TECHNIQUE_WEIGHT = {
    zero_width: 0.35,
    bidi_control: 0.40,
    homoglyph: 0.30,
    leet: 0.15,
    stretched_chars: 0.05,
    separated_letters: 0.15,
    in_word_separators: 0.10,
    // BUG 8: fragmento que forma termo do dicionário. Mesmo peso de emoji:
    // é o contorno de digitação mais comum que existe.
    split_fragment: 0.10,
    emoji_substitute: 0.10
};

function weightOf(techniques) {
    return techniques.reduce((acc, t) => acc + (TECHNIQUE_WEIGHT[t.technique] || 0), 0);
}

module.exports = { detect, weightOf, TECHNIQUE_WEIGHT };
