const ChatMemory = require('../managers/ChatMemory');
const kb = require('../ai/knowledge-loader');

const FOLLOWUP_START = /^(e\s|ent[aã]o\b|isso\b|esse\b|essa\b|aquele\b|aquela\b|eles\b|elas\b|deles\b|delas\b|o\s|os\s|a\s|as\s|um\s|uma\s|de\s|do\s|da\s|dos\s|das\s|para\s|qual\s|quais\b|tem\b|pode\b|posso\b|vou\b|quero\b|se\s|mais\b|tamb[eé]m\b)/i;

function isFollowUp(message) {
    const t = (message || '').trim();
    if (!t || t.length > 70) return false;
    const content = t.split(/\s+/).filter(w => w.replace(/[^\p{L}\p{N}]/gu, '').length >= 3);
    return FOLLOWUP_START.test(t) || content.length <= 2;
}

const INTENTS = [
    { name: 'deletar', re: /\b(apagar|apaga|apagou|apaguei|remover|remove|removi|remova|remover\s?se|retirar|retirada|tirar|tira|deletar|deleta|deletou|deletei|deleto|excluir|exclui|exclusao)\b/i },
    { name: 'registrar', re: /\b(registro|registrar|registrei|cadastro|cadastrar|criei|criar|criou|adiciona\w*|incluir)\b/i },
    { name: 'consultar', re: /\b(ver|ve|vejo|veja|listar|lista\w*|mostrar|mostro|consultar|buscar|busco|procurar|achar)\b/i },
    { name: 'bloquear', re: /\b(bloqueio|bloquear|bloqueia\w*|bloqueado|desbloque\w*)\b/i },
    { name: 'limite', re: /\b(limite|limites|teto|preco|maximo|quanto|quantos|quantas|valor)\b/i },
    { name: 'link', re: /\b(link|acesso|sessao|sessoes)\b/i }
];

const INTENT_PHRASE = {
    deletar: 'a pergunta é sobre APAGAR/REMOVER um registro. Responda o comando correspondente.',
    registrar: 'a pergunta é sobre COMO REGISTRAR. Responda o registro: canal, botão e campos.',
    consultar: 'a pergunta é sobre VER/CONSULTAR algo já registrado. Responda o comando de consulta.',
    bloquear: 'a pergunta é sobre BLOQUEAR ou DESBLOQUEAR. Responda o comando correspondente.',
    limite: 'a pergunta é sobre LIMITES, tetos ou quantidades. Responda com os valores da tabela.',
    link: 'a pergunta é sobre o LINK de acesso da sessão. Responda como conseguir o link.'
};

function detectIntent(text) {
    const t = String(text || '');
    for (const i of INTENTS) {
        if (i.re.test(t)) return i.name;
    }
    return null;
}

// Só a última pergunta do usuário alimenta a busca. Usar vários turnos
// antigos trazia docs de outros assuntos junto e o modelo citava o canal errado.
function lastUserTurn(channelId) {
    const msgs = ChatMemory.load()[channelId]?.messages || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].user !== 'HostBot') return msgs[i].content.substring(0, 200);
    }
    return '';
}

function lastUserQuestion(channelId) {
    const msgs = ChatMemory.load()[channelId]?.messages || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].user !== 'HostBot') return msgs[i].content;
    }
    return '';
}

const CONNECTIVE = /^(e|entao|entao|enta|vou|quero|queria|posso|me\s+diz|me\s+fala)\s+/i;

function resolveQuestion(message, inheritedIntent) {
    if (!inheritedIntent) return message;
    const body = String(message || '').trim().replace(CONNECTIVE, '').replace(/[?!.]+$/, '');
    if (!body) return message;
    if (inheritedIntent === 'deletar') return 'Como apago ' + body + '?';
    if (inheritedIntent === 'registrar') return 'Como registro ' + body + '?';
    if (inheritedIntent === 'consultar') return 'Como vejo ' + body + '?';
    if (inheritedIntent === 'bloquear') return 'Como bloqueio ' + body + '?';
    if (inheritedIntent === 'limite') return 'Quais sao os limites de ' + body + '?';
    return message;
}

const CANON = {
    deletar: { re: /\b(apagar|apaga|apaguei|apagou|remover|remove|removi|remova|remover\s?se|retirar|retirada|tirar|tira|excluir|exclui|deletar|deleta|deletou|deleto)\b/i, to: 'deletar' },
    consultar: { re: /\b(listar|lista|listo|buscar|busco|procurar|mostrar|mostro|consultar|consulto|ver|ve|vejo|veja)\b/i, to: 'ver' },
    registrar: { re: /\b(cadastrar|cadastro|criar|criei|criou|criacao)\b/i, to: 'registrar' },
    bloquear: { re: /\b(bloquear|bloqueio|bloqueia|bloqueado)\b/i, to: 'bloquear' }
};

function canonicalQuestion(message, intent) {
    const c = intent && CANON[intent];
    if (!c) return message;
    return message.replace(c.re, c.to);
}

function buildTicketContext(channelId, message, userId) {
    // Rate limit de ticket: o mais folgado dos três escopos, porque é
    // atendimento. Se o usuário estourar, recebe o aviso e o turno não
    // consome request.
    if (userId) {
        const espera = require('../managers/RateLimiter').gate('ticket', userId);
        if (espera) return { rateLimited: true, retryAfter: espera, context: '', docs: [], history: '', intentHint: '', resolvedQuestion: message };
    }
    const followUp = isFollowUp(message);
    const palavras = String(message || '').split(/\s+/).filter(w => w.replace(/[^\p{L}\p{N}]/gu, '').length >= 3).length;
    // Histórico só entra quando a pergunta é indireta ("e meus carros?"). Em pergunta
    // completa ele só confunde o modelo e faz ele repetir o fallback.
    const useHistory = followUp || palavras <= 3;
    const history = useHistory ? ChatMemory.getHistory(channelId, 6) : '';

    const previous = followUp ? lastUserTurn(channelId) : '';
    const { context, docs } = kb.buildContext(message, undefined, previous);

    const ownIntent = detectIntent(message);
    const inherited = !ownIntent && followUp ? detectIntent(lastUserQuestion(channelId)) : null;
    const intentHint = inherited ? `INTENÇÃO RESOLVIDA DESTA PERGUNTA (use o histórico para isso): ${INTENT_PHRASE[inherited]}` : '';

    const resolved = inherited ? resolveQuestion(message, inherited) : message;
    const resolvedQuestion = canonicalQuestion(kb.deslugar(resolved), ownIntent || inherited);

    return { history, docs, context, followUp, intent: ownIntent || inherited, intentHint, resolvedQuestion };
}

function rememberTurn(channelId, userName, question, answer) {
    ChatMemory.remember(channelId, userName, question);
    if (answer) ChatMemory.remember(channelId, 'HostBot', answer);
}

/**
 * Guard de injeção para tickets. Async porque o modelo é remoto.
 * Fail-open: se a IA cair, retorna liberado e o ticket segue normal.
 * @returns {Promise<{blocked:boolean, label?:string}>}
 */
async function checkInjection(message) {
    try {
        return await require('../managers/InjectionGuard').check(message);
    } catch (e) {
        return { blocked: false, checked: false };
    }
}

module.exports = { buildTicketContext, rememberTurn, isFollowUp, detectIntent, checkInjection };