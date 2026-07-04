const mongoose = require('./mongo');
const Memory = require('../models/Memory');
const Pending = require('../models/Pending');

// ============================================
// FUNÇÕES DE WARNING
// ============================================
async function getWarnings(userId) {
    const docs = await Memory.find({ category: 'warning', userId }).sort({ timestamp: -1 }).lean();
    return docs.map(d => ({ reason: d.answer, moderator: d.moderator, timestamp: d.timestamp }));
}

async function addWarning(userId, warnData) {
    await Memory.create({
        user: userId, userId,
        question: 'WARNING', answer: warnData.reason,
        understood: true, category: 'warning',
        guildId: warnData.guildId || 'unknown', timestamp: warnData.timestamp || Date.now()
    });
    return getWarnings(userId);
}

async function clearWarnings(userId) {
    await Memory.deleteMany({ userId, category: 'warning' });
}

// ============================================
// PALAVRAS BANIDAS
// ============================================
async function getCustomWords() {
    const docs = await Memory.find({ category: 'config', question: 'PALAVRA_BANIDA' }).lean();
    return docs.map(d => d.answer);
}

async function addCustomWord(word) {
    const exists = await Memory.findOne({ category: 'config', question: 'PALAVRA_BANIDA', answer: word });
    if (!exists) {
        await Memory.create({
            user: 'SISTEMA', userId: 'SISTEMA',
            question: 'PALAVRA_BANIDA', answer: word,
            understood: true, category: 'config', guildId: 'global'
        });
        return true;
    }
    return false;
}

async function removeCustomWord(word) {
    await Memory.deleteOne({ category: 'config', question: 'PALAVRA_BANIDA', answer: word });
}

// ============================================
// MONITORING
// ============================================
async function getMonitoringStatus(guildId) {
    const doc = await Memory.findOne({ category: 'config', question: 'MONITORING', answer: new RegExp(`^${guildId}:`) }).lean();
    return doc ? doc.answer.split(': ')[1] === 'true' : true;
}

async function setMonitoringStatus(guildId, status) {
    await Memory.deleteMany({ category: 'config', question: 'MONITORING', answer: new RegExp(`^${guildId}:`) });
    await Memory.create({
        user: 'SISTEMA', userId: 'SISTEMA',
        question: 'MONITORING', answer: `${guildId}: ${status}`,
        understood: true, category: 'config', guildId
    });
}

// ============================================
// LINK SETTINGS
// ============================================
async function getLinkSettings() {
    const doc = await Memory.findOne({ category: 'config', question: 'LINK_SETTINGS' }).lean();
    return doc ? JSON.parse(doc.answer) : { deleteInvites: true, allowedDomains: [] };
}

async function setLinkSettings(settings) {
    await Memory.deleteMany({ category: 'config', question: 'LINK_SETTINGS' });
    await Memory.create({
        user: 'SISTEMA', userId: 'SISTEMA',
        question: 'LINK_SETTINGS', answer: JSON.stringify(settings),
        understood: true, category: 'config', guildId: 'global'
    });
}

// ============================================
// STATS
// ============================================
async function getStats() {
    const doc = await Memory.findOne({ category: 'stats', question: 'STATS' }).lean();
    return doc ? JSON.parse(doc.answer) : { messagesDeleted: 0, warnsGiven: 0, membersJoined: 0, membersLeft: 0 };
}

async function saveStats(stats) {
    await Memory.deleteMany({ category: 'stats', question: 'STATS' });
    await Memory.create({
        user: 'SISTEMA', userId: 'SISTEMA',
        question: 'STATS', answer: JSON.stringify(stats),
        understood: true, category: 'stats', guildId: 'global'
    });
}

// ============================================
// TICKETS - CONEXÕES
// ============================================
async function saveConnection(guildId, data) {
    await Memory.deleteMany({ category: 'config', question: 'CONNECTION', answer: new RegExp(`"communityGuildId":"${guildId}"`) });
    await Memory.create({
        user: 'SISTEMA', userId: 'SISTEMA',
        question: 'CONNECTION', answer: JSON.stringify(data),
        understood: true, category: 'config', guildId
    });
}

async function getConnection(guildId) {
    const doc = await Memory.findOne({ category: 'config', question: 'CONNECTION', answer: new RegExp(guildId) }).lean();
    return doc ? JSON.parse(doc.answer) : null;
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
// EXPORTAR TUDO
// ============================================
module.exports = {
    db: { delete: () => {} },
    getWarnings, addWarning, clearWarnings,
    getCustomWords, addCustomWord, removeCustomWord,
    getMonitoringStatus, setMonitoringStatus,
    getLinkSettings, setLinkSettings,
    getStats, saveStats,
    saveConnection, getConnection, setStaffConfig, updateConfig,
    savePanel, getPanel,
    incrementTicketCounter, addTicket, getTicket, closeTicket, claimTicket,
    getKnowledge, addKnowledge, removeKnowledge
};