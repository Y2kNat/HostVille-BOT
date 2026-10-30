/**
 * Mineração de lacunas da Knowledge Base.
 *
 * Lê as conversas de data/chatMemory.json (tickets E chat geral), agrupa as
 * perguntas que se repetem e que a KB NÃO responde, e propõe um documento
 * novo para a staff aprovar no canal de revisão. Nada é gravado na KB sem
 * aprovação: o bot só escreve o arquivo depois do ✅.
 *
 * O filtro é a parte importante. Uma proposta ruins é pior do que nenhuma,
 * porque entra na KB como se fosse verdade. Por isso, para o que é
 * descartado de propósito:
 *   - resposta que não foi respondida de verdade (chamada para staff);
 *   - pergunta sem conteúdo (curta, só emoji, "bom dia", "teste");
 *   - dado pessoal (CPF, telefone, e-mail, senha, número de casa);
 *   - conversa em que o bot claramente errou (aí a proposta seria o erro);
 *   - o que a KB já responde (não é lacuna, é o caso normal).
 */
const config = require('../config');
const { logInfo, logWarn, logError, logSuccess } = require('../utils/logger');
const { sendLog } = require('../utils/realtime');

const ChatMemory = require('./ChatMemory');

// Não é pergunta de KB: cumprimento, teste, comando solto, emoji.
const LIXO = /^(oi|ol[áa]|opa|eai|bom dia|boa noite|bom tarde|tudo bem|teste|testando|ping|vlw|obg|obrigad\w+|hj|help|menu|\?|!|\.+|:[\s\w-]*:)$/i;
const SO_EMOJI = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u;
const MUITO_CURTA = (t) => t.replace(/[^\p{L}\p{N}]/gu, '').length < 12;
const SO_COMANDO = /^['`;$][a-z0-9_]+/i;

// Dado pessoal: nunca entra na KB, nem como exemplo.
const PII = [
    /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/,                       // CPF
    /\b\(?\d{2}\)?\s?9\d{4}-?\d{4}\b/,                       // celular
    /[\w.+-]+@[\w-]+\.[\w.]{2,}/,                           // e-mail
    /\b(?:senha|password|passwd|token|api[ _-]?key|secret|credencial)\b/i,
    /\b\d{5}-?\d{3}\b/,                                      // CEP
];

// Resposta que significa "a IA nao soube": nunca vira proposta.
const NAO_RESPOSTEU = /\b(vou chamar (um |a )?(staff|moderador|suporte)|não (tenho|sei) essa informação|não fui able|nao tenho essa informacao|chamar um staff)\b/i;

const botUser = () => (global.client && global.client.user && global.client.user.username) || 'HostBot';

/** Uma "pergunta" é a mensagem de um usuário que veio seguida de resposta do bot. */
function extrairPerguntasRespostas(memory) {
    const pares = [];
    for (const [channelId, canal] of Object.entries(memory || {})) {
        const msgs = (canal && canal.messages) || [];
        for (let i = 0; i < msgs.length - 1; i++) {
            const ask = msgs[i];
            const ans = msgs[i + 1];
            if (!ask || !ans) continue;
            if (ask.user === botUser() || ans.user !== botUser()) continue; // precisa ser pergunta -> resposta do bot
            pares.push({
                channelId,
                pergunta: String(ask.content || '').trim(),
                resposta: String(ans.content || '').trim(),
                timestamp: ask.timestamp || 0,
            });
        }
    }
    return pares;
}

/** Chave de agrupamento: o suficiente para juntar "como apago meu carro" com "como deletar veiculo". */
function chaveAgrupamento(pergunta) {
    const { normalize } = require('../ai/knowledge-loader');
    return normalize(pergunta)
        .split(/[^a-z0-9]+/)
        .filter(w => w.length >= 4)
        .sort()
        .slice(0, 6)
        .join(' ');
}

function eLixo(pergunta) {
    const t = String(pergunta || '').trim();
    if (!t) return 'vazia';
    if (LIXO.test(t)) return 'sem conteúdo (saudação/teste)';
    if (SO_EMOJI.test(t)) return 'só emoji';
    if (MUITO_CURTA(t)) return 'curta demais para virar documento';
    if (SO_COMANDO.test(t)) return 'é só um comando, não uma pergunta';
    if (t.length > 200) return 'longa demais';
    for (const re of PII) if (re.test(t)) return 'contém dado pessoal';
    if (NAO_RESPOSTEU.test(t)) return 'a IA não respondeu';
    return null;
}

const REPETICAO = new RegExp(
    ['como', 'onde', 'quando', 'quanto', 'quais', 'quem', 'porque', 'qual'].join('|'), 'i');


/**
 * Procura lacunas e devolve as propostas (sem postar nada).
 * @returns {Array<{chave, perguntas:Array, freq:number, exemplos:Array}>}
 */
function minerar({ minRepetitions = config.AUTO_KB.MIN_REPEATS } = {}) {
    const { normalize, findRelevantDocs } = require('../ai/knowledge-loader');
    const memory = ChatMemory.load();
    const pares = extrairPerguntasRespostas(memory);

    const grupos = new Map();
    const descartes = {};

    for (const par of pares) {
        const motivo = eLixo(par.pergunta);
        if (motivo) { descartes[motivo] = (descartes[motivo] || 0) + 1; continue; }

        // a resposta precisa ser uma resposta de verdade, senão a "lacuna" é
        // só a IA admitindo que não sabe
        if (NAO_RESPOSTEU.test(par.resposta)) { descartes['IA não respondeu'] = (descartes['IA não respondeu'] || 0) + 1; continue; }
        if (!REPETICAO.test(par.pergunta)) { descartes['não é pergunta de factual'] = (descartes['não é pergunta de factual'] || 0) + 1; continue; }

        // já é coberto pela KB? então não é lacuna
        const docs = findRelevantDocs(par.pergunta, 3);
        const { cobreConhecimento } = require('../ai/knowledge-loader');
        if (cobreConhecimento(par.pergunta, docs)) { descartes['KB já cobre'] = (descartes['KB já cobre'] || 0) + 1; continue; }

        const chave = chaveAgrupamento(par.pergunta);
        if (!chave) continue;
        if (!grupos.has(chave)) grupos.set(chave, { chave, perguntas: [], exemplos: [], timestamps: [] });
        const g = grupos.get(chave);
        g.perguntas.push(par.pergunta);
        g.exemplos.push({ pergunta: par.pergunta, resposta: par.resposta.slice(0, 400), channelId: par.channelId, timestamp: par.timestamp });
        g.timestamps.push(par.timestamp);
    }

    const propostas = [...grupos.values()]
        .map(g => ({
            ...g,
            freq: g.perguntas.length,
            exemplos: g.exemplos.slice(0, 3),
        }))
        .filter(g => g.freq >= minRepetitions)
        .sort((a, b) => b.freq - a.freq);

    return { propostas, descartes, totalPares: pares.length };
}

module.exports = { minerar, extrairPerguntasRespostas, chaveAgrupamento, eLixo, PII, NAO_RESPOSTEU, REPETICAO };
