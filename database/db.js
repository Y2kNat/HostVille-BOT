const mongoose = require('./mongo');
const Memory = require('../models/Memory');
const Pending = require('../models/Pending');

// Avisos (warnings) NÃO ficam aqui. Foram movidos para
// data/warnings.json — ver utils/warnStore.js. Motivo: a gravação
// dependia de rede, e perder aviso é perder punição.

/**
 * Escapa a guildId para uso dentro de uma RegExp.
 *
 * `getConnection`/`saveConnection` filhavam por `answer` (o JSON inteiro) e
 * montavam a regex com o valor cru. ID de guild é numérico e não tem
 * metacaractere, mas o mesmo helper agora também protege buscas que podem
 * receber outros valores, e um `undefined` no meio da regex transforma a
 * consulta em "casa com tudo".
 */
function escaparRegex(valor) {
    return String(valor ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================
// PALAVRAS BANIDAS
// ============================================
// ERRO C (corrigido): as palavras eram lidas e gravadas com guildId 'global',
// sem filtro nenhum. Um admin de qualquer servidor bania palavra para TODOS os
// servidores do bot. Agora o cadastro é POR SERVIDOR.
//
// A leitura é a UNIÃO do escopo do servidor com o escopo global (legacy),
// para a lista que já existe em produção continuar valendo em todo lugar
// enquanto ninguém a mexer. `removeCustomWord` apaga nos dois escopos, porque
// "liberar palavra" tem que significar liberada de verdade.
async function getCustomWords(guildId) {
    const filtro = guildId
        ? { category: 'config', question: 'PALAVRA_BANIDA', guildId: { $in: [String(guildId), 'global'] } }
        : { category: 'config', question: 'PALAVRA_BANIDA' };
    const docs = await Memory.find(filtro).lean();
    return docs.map(d => d.answer);
}

async function addCustomWord(guildId, word) {
    const escopo = guildId ? String(guildId) : 'global';
    const exists = await Memory.findOne({ category: 'config', question: 'PALAVRA_BANIDA', answer: word, guildId: escopo });
    if (!exists) {
        await Memory.create({
            user: 'SISTEMA', userId: 'SISTEMA',
            question: 'PALAVRA_BANIDA', answer: word,
            understood: true, category: 'config', guildId: escopo
        });
        return true;
    }
    return false;
}

async function removeCustomWord(guildId, word) {
    const escopo = guildId ? String(guildId) : 'global';
    await Memory.deleteMany({ category: 'config', question: 'PALAVRA_BANIDA', answer: word, guildId: escopo });
    // O escopo global é o que a versão antiga gravava: sem esta linha a
    // palavra continuaria barrada no servidor onde ela foi criada.
    await Memory.deleteMany({ category: 'config', question: 'PALAVRA_BANIDA', answer: word, guildId: 'global' });
}

// ============================================
// MONITORING
// ============================================
// ERRO F (corrigido): o `ready.js` fazia `setMonitoringStatus(guild.id, true)`
// para todo servidor a CADA boot. Quem desligasse o monitoramento — pelo
// `!MonitorOff` na DM ou pelo painel — via de volta um restart.
//
// Agora o estado mora na chave `monitoramento` do FeatureRegistry, que é a
// mesma que o painel desenha: uma fonte só. O doc MONITORING antigo continua
// sendo lido como herança, para não desligar a moderação de quem já tinha
// desligado antes desta mudança.
async function getMonitoringStatus(guildId) {
    try {
        const Features = require('../managers/FeatureRegistry');
        if (Features.ligadoSync) {
            return await Features.ligado('monitoramento', String(guildId));
        }
    } catch (e) { /* registry indisponível: cai no doc legado */ }

    const doc = await Memory.findOne({ category: 'config', question: 'MONITORING', answer: new RegExp(`^${escaparRegex(guildId)}:`) }).lean();
    return doc ? doc.answer.split(': ')[1] === 'true' : true;
}

async function setMonitoringStatus(guildId, status) {
    try {
        const Features = require('../managers/FeatureRegistry');
        if (Features.set) {
            await Features.set('monitoramento', String(guildId), !!status, 'sistema (setMonitoringStatus)');
            return;
        }
    } catch (e) { /* registry indisponível: grava o doc legado */ }

    await Memory.deleteMany({ category: 'config', question: 'MONITORING', answer: new RegExp(`^${escaparRegex(guildId)}:`) });
    await Memory.create({
        user: 'SISTEMA', userId: 'SISTEMA',
        question: 'MONITORING', answer: `${guildId}: ${status}`,
        understood: true, category: 'config', guildId
    });
}

// ============================================
// LINK SETTINGS
// ============================================
// ERRO C (corrigido): gravado com guildId 'global' e lido sem filtro nenhum.
// `/linksettings` é admin-gated, mas de UM servidor — e mudava o filtro de
// link de todos os servidores do bot.
//
// Mesma estratégia das palavras: o escopo do servidor sobrescreve o global,
// e o global (legacy) continua valendo como base onde o servidor nunca
// gravou nada. Ler o Effective() é o que o LinkManager chama.
const LINK_DEFAULT = { deleteInvites: true, allowedDomains: [] };

function mesclarLink(base, sobre) {
    if (!sobre || typeof sobre !== 'object') return { ...LINK_DEFAULT };
    const dominios = Array.isArray(sobre.allowedDomains) ? sobre.allowedDomains : (base?.allowedDomains ?? []);
    return {
        deleteInvites: sobre.deleteInvites !== undefined ? !!sobre.deleteInvites : !!(base?.deleteInvites ?? true),
        allowedDomains: dominios
    };
}

async function getLinkSettings(guildId) {
    const global = await Memory.findOne({ category: 'config', question: 'LINK_SETTINGS', guildId: 'global' }).lean();
    let base = LINK_DEFAULT;
    if (global) {
        try { base = mesclarLink(base, JSON.parse(global.answer)); } catch (e) { /* doc corrompido: fica o default */ }
    }
    if (!guildId) return base;

    const local = await Memory.findOne({ category: 'config', question: 'LINK_SETTINGS', guildId: String(guildId) }).lean();
    if (!local) return base;
    try { return mesclarLink(base, JSON.parse(local.answer)); } catch (e) { return base; }
}

async function setLinkSettings(guildId, settings) {
    const escopo = guildId ? String(guildId) : 'global';
    const base = escopo === 'global' ? LINK_DEFAULT : await getLinkSettings(escopo);
    const merged = mesclarLink(base, settings);
    await Memory.deleteMany({ category: 'config', question: 'LINK_SETTINGS', guildId: escopo });
    await Memory.create({
        user: 'SISTEMA', userId: 'SISTEMA',
        question: 'LINK_SETTINGS', answer: JSON.stringify(merged),
        understood: true, category: 'config', guildId: escopo
    });
    return merged;
}

// ============================================
// MODERAÇÃO POR CANAL
// Guardar o estado desligado por canal evita uma consulta ao banco por
// mensagem. Guard ID -> boolean (true = filtro desligado).
// ============================================
async function getChannelModeration(guildId) {
    const doc = await Memory.findOne({ category: 'config', question: 'MODERATION_CHANNEL', guildId: String(guildId) }).lean();
    if (!doc) return {};
    try { return JSON.parse(doc.answer) || {}; } catch (e) { return {}; }
}

async function setChannelModeration(guildId, channelId, disabled) {
    const map = await getChannelModeration(guildId);
    if (disabled) map[String(channelId)] = true;
    else delete map[String(channelId)];
    await Memory.deleteMany({ category: 'config', question: 'MODERATION_CHANNEL', guildId: String(guildId) });
    await Memory.create({
        user: 'SISTEMA', userId: 'SISTEMA',
        question: 'MODERATION_CHANNEL', answer: JSON.stringify(map),
        understood: true, category: 'config', guildId: String(guildId)
    });
    return map;
}

// ============================================
// IA POR TICKET
// Permite desligar a resposta automática num ticket especifico, sem
// desligar a IA do servidor inteiro. Guard: canal -> true (desligado).
// Ticket e efemero, mas o registro precisa sobreviver a restart do bot.
// ============================================
async function getTicketAi(guildId) {
    const doc = await Memory.findOne({ category: 'config', question: 'TICKET_AI', guildId: String(guildId) }).lean();
    if (!doc) return {};
    try { return JSON.parse(doc.answer) || {}; } catch (e) { return {}; }
}

async function setTicketAi(guildId, channelId, disabled) {
    const map = await getTicketAi(guildId);
    if (disabled) map[String(channelId)] = true;
    else delete map[String(channelId)];
    await Memory.deleteMany({ category: 'config', question: 'TICKET_AI', guildId: String(guildId) });
    await Memory.create({
        user: 'SISTEMA', userId: 'SISTEMA',
        question: 'TICKET_AI', answer: JSON.stringify(map),
        understood: true, category: 'config', guildId: String(guildId)
    });
    return map;
}

// ============================================
// TRANSCRIPT (geracao de PDF ao fechar/deletar ticket)
// ============================================
async function getTranscriptSettings(guildId) {
    const doc = await Memory.findOne({ category: 'config', question: 'TRANSCRIPT', guildId: String(guildId) }).lean();
    if (!doc) return { enabled: true };
    try { return { enabled: true, ...(JSON.parse(doc.answer) || {}) }; } catch (e) { return { enabled: true }; }
}

async function setTranscriptEnabled(guildId, enabled) {
    await Memory.deleteMany({ category: 'config', question: 'TRANSCRIPT', guildId: String(guildId) });
    await Memory.create({
        user: 'SISTEMA', userId: 'SISTEMA',
        question: 'TRANSCRIPT', answer: JSON.stringify({ enabled: !!enabled }),
        understood: true, category: 'config', guildId: String(guildId)
    });
    return { enabled: !!enabled };
}

async function getTranscriptAiStatus(guildId) {
    const doc = await Memory.findOne({ category: 'config', question: 'TRANSCRIPT_AI', guildId: String(guildId) }).lean();
    if (!doc) return true;
    try { return JSON.parse(doc.answer) !== false; } catch (e) { return true; }
}

async function setTranscriptAi(guildId, enabled) {
    await Memory.deleteMany({ category: 'config', question: 'TRANSCRIPT_AI', guildId: String(guildId) });
    await Memory.create({
        user: 'SISTEMA', userId: 'SISTEMA',
        question: 'TRANSCRIPT_AI', answer: JSON.stringify(!!enabled),
        understood: true, category: 'config', guildId: String(guildId)
    });
    return !!enabled;
}

// ============================================
// FEATURES (chaves de ligar/desligar do /adm)
// ============================================
// Um doc por escopo: guildId = id do servidor, ou 'global' para o que é da
// rede inteira. O answer é um objeto plano { chave: booleano } — só o que
// DIVERGE do default do FeatureRegistry entra, então o doc continua pequeno
// mesmo com vinte chaves.
async function getFeatures(guildId) {
    const escopo = guildId ? String(guildId) : 'global';
    const doc = await Memory.findOne({ category: 'config', question: 'FEATURES', guildId: escopo }).lean();
    if (!doc) return {};
    try {
        const v = JSON.parse(doc.answer);
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
}

async function setFeatures(guildId, mapa) {
    const escopo = guildId ? String(guildId) : 'global';
    await Memory.deleteMany({ category: 'config', question: 'FEATURES', guildId: escopo });
    if (!mapa || typeof mapa !== 'object' || !Object.keys(mapa).length) return {};
    await Memory.create({
        user: 'SISTEMA', userId: 'SISTEMA',
        question: 'FEATURES', answer: JSON.stringify(mapa),
        understood: true, category: 'config', guildId: escopo
    });
    return mapa;
}

// ============================================
// STATS
// ============================================
// ERRO D (corrigido): `commandsUsed` vivia só no objeto em memória. Nem
// `saveStats` gravava, nem `loadStats` lia — o contador de uso de comando
// voltava a zero a cada restart do bot, que é quando o `/adm` é mais usado.
const STATS_DEFAULT = {
    messagesDeleted: 0,
    warnsGiven: 0,
    membersJoined: 0,
    membersLeft: 0,
    xingamentos: 0,
    xingamentosStaff: 0,
    needsReview: 0,
    spamBloqueado: 0,
    linkBloqueado: 0,
    commandsUsed: {}
};

// Teto do mapa: um doc de config não é um log. Passando disto o painel
// mostrava só os 30 comandos mais usados e nenhuma vez por semana.
const MAX_COMMANDS = 60;

async function getStats() {
    const doc = await Memory.findOne({ category: 'stats', question: 'STATS' }).lean();
    if (!doc) return { ...STATS_DEFAULT, commandsUsed: {} };
    let lido = {};
    try { lido = JSON.parse(doc.answer) || {}; } catch (e) { lido = {}; }
    return {
        ...STATS_DEFAULT,
        ...lido,
        commandsUsed: (lido.commandsUsed && typeof lido.commandsUsed === 'object') ? lido.commandsUsed : {}
    };
}

async function saveStats(stats) {
    const comandos = (stats.commandsUsed && typeof stats.commandsUsed === 'object') ? stats.commandsUsed : {};
    const chaves = Object.keys(comandos);
    let cortados = comandos;
    if (chaves.length > MAX_COMMANDS) {
        cortados = {};
        for (const k of chaves.slice().sort((a, b) => (comandos[b] || 0) - (comandos[a] || 0)).slice(0, MAX_COMMANDS)) {
            cortados[k] = comandos[k];
        }
    }
    const payload = { ...STATS_DEFAULT, ...stats, commandsUsed: cortados };
    await Memory.deleteMany({ category: 'stats', question: 'STATS' });
    await Memory.create({
        user: 'SISTEMA', userId: 'SISTEMA',
        question: 'STATS', answer: JSON.stringify(payload),
        understood: true, category: 'stats', guildId: 'global'
    });
}

// ============================================
// TICKETS - CONEXÕES
// ============================================
// ERRO B (corrigido): o `deleteMany` antigo casava o doc de apagamento pelo
// campo `guildId`, mas o `findOne` da leitura casava por REGEX dentro do JSON
// (`"communityGuildId":"<id>"`). Os dois filtros discordavam, e `updateConfig`
// — que grava mute, autoInteraction, voiceMode — produz um objeto SEM
// communityGuildId. Resultado: o deleteMany nunca casava e cada update criava
// um doc novo. `getConnection` devolvia o primeiro que encontrou, ou seja, o
// estado velho — o silenciamento some depois de um restart.
//
// Agora os dois lados usam `guildId`. A regex ficou só como herança, para
// ler registros gravados antes do campo existir.
function conexaoAntiga(guildId) {
    return {
        category: 'config',
        question: 'CONNECTION',
        answer: new RegExp(`"communityGuildId":"${escaparRegex(guildId)}"`)
    };
}

async function saveConnection(guildId, data) {
    const escopo = String(guildId);
    await Memory.deleteMany({ category: 'config', question: 'CONNECTION', guildId: escopo });
    await Memory.deleteMany(conexaoAntiga(escopo));
    await Memory.create({
        user: 'SISTEMA', userId: 'SISTEMA', question: 'CONNECTION',
        answer: JSON.stringify(data),
        understood: true, category: 'config', guildId: escopo
    });
}

async function getConnection(guildId) {
    const escopo = String(guildId);
    let doc = await Memory.findOne({ category: 'config', question: 'CONNECTION', guildId: escopo }).lean();

    if (!doc) {
        // Herança: doc gravado por uma versão que não preenchia guildId.
        // Não é apagado aqui de propósito — o próximo saveConnection o remove.
        doc = await Memory.findOne(conexaoAntiga(escopo)).lean();
    }
    if (!doc) return null;
    try { return JSON.parse(doc.answer); } catch (e) { return null; }
}

async function setStaffConfig(guildId, data) {
    await saveConnection(guildId, data);
}

// NOVO: Atualizar apenas campos específicos sem sobrescrever tudo
async function updateConfig(guildId, updates) {
    const conn = await getConnection(guildId) || {};
    Object.assign(conn, updates);
    await saveConnection(guildId, conn);
}

// ============================================
// TICKETS - PAINÉIS
// ============================================
async function savePanel(panelId, data) {
    await Memory.create({
        user: 'SISTEMA', userId: 'SISTEMA',
        question: 'PANEL', answer: JSON.stringify(data),
        understood: true, category: 'config', guildId: data.guildId
    });
}

async function getPanel(panelId) {
    const doc = await Memory.findOne({ category: 'config', question: 'PANEL', 'answer.messageId': panelId }).lean();
    return doc ? JSON.parse(doc.answer) : null;
}

// ============================================
// TICKETS - ATIVOS
// ============================================
async function incrementTicketCounter() {
    let doc = await Memory.findOne({ category: 'stats', question: 'TICKET_COUNTER' });
    let counter = doc ? parseInt(doc.answer) : 0;
    counter++;
    if (doc) { doc.answer = String(counter); await doc.save(); }
    else {
        await Memory.create({
            user: 'SISTEMA', userId: 'SISTEMA',
            question: 'TICKET_COUNTER', answer: String(counter),
            understood: true, category: 'stats', guildId: 'global'
        });
    }
    return counter;
}

async function addTicket(channelId, data) {
    await Memory.create({
        user: data.userId, userId: data.userId,
        question: `TICKET #${data.number}`, answer: JSON.stringify(data),
        understood: false, category: 'ticket', guildId: data.guildId, timestamp: data.createdAt
    });
}

async function getTicket(channelId) {
    const doc = await Memory.findOne({ category: 'ticket', answer: new RegExp(`"channelId":"${channelId}"`) }).lean();
    return doc ? JSON.parse(doc.answer) : null;
}

async function closeTicket(channelId) {
    const doc = await Memory.findOne({ category: 'ticket', answer: new RegExp(`"channelId":"${channelId}"`) });
    if (doc) {
        const data = JSON.parse(doc.answer);
        data.status = 'closed';
        doc.answer = JSON.stringify(data);
        doc.understood = true;
        await doc.save();
    }
}

async function claimTicket(channelId, staffId) {
    const doc = await Memory.findOne({ category: 'ticket', answer: new RegExp(`"channelId":"${channelId}"`) });
    if (doc) {
        const data = JSON.parse(doc.answer);
        data.claimedBy = staffId;
        doc.answer = JSON.stringify(data);
        await doc.save();
    }
}

// ============================================
// CONHECIMENTO
// ============================================
async function getKnowledge(guildId) {
    const docs = await Memory.find({ category: 'conhecimento', guildId }).lean();
    const knowledge = {};
    docs.forEach(d => {
        const id = d._id.toString();
        const keywords = d.question.replace('KNOWLEDGE: ', '').split(', ');
        knowledge[id] = { keywords, response: d.answer, addedAt: d.timestamp };
    });
    return knowledge;
}

async function addKnowledge(guildId, entryId, keywords, response) {
    await Memory.create({
        user: 'SISTEMA', userId: 'SISTEMA',
        question: 'KNOWLEDGE: ' + keywords.join(', '), answer: response,
        understood: true, category: 'conhecimento', guildId
    });
    return true;
}

async function removeKnowledge(guildId, entryId) {
    await Memory.findByIdAndDelete(entryId);
    return true;
}

// ============================================
// AUTO INTERACTION TOGGLE
// ============================================
async function getAutoInteractionStatus(guildId) {
    const conn = await getConnection(guildId) || {};
    return conn.autoInteraction !== false; // true por padrão (ligado)
}

async function setAutoInteractionStatus(guildId, status) {
    await updateConfig(guildId, { autoInteraction: status });
}

// ============================================
// EXPORTAR TUDO
// ============================================
module.exports = {
    db: { delete: () => {} },
    getCustomWords, addCustomWord, removeCustomWord,
    getMonitoringStatus, setMonitoringStatus,
    getLinkSettings, setLinkSettings,
    getChannelModeration, setChannelModeration,
    getTicketAi, setTicketAi,
    getStats, saveStats,
    getFeatures, setFeatures,
    saveConnection, getConnection, setStaffConfig, updateConfig,
    savePanel, getPanel,
    incrementTicketCounter, addTicket, getTicket, closeTicket, claimTicket,
    getKnowledge, addKnowledge, removeKnowledge,
    getAutoInteractionStatus, setAutoInteractionStatus,
    getTranscriptSettings, setTranscriptEnabled,
    getTranscriptAiStatus, setTranscriptAi
};