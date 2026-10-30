/**
 * Classifier: evidências → score → categoria + severidade + ação.
 *
 * Recebe as evidências que o matcher e o contextAnalyzer produziram e decide.
 * Não conhece o texto original, nem o banco de palavras, nem a IA. É puro e
 * testável isoladamente.
 */

const { WEIGHTS, MATCH_CONFIDENCE_BONUS, REPEAT_DAMPING, THRESHOLDS } = require('./rules');
const { exclamationTerms } = require('../../data/offensiveWords');

// Termos que em PT-BR são mais exclamação que xingamento. Ver a lista e a
// medição em data/offensiveWords.js (exclamationTerms).
const EXCLAMACAO_SET = new Set(exclamationTerms.map(t => String(t).toLowerCase()));
const { CATEGORY, SEVERITY, ACTION, REASON, DECISION, AI_STATUS } = require('./constants');

// peso do score por tipo de match vindo do matcher
const MATCH_TYPE_WEIGHT = {
    illegal: WEIGHTS.illegalTerm,
    hardBlock: WEIGHTS.hardBlock,
    directInsult: WEIGHTS.directInsult,
    profanity: WEIGHTS.profanity,
    contextual: WEIGHTS.contextual,
    shortSensitive: WEIGHTS.shortSensitive,
    circumvention: WEIGHTS.contextual,   // só vale com marcador
    ambiguous: WEIGHTS.ambiguous,
    // BUG 7: ameaça direta é o fato em si, não evidência de alvo. Entra
    // com peso próprio e acima de `contextual`, porque "some daqui" é mais
    // grave que "seu chato" — e antes passava completamente.
    threat: WEIGHTS.threat,
    // BUG 7 camada 2: mesmo peso, mas o match é descartado antes se o
    // contexto for risada ou reclamação de sistema.
    threatSoft: WEIGHTS.threat
};

// tipo de match interno -> categoria do resultado
const MATCH_CATEGORY = {
    illegal: CATEGORY.ILLEGAL_CONTENT,
    hardBlock: CATEGORY.AGGRESSIVE_PHRASE,
    directInsult: CATEGORY.PERSONAL_INSULT,
    profanity: CATEGORY.PROFANITY,
    contextual: CATEGORY.PERSONAL_INSULT,
    shortSensitive: CATEGORY.PROFANITY,
    circumvention: CATEGORY.CIRCUMVENTION,
    ambiguous: CATEGORY.AMBIGUOUS_TERM,
    threat: CATEGORY.AGGRESSION,
    threatSoft: CATEGORY.AGGRESSION
};

function severityFromScore(score) {
    if (score >= THRESHOLDS.critical) return SEVERITY.CRITICAL;
    if (score >= THRESHOLDS.high) return SEVERITY.HIGH;
    if (score >= THRESHOLDS.medium) return SEVERITY.MEDIUM;
    if (score >= THRESHOLDS.low) return SEVERITY.LOW;
    return SEVERITY.NONE;
}

function actionFromSeverity(severity) {
    // Política travada nesta fase: low não pune, o resto apaga+warn.
    // Nenhuma punição nova por severidade (sem mute por severidade).
    if (severity === SEVERITY.NONE) return ACTION.ALLOW;
    if (severity === SEVERITY.LOW) return ACTION.ALLOW;
    return ACTION.DELETE_WARN;
}

/**
 * @param {object} p
 * @param {Array}  p.matches      saída do matcher
 * @param {object} p.context      saída do contextAnalyzer
 * @param {Array}  p.techniques   saída do circumvention
 * @param {number} p.circumventionWeight
 * @returns {object} resultado
 */
function classify({ matches, context, techniques, circumventionWeight }) {
    const reasons = [];
    const matchedOut = [];
    let score = 0;

    // BUG 7 camada 2: imperativo sem objeto ("morre", "apaga aqui", "some
    // daqui") só é ameaça quando tem ALVO DE PESSOA.
    //
    // Por que alvo e não "não é risada / não é reclamação"
    // Essa foi a primeira tentativa e não funciona. Medido: "morre de rir"
    // (0.79) NÃO tem marcador de risada nenhum — "rir" não está em
    // HUMOR_RE, que só tem kkkk, haha, rs, lol. E "apaga a luz" (0.79)
    // NÃO tem palavra de reclamação, porque "luz" não está em
    // COMPLAINT_RE. O gate ficava furado pelos dois lados.
    //
    // Alvo de pessoa é o único sinal confiável, porque é a diferença real:
    // "morre logo o processo" é comando, "morre logo SEU IDIOTA" é ameaça.
    //
    // LACUNA ACEITA, e registrada no teste: "morre logo" sozinho, sem
    // destinatário, NÃO é detectado. Todo verbo nu sem alvo tem leitura
    // legítima em português, e errar aqui é errar contra usuário innocent.
    const matchesEfetivos = matches.filter(m => {
        if (m.category !== 'threatSoft') return true;
        if (context.isLaughter || context.isHumor) return false;
        if (context.hasComplaint) return false;
        if (!context.hasTarget) return false;
        return true;
    });

    // --- score dos matches, com damping por repetição -----------------
    const used = new Set();
    let slot = 0;
    for (const m of matchesEfetivos) {
        const base = MATCH_TYPE_WEIGHT[m.category] ?? 0;
        const damp = REPEAT_DAMPING[Math.min(slot, REPEAT_DAMPING.length - 1)];
        const bonus = MATCH_CONFIDENCE_BONUS[m.matchType] || 0;
        const contribution = base * damp + bonus;
        score += contribution;
        slot++;
        if (used.has(m.term)) continue;
        used.add(m.term);
        matchedOut.push({
            text: m.term,
            normalized: m.term,
            type: m.category,
            matchType: m.matchType,
            severity: severityFromScore(contribution),
            confidence: m.confidence
        });
    }

    // --- contexto (positivo e negativo) ------------------------------
    for (const sig of context.signals) score += sig.weight;
    if (circumventionWeight > 0) {
        score += circumventionWeight;
        reasons.push(REASON.CIRCUMVENTION);
    }

    // --- termos absolutos ignoram score ------------------------------
    const hasIllegal = matchesEfetivos.some(m => m.category === 'illegal');
    if (hasIllegal) {
        score = Math.max(score, THRESHOLDS.critical);
        reasons.push(REASON.ILLEGAL_TERM);
    }

    // --- sem match nenhum: limpo, mas com score de contexto ----------
    if (!matchesEfetivos.length) {
        return {
            flagged: false,
            category: null,
            severity: SEVERITY.NONE,
            confidence: 0.99,
            action: ACTION.ALLOW,
            matched: [],
            reasons: [REASON.CLEAN],
            score: 0,
            decision: DECISION.FINAL_CLEAN,
            requiresAI: false,
            aiStatus: AI_STATUS.NOT_NEEDED
        };
    }

    // --- explicabilidade: quais motivos explicam o score ----------
    const cats = new Set(matchesEfetivos.map(m => m.category));
    if (cats.has('directInsult') || cats.has('contextual')) {
        reasons.push(context.hasTarget ? REASON.HARASSMENT_TARGET : REASON.HARASSMENT_NO_TARGET);
    }
    if (cats.has('profanity')) {
        reasons.push(context.hasComplaint || context.hasMoney ? REASON.PROFANITY_COMPLAINT : REASON.PROFANITY_DECLARATION);
    }
    if (cats.has('hardBlock') || cats.has('shortSensitive')) {
        reasons.push(context.hasAggressionMarker ? REASON.SHORT_TERM_WITH_CONTEXT : REASON.SHORT_TERM_NO_CONTEXT);
    }
    if (cats.has('threat') || cats.has('threatSoft')) reasons.push(REASON.THREAT_MARKER);
    if (cats.has('ambiguous')) {
        reasons.push(context.hasAggressionMarker || context.hasTarget
            ? REASON.AMBIGUOUS_RESOLVED_BY_CONTEXT
            : REASON.AMBIGUOUS_NEEDS_AI);
    }
    if (context.isLaughter) reasons.push(REASON.LAUGHTER);
    else if (context.isQuoted || context.isTechnical || context.isLexical) reasons.push(REASON.CONTEXT_SUPPRESSED);

    let severity = severityFromScore(score);
    let action = actionFromSeverity(severity);

    // BUG 6: xingamento usado como EXCLAMAÇÃO.
    //
    // "fds", "prr", "tnc", "vsf", "cu", "caralho" são exclamação na maioria
    // do tempo em português BR. Medido antes: "fds que coisa" medium 0.48,
    // "tnc mano" high 0.59, "vsf mano" high 0.75, "cu mano" high 0.59,
    // "caralho mano" high 0.65.
    //
    // O que separa exclamação de insulto dirigido não é a palavra — é haver
    // ALVO. "seu fdp" tem alvo e é insulto; "fds que coisa" não tem e é
    // explosão. Reclamação de sistema (COMPLAINT_RE) já é coberta por
    // sinal próprio; o gap é "nem reclamação nem alvo", que é exclamação
    // pura.
    //
    // Aqui só se corta a PUNICAO, não o registro: a mensagem continua
    // caindo no log de staff com o termo, que é o que a pessoa precisa ver
    // se o filtro errar. Cortar o log esconderia o erro de calibragem.
    const SO_EXCLAMACAO = ['shortSensitive', 'profanity'];
    // A lista é por TERMO, não por categoria: "vsf" e "cu" vivem em
    // directInsults, e um gate por categoria não os alcança.
    // Match por FUZZY nunca é exclamação. "idiotoa" casa com "idiota" por
    // distância de edição 1, e isso é erro de digitação de xingamento, não
    // explosão. Medido: com o fuzzy incluído no gate, "idiotoa" caía de
    // medium 0.45 para low 0.27 e passava — o gate estava comendo o
    // insulto justamente por causa do Protection que deveria Comics-lo.
    const todosExclamativos = matchesEfetivos.length > 0
        && matchesEfetivos.every(m =>
            (m.matchType !== 'fuzzy')
            && (SO_EXCLAMACAO.includes(m.category)
                || EXCLAMACAO_SET.has(String(m.term).toLowerCase())));
    // E NUNCA quando há evidência de circumvenção. Medido: sem esta linha,
    // "m3rda" (leet de "merda") caía de high para low 0.689 e passava — o
    // gate tratava evasão deliberada como explosão. Esconder a palavra é o
    // oposto de exclamação.
    const ehExclamacaoPura = todosExclamativos
        && !context.hasTarget
        && !context.hasAggressionMarker
        && !context.isQuoted
        && !context.isTechnical
        && !context.isLexical
        && !context.isRoleplay
        && circumventionWeight === 0;
    if (ehExclamacaoPura && action !== ACTION.ALLOW) {
        severity = SEVERITY.LOW;
        action = ACTION.ALLOW;
        reasons.push(REASON.EXCLAMATION);
    }

    // --- ambiguidade real: precisa da IA? ---------------------------
    // Só quando achou termo ambíguo E o contexto não resolveu.
    // Ex.: "tô sem pedo" -> tem ambíguo, sem marcador, sem alvo.
    const ambiguousUnresolved = cats.has('ambiguous') &&
        !context.hasAggressionMarker && !context.hasTarget &&
        !context.isLaughter && !context.isQuoted && !context.isTechnical;

    // Se um termo forte já casou, não precisa de IA.
    const hasStrong = cats.has('illegal') || cats.has('directInsult') || cats.has('hardBlock') || cats.has('threat');
    const requiresAI = ambiguousUnresolved && !hasStrong;

    // confiança final: maior match + bônus, limitada a 0.99
    const topConfidence = Math.max(...matchesEfetivos.map(m => m.confidence || 0));
    let confidence = Math.min(0.99, topConfidence * 0.85 + Math.min(0.14, score * 0.14));

    // confiança cai se o contexto suprimiu
    if (context.isQuoted || context.isTechnical || context.isLaughter || context.isLexical) {
        confidence = Math.min(confidence, 0.45);
    }

    // baixa severidade mas sem decisão clara -> precisa de revisão
    const decision = (!action || action === ACTION.ALLOW) && matchesEfetivos.length && score > 0
        ? DECISION.NEEDS_REVIEW
        : DECISION.FINAL;

    return {
        flagged: action === ACTION.DELETE_WARN,
        category: dominantCategory(cats, context),
        severity,
        confidence: Number(confidence.toFixed(3)),
        action,
        matched: matchedOut,
        reasons: [...new Set(reasons)],
        score: Number(score.toFixed(3)),
        decision,
        requiresAI,
        aiStatus: requiresAI ? AI_STATUS.PENDING : AI_STATUS.NOT_NEEDED
    };
}

/** Categoria dominante por prioridade, não por ordem de aparecimento. */
function dominantCategory(cats, context) {
    if (cats.has('illegal')) return CATEGORY.ILLEGAL_CONTENT;
    if (cats.has('hardBlock')) return CATEGORY.AGGRESSIVE_PHRASE;
    if (cats.has('directInsult')) return CATEGORY.PERSONAL_INSULT;
    // BUG 7: ameaça acima de insulto na dominante. Se a frase tem os dois
    // ("seu idiota, some daqui"), a ameaça é o que define a ação.
    if (cats.has('threat') || cats.has('threatSoft')) return CATEGORY.AGGRESSION;
    if (cats.has('ambiguous')) return CATEGORY.AMBIGUOUS_TERM;
    if (cats.has('profanity')) return CATEGORY.PROFANITY;
    if (cats.has('shortSensitive')) return CATEGORY.PROFANITY;
    if (cats.has('circumvention')) return CATEGORY.CIRCUMVENTION;
    if (cats.has('contextual')) {
        return context.hasTarget ? CATEGORY.PERSONAL_INSULT : CATEGORY.HARASSMENT;
    }
    return CATEGORY.NEUTRAL;
}

module.exports = { classify, severityFromScore, actionFromSeverity };
