/**
 * Pesos e limiares.
 *
 * IMPORTANTE: estes números são uma BASE, não dogma. Foram calibrados contra
 * a bateria em tests/engine.test.js e devem ser ajustados lá, com o caso
 * que quebrou à vista. A ordem de evidência não muda: nunca
 * "palavra achou -> bloqueia".
 */

// Score bruto acumulado: soma positiva (agravante) e negativa (contexto).
const WEIGHTS = {
    // Termo absoluto (child abuse e afins)
    illegalTerm: 0.95,
    // Insulto direto a pessoa
    directInsult: 0.45,
    // Termo de xingamento que o filtro já bloqueava, com supressão de contexto
    hardBlock: 0.45,
    // Expletivo: depende do resto da frase
    profanity: 0.34,
    // Termo de uso comum em RP: precisa de marcador de agressão
    contextual: 0.20,
    // Termo curto (cu, fdp): boundary já garantida pela tokenização
    shortSensitive: 0.18,
    // Termo ambíguo achado e ainda sem resolução
    ambiguous: 0.20,
    // BUG 7: ameaça direta ("some daqui", "cala a boca", "apaga aqui").
    // Acima de directInsult (0.45) porque a ameaça é mais grave que o
    // insulto: insulto ofende, ameaça promete violência. Antes estas
    // frases passavam com score 0 e nenhuma match.
    threat: 0.55
};

// Confiança por tipo de match, somada ao score como bônus de evidência.
const MATCH_CONFIDENCE_BONUS = {
    token: 0.04,
    phrase: 0.03,
    embedded: 0.02,
    fuzzy: 0.00
};

// Vários insultos na mesma frase não são 3x mais ofensivos que um: o
// primeiro conta cheio e os seguintes de forma decrescente.
const REPEAT_DAMPING = [1, 0.35, 0.15, 0.05];

// Limiares de score -> severidade
const THRESHOLDS = {
    critical: 0.90,
    high: 0.55,
    medium: 0.35,
    low: 0.15
};

// Abaixo desta confiança o resultado não é bom bastante para punir sem
// revisão humana: vira 'needs_review'.
const MIN_CONFIDENCE_TO_FLAG = 0.55;

module.exports = {
    WEIGHTS,
    MATCH_CONFIDENCE_BONUS,
    REPEAT_DAMPING,
    THRESHOLDS,
    MIN_CONFIDENCE_TO_FLAG
};
