/**
 * Constantes do motor de moderação.
 * Sem lógica: só os vocabulários de categoria, severidade e ação.
 */

const CATEGORY = {
    ILLEGAL_CONTENT: 'illegal_content',   // child abuse e afins — sem contexto
    SEXUAL_ABUSE: 'sexual_abuse',
    PERSONAL_INSULT: 'personal_insult',   // "você é um idiota"
    HARASSMENT: 'harassment',             // xingamento direto a alguém
    PROFANITY: 'profanity',               // merda, porra, caralho
    SLUR: 'slur',                         // slur de identidade
    AGGRESSIVE_PHRASE: 'aggressive_phrase', // "vai tomar no cu"
    // BUG 7: ameaça direta ("some daqui", "cala a boca"). Fica separada de
    // AGGRESSIVE_PHRASE porque aquela é frase montada e esta é comando.
    AGGRESSION: 'aggression',
    CIRCUMVENTION: 'circumvention',       // "i d i o t a", "f.d.p"
    AMBIGUOUS_TERM: 'ambiguous_term',     // "pedo" — contexto decide
    NEUTRAL: 'neutral'
};

const SEVERITY = {
    NONE: 'none',
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical'
};

const SEVERITY_RANK = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

const ACTION = {
    ALLOW: 'allow',           // deixa passar (só log)
    DELETE_WARN: 'delete_warn', // apaga + warn (comportamento atual)
    MODERATE: 'moderate'       // reservado; não usado nesta fase
};

const AI_STATUS = {
    NOT_NEEDED: 'not_needed',     // determinístico resolveu
    PENDING: 'pending',           // requiresAI, aguardando classificador
    CLASSIFIED: 'classified',     // IA respondeu
    UNAVAILABLE: 'unavailable',   // IA falhou — NÃO é "conteúdo limpo"
    SKIPPED: 'skipped'            // IA desligada
};

const REASON = {
    ILLEGAL_TERM: 'illegal_term',
    PERSONAL_INSULT: 'personal_insult',
    HARASSMENT_TARGET: 'harassment_target',
    HARASSMENT_NO_TARGET: 'harassment_no_target',
    PROFANITY_DECLARATION: 'profanity_declaration',
    PROFANITY_COMPLAINT: 'profanity_complaint',
    CONTEXTUAL_WITH_MARKER: 'contextual_with_marker',
    CONTEXTUAL_WITHOUT_MARKER: 'contextual_without_marker',
    SHORT_TERM_WITH_CONTEXT: 'short_term_with_context',
    SHORT_TERM_NO_CONTEXT: 'short_term_no_context',
    // BUG 7: casou com marcador de ameaça, que é categoria própria.
    THREAT_MARKER: 'threat_marker',
    // BUG 6: termo expletivo/curto sem alvo e sem contexto = exclamação.
    EXCLAMATION: 'exclamation',
    CIRCUMVENTION: 'circumvention',
    AMBIGUOUS_RESOLVED_BY_CONTEXT: 'ambiguous_resolved_by_context',
    AMBIGUOUS_NEEDS_AI: 'ambiguous_needs_ai',
    CONTEXT_SUPPRESSED: 'context_suppressed',
    LAUGHTER: 'laughter',
    ROLEPLAY: 'roleplay',
    CLEAN: 'clean'
};

// Quem pode ser punido com a decisão. O chamador (messageCreate) só pune
// quando a decisão é FINAL — nunca quando a IA ficou indisponível.
const DECISION = {
    FINAL: 'final',
    NEEDS_REVIEW: 'needs_review',
    FINAL_CLEAN: 'final_clean'
};

module.exports = { CATEGORY, SEVERITY, SEVERITY_RANK, ACTION, AI_STATUS, REASON, DECISION };
