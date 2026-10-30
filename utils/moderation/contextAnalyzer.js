/**
 * Análise de contexto.
 *
 * É aqui que moram os falsos positivos. Uma palavra no dicionário não é
 * ofensa; o que faz a diferença é a vizinhança:
 *
 *   "você é um idiota"        → alvo + verbo copular  → ofensa
 *   "ele foi chamado de idiota" → citação              → neutro
 *   "isso é uma merda do sistema" → reclamação        → neutro
 *   "tô sem pedo"             → dinheiro              → neutro
 *   "seu pedo é um lixo"      → alvo + merda          → ofensa
 *
 * Cada analisador devolve evidência com peso, nunca decisão.
 */

const { rules } = require('../../data/offensiveWords');
const { LAUGH_EMOJI } = require('./normalizer');

const { REASON } = require('./constants');

/** Escapa um termo para uso dentro de RegExp montado por concatenação. */
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Precompila: são listas fixas, não vale reprocessar por mensagem.
// As 7 primeiras entradas de quote são os próprios sinais de citação.
//
// B16: pontuação e palavra são coisas diferentes. A aspa é sinal genuíno de
// citação — está em volta do termo, é o que faz o termo ser citado. A
// palavra ("citou", "mandou", "disse que") é só um verbo solto: "citou seu
// cuzao" é uma provocação escrita com verbo de citação, não uma citação.
// Por isso a pontuação vale sempre e a palavra exige o mesmo sinal de
// documentação de `technical`/`lexical`.
const QUOTE_SIGNALS = rules.contextSuppressors.quote.slice(0, 7);
const QUOTE_WORDS = rules.contextSuppressors.quote.slice(7);
const QUOTE_PUNCT_RE = new RegExp(QUOTE_SIGNALS.map(escapeRe).join('|'), 'gi');
const QUOTE_WORDS_RE = new RegExp(
    '\\b(' + QUOTE_WORDS.map(escapeRe).join('|') + ')\\b', 'iu');
const TECH_RE = new RegExp('\\b(' + rules.contextSuppressors.technical.map(escapeRe).join('|') + ')\\b', 'i');
const HUMOR_RE = new RegExp('(' + rules.contextSuppressors.humor.map(escapeRe).join('|') + ')', 'i');

// BUG 6: em português BR, "fds", "prr", "tnc", "vsf", "cu", "caralho" são
// EXCLAMAÇÃO na maioria das vezes. Medido: "fds que coisa" = medium 0.48,
// "tnc mano" = high 0.59, "vsf mano" = high 0.75, "caralho mano" = high
// 0.65. O único sinal que hoje separa exclamação de insulto é a risada
// ("fds kkkk" passa, "fds que coisa" não), o que faz o comportamento
// parecer aleatório.
//
// A diferença é o que vem DEPOIS: "seu fdp" é insulto dirigido; "fds que
// coisa" é explosão. Sem sinal de alvo nem deagnesco, o termo curto é
// exclamação pura e não pode punir.
const SINAL_ALVO_FORTE_RE = /\b(vc|voce|voces|vcs|tu|ele|ela|eles|elas|aquele|aquela|fulano|mim|contigo)\b/iu;
const RP_RE = new RegExp('\\b(' + rules.contextSuppressors.roleplay.map(escapeRe).join('|') + ')\\b', 'iu');
const MARKER_RE = new RegExp('(^|[^\\p{L}\\p{N}])(' + rules.aggressionMarkers.map(escapeRe).join('|') + ')([^\\p{L}\\p{N}]|$)', 'iu');

// Alvo de segunda pessoa / terceira dirigida a alguém
// BUG 7: 'mim' e 'contigo' entraram porque a camada de ameaça sem objeto
// decide por alvo de pessoa, e 'some de mim' / 'fica comigo' têm alvo sem
// pronome possessivo.
const TARGET_RE = /\b(vc|voce|voces|vcs|tu|seu|seua|seus|suas|ele|ela|eles|elas|aquele|aquela|aqueles|aquelas|fulano|otario|otaria|idiota|burro|mentira|inutil|fraco|mim|contigo|conosco)\b/iu;

// BUG 3: "seu"/"sua" estão em aggressionMarkers E em TARGET_RE, e é essa
// duplicidade que produz o falso positivo.
//
// Medido: "seu chato" = high 0.59, mas "seu update foi ruim" = medium 0.42
// e "sua latency ta horrivel" = medium 0.44. A fronteira corta no meio da
// zona de falso positivo: a mesma palavra ("seu") é neutra em uma frase e
// agressiva na outra, e o filtro não olha a diferença.
//
// A diferença real é o OBJETO: "seu chato" tem posse de pessoa, "seu
// update" tem posse de coisa. Este é o sinal que faltava — e é a opção 3.B
// do plano (exigir que o marcador NÃO seja seguido de contexto de
// sistema), com COMPLAINT_RE ampliado para cobrir os termos que de fato
// aparecem depois de "seu" numa reclamação.
const POSSESSIVO_PESSOA_RE = /\b(seu|seus|seua|suas)\b\s+(?!o\s|os\s|a\s|as\s|do\s|da\s|nos\s|na\s|nosso|essa|esse|aquele|esta|este|bot|sistema|server|servidor|jogo|canal|comando|update|patch|lag|erro|bug|aplicativo|app|site|conta|perfil|equipe|grupo|rota|script|processo|arquivo|pasta|funcao|classe|variavel|banco|tabela|latencia|ping|maquina|servico|instancia|pagina|node|npm|moderacao|filtro|lista|termo)\w*/iu;
// Verbo copular: "você É um idiota"
const COPULA_RE = /\b(e|eh|sou|foi|ser|fica|ficou|parece|vira|virou)\b/iu;
// Reclamação sobre sistema/jogo (não é ataque a pessoa)
const COMPLAINT_RE = /\b(sistema|server|servidor|jogo|bot|canal|site|app|comando|evento|rolagem|rule|regra|lag|bug|erro|update|patch|processo|arquivo|pasta|linha|script|funcao|classe|variavel|banco|tabela|latencia|latency|ping|maquina|node|npm|servico|instancia|pagina|cpu|gpu|ram|timeout|downtime|deploy|build|commit|branch|repo|log|logs|moderacao|filtro|lista|termo|plugin|config|configuracao)\b/iu;
// Dinheiro / economia
const MONEY_RE = /\b(dinheiro|grana|real|reais|grana|troco|saldo|conta|pagar|preco|preço|carro|veiculo|propriedade|casa|imovel|imóvel|comprar|vender|loja|banco)\b/iu;
// Evidência de que o termo está sendo tratado como palavra
const LEXICAL_RE = /\b(palavra|termo|string|texto|significado|significa|chama-se|escreve-se|ortografia|gr[aá]fica)\b/iu;

/**
 * B16 — SINAL DE DOCUMENTAÇÃO.
 *
 * O que é
 * `technical` e `lexical` são listas de SUBSTANTIVOS ("log", "termo",
 * "palavra", "exemplo"). A supressão era aplicada globalmente: bastava o
 * termo aparecer na mensagem para derrubar a confiança para 0.45 e desligar
 * o filtro INTEIRO. Medido: 36 supressores x 3 insultos x 3 posições =
 * 108/108 combinações não detectadas. "log seu cuzao" saía como severity
 * `none` — a mesma frase sem o "log" saía `high`.
 *
 * Por que a correção original não resolvia
 * A auditoria sugeria remover as entradas de <= 4 letras. Medido: depois
 * disso, 31 dos 36 supressores continuavam matando o filtro (`exemplo`,
 * `palavra`, `termo`, `filtro`, `ofensivo`...). O problema não é o
 * comprimento da palavra, é não exigir NADA além da presença dela.
 *
 * A correção
 * Um termo técnico só vale como supressor se a mensagem estiver de fato
 * falando DA PALAVRA — e isso tem forma gramatical: um interrogativo ou um
 * verbo definicional. Não basta a palavra aparecer.
 *
 * Por que NÃO basta um sinal de interrogação
 * Medido: aceitar "?" como frame deixa `seu cuzao?` passar. Trocava-se um
 * bypass de uma palavra por um bypass de uma pontuação. O frame precisa ser
 * uma PALAVRA, porque a pergunta tem de ser construída de verdade:
 * "qual o termo de log?" é documentação; "seu cuzao?" é um insulto com
 * ponto de interrogação.
 *
 * `dicionario` NÃO entra aqui de propósito: é substantivo técnico, não
 * sinal de pergunta, e "dicionario seu cuzao" voltaria a ser bypass.
 *
 * Note que aspas, roleplay e risada NÃO passaram por este gate: são
 * supressores legítimos de tom, e uma citação é uma citação porque
 * tem aspas em volta, não porque tem "qual" na frase.
 */
const DOC_RE = new RegExp(
    '\\b(qual|quais|oq|como|signific\\w*|chama-se|chamase|escreve-se|ortografia|gr[aá]fic\\w*|' +
    'defini\\w*|etimolog\\w*|quer\\s+dizer)\\b', 'iu');


/**
 * @returns {{
 *   hasTarget: boolean, hasCopula: boolean, hasComplaint: boolean,
 *   hasMoney: boolean, isQuoted: boolean, isTechnical: boolean,
 *   isHumor: boolean, isLaughter: boolean, isLexical: boolean,
 *   hasAggressionMarker: boolean,
 *   signals: Array<{signal:string, weight:number}>
 * }}
 */
function analyze(original, normalized) {
    const haystack = String(normalized || original || '');
    // Aspas e sinais de citação SUMEM na normalização, então precisam ser
    // testados no texto original. O resto é testado na forma normalizada.
    const raw = String(original || '').toLowerCase();
    const signals = [];
    const add = (signal, weight) => signals.push({ signal, weight });

    // B16: o termo técnico/lexical e o verbo de citação só contam como
    // supressor se a mensagem trouxer sinal de documentação junto. Sem isso,
    // uma palavra solta de 3 letras desligava o filtro inteiro (ver DOC_RE).
    const isDocFrame = DOC_RE.test(haystack) || DOC_RE.test(raw);

    QUOTE_PUNCT_RE.lastIndex = 0;
    const isQuoted = QUOTE_PUNCT_RE.test(raw) || QUOTE_PUNCT_RE.test(haystack)
        || (isDocFrame && QUOTE_WORDS_RE.test(haystack));
    const isTechnical = TECH_RE.test(haystack) && isDocFrame;
    const isHumor = HUMOR_RE.test(haystack);
    const isLaughter = HUMOR_RE.test(haystack) || LAUGH_EMOJI.test(String(original || '')) || /k{3,}/i.test(String(original || ''));
    const isLexical = LEXICAL_RE.test(haystack) && isDocFrame;
    const hasTarget = TARGET_RE.test(haystack);
    const hasCopula = COPULA_RE.test(haystack);
    const hasComplaint = COMPLAINT_RE.test(haystack);
    const hasMoney = MONEY_RE.test(haystack);
    const isRoleplay = RP_RE.test(haystack);
    MARKER_RE.lastIndex = 0;
    // BUG 3: marcador de agressão que NÃO é marcador.
    // "seu update foi ruim" tem "seu" em aggressionMarkers, e é por isso que
    // vira medium 0.42 e fala. Mas o "seu" ali é POSSE DE COISA, não
    // tratamento de pessoa. Medido: "seu chato" (high 0.59) é a forma
    // agressiva; "seu update foi ruim" (medium 0.42) é a forma neutra.
    // A regra é o objeto: posse de pessoa vs posse de sistema.
    const temMarcadorCru = MARKER_RE.test(haystack);
    const temContextoDeSistema = COMPLAINT_RE.test(haystack);
    const temPossessivo = /\b(seu|seus|seua|suas)\b/i.test(haystack);
    const temPessoaForte = SINAL_ALVO_FORTE_RE.test(haystack);
    // O marcador de "seu/sua" só é tratamento de pessoa quando o objeto é
    // pessoa. Com objeto de sistema e sem outro alvo, é posse de coisa.
    //
    // Não se usa lista de substantivos para decidir isso: a primeira
    // versão tinha uma (POSSESSIVO_PESSOA_RE) e ela quebrou em "sua latency"
    // — a lista tinha "latencia" e o texto dizia "latency", que é o termo
    // que as pessoas usam. Lista de substantivo em português é期間 infinita.
    // O par (reclamação de sistema + sem alvo de pessoa) cobre o caso sem
    // precisar saber o nome do objeto.
    const hasAggressionMarker = temMarcadorCru
        ? !(temPossessivo && !temPessoaForte && temContextoDeSistema)
        : false;
    const ehExclamacao = !SINAL_ALVO_FORTE_RE.test(haystack) && !hasTarget;

    if (isQuoted) add('quoted', -0.35);
    if (isTechnical) add('technical', -0.30);
    if (isLexical) add('lexical', -0.30);
    if (isRoleplay) add('roleplay', -0.35);
    if (isLaughter) add('laughter', -0.30);
    else if (isHumor) add('humor', -0.20);
    if (hasComplaint) add('complaint', -0.25);
    if (hasMoney) add('money_context', -0.30);
    if (hasTarget) add('has_target', +0.15);
    if (hasCopula) add('copula', +0.08);
    if (hasAggressionMarker) add('aggression_marker', +0.20);
    // BUG 6: `isExclamation` é exposto como booleano e NÃO entra como peso.
    // Primeira tentativa foi um peso -0.18 aqui, e ela media errado: o
    // peso não sabe se o match veio de token exato ou de fuzzy, então
    // "idiotoa" (erro de digitação de "idiota", casado por fuzzy) caía de
    // medium 0.45 para low 0.27 e passava. A decisão de exclamação é do
    // classificador, que tem o matchType na mão — um mecanismo só.


    return {
        hasTarget, hasCopula, hasComplaint, hasMoney,
        isQuoted, isTechnical, isHumor, isLaughter, isLexical, isRoleplay,
        isDocFrame,
        hasAggressionMarker,
        isExclamation: ehExclamacao,
        signals
    };
}

/**
 * Motivo mais forte que explica uma supressão, para o campo `reasons`.
 */
function suppressionReason(ctx) {
    if (ctx.isQuoted) return REASON.CONTEXT_SUPPRESSED;
    if (ctx.isLaughter) return REASON.LAUGHTER;
    if (ctx.isRoleplay) return REASON.ROLEPLAY;
    if (ctx.isTechnical) return REASON.CONTEXT_SUPPRESSED;
    return null;
}

module.exports = { analyze, suppressionReason };
