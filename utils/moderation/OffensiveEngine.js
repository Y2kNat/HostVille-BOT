/**
 * OffensiveEngine — ponto único de entrada da moderação.
 *
 *   const result = offensiveEngine.analyze(content, { debug: true });
 *
 * O engine é DETERMINÍSTICO e PURO:
 *   - não faz HTTP
 *   - não conhece o gateway, nem o Kilo, nem nenhum provedor
 *   - não decide punição: devolve `action` e o chamador decide
 *   - quando não tem certeza, devolve `requiresAI: true` e `aiStatus: 'pending'`
 *
 * Quem chama a IA é managers/ModerationClassifier.js, fora daqui.
 */

const { normalize } = require('./normalizer');
const { tokenize, hasPhrase } = require('./tokenizer');
const { matchCategory } = require('./matcher');
const contextAnalyzer = require('./contextAnalyzer');
const circumvention = require('./circumvention');
const { classify } = require('./classifier');
const { SEVERITY, ACTION, AI_STATUS, REASON, DECISION } = require('./constants');

/**
 * Ordem de verificação. Cada grupo tem semântica própria e para assim que
 * um acerta, os mais fortes de baixo não são procurados (exceto ambiguous,
 * que é consultado por último porque é o caso especial).
 */
const MATCH_ORDER = [
    'illegal',            // absoluto
    'hardBlock',          // xingamento com supressão de contexto
    'directInsult',       // insulto direto
    // BUG 7: ameaça DIRETA, categoria própria. Fica depois de directInsult
    // (insulto é mais específico) e antes de contextual (que é termo de uso
    // comum). Antes estas frases não casavam com NADA: "cala a boca",
    // "fica longe de mim", "vou te achar" passavam com zero match, enquanto
    // "cuzao" era barrado. A ameaça não pode ser menos protegida que o
    // insulto.
    'threat',
    // Camada condicional: imperativo sem objeto ("morre", "apaga aqui",
    // "some daqui"). É ameaça quando dirigida a alguém e comando de sistema
    // quando não é — a diferença está no CONTEXTO, não no verbo. O
    // classificador descarta o match quando o contexto é risada ou
    // reclamação de sistema, o que separa "morre logo" (ameaça) de
    // "morre de rir" (risada) e de "apaga aqui a luz" (reclamação).
    'threatSoft',
    'profanity',          // expletivo
    'shortSensitive',     // termos curtos
    'contextual',         // precisa marcador
    'circumvention',      // escrita alternativa
    'ambiguous'           // "pedo" — caso especial
];

// Termos curtos nunca entram em fuzzy/embutido: sem fronteira, "cu" casaria
// dentro de "cursor"/"cuidado".
const NO_FUZZY = new Set(['shortSensitive', 'circumvention', 'contextual', 'ambiguous', 'threat', 'threatSoft']);

/**
 * @param {string} content
 * @param {object} [options]
 * @param {boolean} [options.debug]        inclui o bloco de debug
 * @param {string[]} [options.customWords] palavras da staff (sempre absolutas)
 * @returns {object} resultado estruturado
 */
function analyze(content, options = {}) {
    const text = String(content == null ? '' : content);
    const debug = options.debug === true;

    const base = {
        flagged: false,
        category: null,
        severity: SEVERITY.NONE,
        confidence: 0.99,
        action: ACTION.ALLOW,
        matched: [],
        reasons: [],
        normalizedText: '',
        requiresAI: false,
        aiStatus: AI_STATUS.NOT_NEEDED
    };

    if (!text.trim()) return { ...base, reasons: [REASON.CLEAN] };

    // --- pipeline ----------------------------------------------------
    const tk = tokenize(text);
    const context = contextAnalyzer.analyze(text, tk.merged);
    const techniques = circumvention.detect(text);
    // BUG 8: a técnica de fragmento ("mer da" -> "merda") é medida, mas o
    // peso de "esconder é intenção" NÃO vale quando a pessoa está rindo.
    // "kkkk cuzao kkkkk" e "cuza😂o" têm a mesma semântica — xingamento dito
    // com risada — e precisam cair igual. Sem isto, o emoji de risada
    // somava +0.10 e a frase saltava de low para medium.
    //
    // Isto NÃO é o que o arquivo de dados descreve para directInsults
    // ("não é suprimido por humor"). A suíte existente afirma o contrário
    // ("citação, roleplay e risada suprimem"), e é ela que o comportamento
    // atual segue. A inconsistência entre as duas está registrada e
    // precisa de decisão do dono — ver o teste correspondente.
    const isRindo = /k{3,}/i.test(text) || require('./normalizer').LAUGH_EMOJI.test(text);
    const circWeight = isRindo ? 0 : circumvention.weightOf(techniques);

    // --- match -------------------------------------------------------
    const matches = [];
    for (const category of MATCH_ORDER) {
        const found = matchCategory(tk, category, {
            allowFuzzy: !NO_FUZZY.has(category),
            allowEmbedded: !NO_FUZZY.has(category)
        });
        matches.push(...found);
        if (found.length && category !== 'ambiguous') {
            // achou termo forte: não precisa continuar caçando
            if (category === 'illegal') break;
        }
    }

    // Palavras da staff: absolutas, sem supressão de contexto. A staff é a
    // autoridade final desse filtro, então o que ela cadastra sempre pega.
    if (Array.isArray(options.customWords) && options.customWords.length) {
        for (const w of options.customWords) {
            const nw = normalize(w).normalized;
            if (!nw) continue;
            let hit = false;
            for (const toks of tk.variants) {
                if (toks.includes(nw) || (nw.includes(' ') && hasPhrase(toks, nw.split(' ')))) {
                    hit = true; break;
                }
            }
            if (!hit) hit = tk.variants.some(v => v.includes(nw));
            if (hit) {
                matches.push({ term: w, category: 'illegal', matchType: 'token', confidence: 1.0, custom: true });
            }
        }
    }

    // --- classificar -------------------------------------------------
    const result = classify({ matches, context, techniques, circumventionWeight: circWeight });

    // --- normalizado exposto (útil para logs e para o chamador) -------
    result.normalizedText = tk.merged || tk.spaced;

    // --- supressão -------------------------------------------------
    // Absolutos (illegal) nunca são suprimidos.
    // Citação / técnico / lexical / roleplay suprimem QUALQUER nível, porque
    // neles a pessoa está falando do termo, não da pessoa.
    // Risada só suprime o que é fraco: rir junto de "você é um idiota" não
    // transforma xingamento em brincadeira.
    const hasAbsolute = matches.some(m => m.category === 'illegal');
    const strongSuppressors = context.isQuoted || context.isTechnical || context.isLexical || context.isRoleplay;
    const weakSuppressors = context.isLaughter;
    if (!hasAbsolute && (strongSuppressors || weakSuppressors)) {
        const WEAK = ['contextual', 'ambiguous', 'circumvention', 'shortSensitive', 'profanity'];
        const onlyWeak = matches.every(m => WEAK.includes(m.category));
        const suppressible = strongSuppressors || onlyWeak;
        if (suppressible && result.flagged) {
            result.flagged = false;
            result.action = ACTION.ALLOW;
            result.severity = SEVERITY.NONE;
            result.requiresAI = false;
            result.aiStatus = AI_STATUS.NOT_NEEDED;
            result.decision = DECISION.FINAL_CLEAN;
            result.reasons = [...new Set([...result.reasons, context.isLaughter ? REASON.LAUGHTER : REASON.CONTEXT_SUPPRESSED])];
        }
    }

    if (debug) {
        result.debug = {
            normalization: tk.norm.trace,
            tokens: tk.tokens,
            merged: tk.merged,
            compact: tk.norm.compact,
            aggressive: tk.norm.aggressive,
            matchedRules: matches.map(m => ({ term: m.term, category: m.category, matchType: m.matchType, confidence: m.confidence })),
            contextSignals: context.signals,
            techniques,
            score: result.score
        };
    }

    return result;
}

module.exports = { analyze, MATCH_ORDER, NO_FUZZY };
