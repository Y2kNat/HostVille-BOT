/**
 * Normalização em camadas.
 *
 * O ponto central: NÃO existe uma forma normalizada única. Existem três, e
 * cada uma resolve um problema diferente:
 *
 *   normalized  — minúsculas, sem acento, separadores viram espaço.
 *                 Serve para casar palavra inteira sem quebrar o texto.
 *
 *   compact     — sem espaços. Só é usada para frases, e sempre com
 *                 verificação de fronteira, senão "cu" casaria dentro de
 *                 "cursor".
 *
 *   aggressive  — leet + repetição colapsada + letras coladas.
 *                 Só é usada como evidência EXTRA, nunca como decisão
 *                 isolada: aplicar leet cegamente transforma "qu4l" em
 *                 "qual" (ok) mas também "c0sa" em "casa" e o risco de
 *                 falso positivo sobe.
 *
 * Cada transformação é registrada em `trace` para o modo debug.
 */

const LEET = require('../../data/offensiveWords').rules.leetMap;

/**
 * Homóglifos cirílicos e gregos que se confundem com o latim.
 *
 * Onde entra
 * A detecção de homóglifo existia (circumvention.js, HOMOGLYPH_RE) mas só
 * como EVIDÊNCIA de score — nunca como transformação. O token continuava
 * "сuzao" com C cirílico, e o unico caminho que o pegava era o fuzzy:
 * levenshtein("сuzao","cuzao") = 1 por substituição.
 *
 * Por que isso quebrou
 * Com a regra nova do BUG 1 (fuzzy só a partir de termo de 6 letras),
 * "cuzao" saiu do fuzzy — e o homóglifo de 5 letras ficou sem cobertura.
 * Depender do fuzzy para homóglifo era cobertura emprestada: ela valia
 * enquanto a regra do fuzzy não mudasse.
 *
 * Por que dobrar aqui é o conserto certo
 * Normalização é o lugar da transformação, e aí a detecção deixa de
 * depender de qualquer limiar: "сuzao" vira "cuzao" e é pego como token
 * exato, que é o caminho mais forte que existe. Vale para termo de
 * qualquer tamanho, e para o BUG 1 poder mudar de novo sem abrir buraco.
 */
const HOMOGLYPH = {
    // cirílico -> latim
    'а': 'a', 'в': 'v', 'с': 'c', 'е': 'e', 'н': 'h', 'к': 'k', 'м': 'm',
    'о': 'o', 'р': 'p', 'т': 't', 'у': 'y', 'х': 'x', 'ѕ': 's', 'і': 'i',
    'ј': 'j', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'г': 'r', 'ш': 'w', 'щ': 'w',
    'А': 'A', 'В': 'V', 'С': 'C', 'Е': 'E', 'Н': 'H', 'К': 'K', 'М': 'M',
    'О': 'O', 'Р': 'P', 'Т': 'T', 'У': 'Y', 'Х': 'X', 'Ѕ': 'S', 'І': 'I',
    'Ј': 'J', 'Ԛ': 'Q', 'Ԝ': 'W', 'Г': 'R', 'Ш': 'W',
    // grego -> latim
    'α': 'a', 'ο': 'o', 'ρ': 'p', 'ν': 'v', 'υ': 'u', 'τ': 't', 'κ': 'k',
    'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K',
    'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
    // latim -> cirílico (inverso, mesma função)
    'a': 'a', 'c': 'c', 'e': 'e', 'o': 'o', 'p': 'p', 'x': 'x', 'y': 'y',
    'A': 'A', 'B': 'B', 'C': 'C', 'E': 'E', 'H': 'H', 'K': 'K', 'M': 'M',
    'O': 'O', 'P': 'P', 'T': 'T', 'X': 'X', 'Y': 'Y',
};
const HOMOGLYPH_RE = /[Ѐ-ӿͰ-Ͽἀ-῿A-Za-z]/g;

/** Dobra caractere para o equivalente latino. */
function dobrarHomoglifo(t) {
    return String(t || '').replace(HOMOGLYPH_RE, (c) => HOMOGLYPH[c] || c);
}

// Emoji de riso: tratados antes de qualquer normalização de texto.
const EMOJI_LAUGH = /\p{Extended_Pictographic}/u;

const LAUGH_EMOJI = /[\u{1F600}-\u{1F64F}\u{1F602}\u{1F923}\u{1F606}\u{1F605}\u{1F609}\u{1F60A}\u{1F642}\u{1F643}]/u;

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const BIDI_CONTROL = /[\u202A-\u202E\u2066-\u2069]/g;

/** Remove invisíveis e testa se a mensagem é só emoji/space. */
function isEmojiOnly(text) {
    const t = String(text || '').replace(ZERO_WIDTH, '').trim();
    if (!t) return false;
    return !t.replace(new RegExp(EMOJI_LAUGH.source, 'gu'), '').replace(/[\s️‍]/g, '');
}

/**
 * @returns {{
 *   original: string,
 *   normalized: string,
 *   compact: string,
 *   aggressive: string,
 *   hasLeet: boolean,
 *   hasStretched: boolean,
 *   hasSeparated: boolean,
 *   hasEmojiOnly: boolean
 * }}
 */
function normalize(input) {
    const original = String(input == null ? '' : input);
    const trace = [];

    // 1. invisíveis e controles de direção (usados para esconder texto)
    let t = original.replace(ZERO_WIDTH, '').replace(BIDI_CONTROL, '');
    if (t !== original) trace.push('zero_width_removed');

    // 2. lowercase + remove acento
    t = t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // 2a. homoglifos cirilicos/gregos -> latim. Precisa vir ANTES do leet e
    // da tokenizacao: senao o token carrega o caractere errado e so o fuzzy
    // (com limiar de tamanho) consegue casar. Ver HOMOGLYPH acima.
    const tHomo = dobrarHomoglifo(t);
    if (tHomo !== t) trace.push('homoglyph_folded');
    t = tHomo;
    if (t !== original.toLowerCase()) trace.push('lowercased_unaccented');

    // 2b. leet ANTES de remover separadores. A ordem importa:
    //     "@rr0mb@do" -> se o "@" virasse espaço antes, viraria "rr0mb do"
    //     e a palavra se quebraria. Aqui fica "arrombado".
    let leetRaw = t;
    for (const [from, to] of Object.entries(LEET)) {
        if (leetRaw.includes(from)) leetRaw = leetRaw.split(from).join(to);
    }
    const hasLeet = leetRaw !== t;
    if (hasLeet) trace.push('leet_applied');
    const leetSpaced = leetRaw.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();

    // 3. separadores viram espaço (não somem): "f.d.p" -> "f d p".
    //    Manter como espaço permite tokenização honesta depois.
    const withSpaces = t.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();

    // 4. repetição excessiva. Duas estratégias, porque "merda" e "merrda"
    //    precisam normalizar igual:
    //       colapso 3+ -> 2  ("merddda" -> "merda")
    //       colapso 3+ -> 1  ("meeeerda" -> "merda")
    //    O colapso para 1 é seguro: só toca em 3+ repetições, e palavra
    //    portuguesa legível não tem 3 letras iguais seguidas ("hello" tem 2).
    const deStretched2 = withSpaces.replace(/(\p{L})\1{2,}/gu, '$1$1');
    const deStretched1 = withSpaces.replace(/(\p{L})\1{2,}/gu, '$1');
    const hasStretched = deStretched2 !== withSpaces;
    if (hasStretched) trace.push('repeated_chars_collapsed');

    // 5. camada leet já foi aplicada acima (antes dos separadores)
    const deLeeted = leetSpaced.replace(/(\p{L})\1{2,}/gu, '$1$1');
    const deLeeted1 = leetSpaced.replace(/(\p{L})\1{2,}/gu, '$1');

    // 6. letras soltas viram palavra: "i d i o t a" -> "idiota"
    const mergedFrom2 = mergeLooseLetters(deStretched2);
    const mergedFrom1 = mergeLooseLetters(deStretched1);
    const merged = (mergedFrom2.length >= mergedFrom1.length) ? mergedFrom2 : mergedFrom1;
    const hasSeparated = merged !== deStretched2;
    if (hasSeparated) trace.push('loose_letters_merged');

    // --- variantes para o matcher consultar em paralelo ---------------
    // Cada uma resolve uma forma de escrever. O matcher testa todas; a
    // fronteira por token continua valendo em cada variante, então
    // "cursor" nunca vira "cu".
    const variants = new Set();
    for (const v of [withSpaces, deStretched2, deStretched1, merged, mergedFrom1, deLeeted, deLeeted1, mergeLooseLetters(deLeeted), mergeLooseLetters(deLeeted1)]) {
        const t = String(v).trim();
        if (t) variants.add(t);
    }

    // BUG 8: variante com fragmento curto colado ao vizinho. E o que faz
    // "cuza<emoji>o", "cuza o", "c*uzao" e "idi ota" casarem — o emoji e o
    // separador viram espaco no passo 3, e sobra um fragmento + letra
    // solta, que nao e o caso de "run de 1 char" que mergeLooseLetters
    // trata. Sem esta variante, o buraco fica.
    for (const base of [withSpaces, deStretched1, deLeeted1]) {
        const colado = colarTokensAdjacentes(base);
        if (colado) variants.add(colado);
    }

    return {
        original,
        normalized: withSpaces,
        compact: withSpaces.replace(/\s+/g, ''),
        aggressive: deLeeted.replace(/\s+/g, ''),
        leetSpaced,
        merged,
        variants: [...variants],
        hasLeet,
        hasStretched,
        hasSeparated,
        hasEmojiOnly: isEmojiOnly(original),
        trace
    };
}

/**
 * "i d i o t a" -> "idiota", mas "e u" -> "e u" (não junta "eu").
 * Só junta sequências de 3+ letras soltas consecutivas, que é o padrão de
 * separação artificial. Palavras de 1-2 letras não entram.
 */
function mergeLooseLetters(text) {
    const tokens = text.split(' ').filter(Boolean);
    const out = [];
    let buffer = '';
    const flush = () => {
        if (buffer.length >= 3) out.push(buffer);
        else if (buffer.length) out.push(...buffer.split(''));
        buffer = '';
    };
    for (const tok of tokens) {
        if (tok.length === 1 && /[\p{L}]/u.test(tok)) buffer += tok;
        else { flush(); out.push(tok); }
    }
    flush();
    return out.join(' ');
}

/**
 * BUG 8 - cola tokens adjacentes.
 *
 * CAUSA RAIZ dos bypass por emoji, espaco e separador
 * `mergeLooseLetters` so junta sequencias de 1 letra:
 *   "i d i o t a" = 6 tokens de 1 char  -> junta -> "idiota"   OK
 *   "cuza o"      = token de 4 + 1 char -> NAO junta -> ESCAPA
 * E o emoji vira espaco no passo de separadores, entao "cuza<emoji>o"
 * vira "cuza o" e cai nesse buraco. O mesmo buraco pega "idi<emoji>ota",
 * "mer<emoji>da", "c*uzao" e "m*erda" - um furo, cinco sintomas.
 *
 * Por que TODAS as concatenacoes, e nao so "fragmento curto + vizinho"
 * A versao com "um lado tem 1-2 letras" pegava "cuza o" mas nao pegava
 * "idi ota" (3+3), que e o mesmo bypass. Exigir fragmento curto deixa
 * metade do buraco aberta.
 *
 * Por que isso nao cria falso positivo
 * A funcao nao decide nada: ela so produz mais uma VARIANTE de texto para
 * o matcher consultar, e o matcher so aceita o resultado se ele casar
 * EXATAMENTE com um termo do dicionario como token inteiro. O dicionario
 * e o filtro. "seu"+"servidor" -> "seuservidor" nao casa com nada e vira
 * nada. "a"+"pato" -> "apato" idem. So vira match se a concatenacao for
 * literalmente um termo, e ai a pessoa de fato escreveu o termo partido em
 * duas.
 *
 * O risco residual medido: um par de palavras que por acaso forma um termo
 * do dicionario. "por"+"ra" -> "porra" e o caso real conhecido. E uma
 * construcao que nao aparece em portugues ("por ra" nao e frase), e o
 * custo e uma palavra a mais num filtro que ja exige contexto para
 * `profanity`. A alternativa (deixar o buraco aberto) custa mais.
 */
function colarTokensAdjacentes(text) {
    const tokens = String(text || '').split(' ').filter(Boolean);
    if (tokens.length < 2) return null;
    const colados = [];
    for (let i = 0; i < tokens.length - 1; i++) colados.push(tokens[i] + tokens[i + 1]);
    return colados.join(' ');
}

/** Aplica o leet numa string qualquer (usado pelo matcher em token candidato). */
function applyLeet(s) {
    let out = String(s);
    for (const [from, to] of Object.entries(LEET)) out = out.split(from).join(to);
    return out;
}

module.exports = { normalize, mergeLooseLetters, colarTokensAdjacentes, applyLeet, dobrarHomoglifo, HOMOGLYPH, isEmojiOnly, LAUGH_EMOJI };
