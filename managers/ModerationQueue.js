const crypto = require('crypto');
const config = require('../config');
const { logInfo, logError } = require('../utils/logger');
const FilterManager = require('./FilterManager');
const ModerationClassifier = require('./ModerationClassifier');
const ModerationPunish = require('./ModerationPunish');
const { DECISION } = require('../utils/moderation/constants');

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 2000;
const queue = [];
const seen = new Set();
let active = 0;
let started = false;
let stats = { enqueued: 0, processed: 0, skipped: 0, flagged: 0, unavailable: 0 };
function hash(text) {
    return crypto.createHash('sha1').update(String(text || '')).digest('hex');
}

function cacheGet(h) {
    const v = cache.get(h);
    if (!v) return null;
    if (Date.now() - v.ts > CACHE_TTL) { cache.delete(h); return null; }
    return v.result;
}
function cacheSet(h, result) {
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(h, { ts: Date.now(), result });
}

function shouldSkip(message) {
    if (!message || !message.guild || !message.member) return true;
    if (message.author?.bot) return true;
    if (!config.MODERATION_ENABLED) return true;
    try {
        const Features = require('./FeatureRegistry');
        if (!Features.ligadoSync('monitoramento', message.guild.id)) return true;
        if (!Features.ligadoSync('ia_moderacao', message.guild.id)) return true;
        if (!Features.ligadoSync('filtro_palavras', message.guild.id)) return true;
    } catch (e) {}
    if (!FilterManager.isChannelEnabled(message.guild.id, message.channel.id)) return true;
    const text = String(message.content || '').trim();
    if (!text) return true;
    if (/^https?:\/\/\S+$/.test(text)) return true;
    return false;
}

function work() {
    if (active >= Math.max(1, config.MODERATION_CONCURRENCY || 4)) return;
    const item = queue.shift();
    if (!item) return;
    active++;
    process(item).finally(() => {
        active--;
        work();
        if (queue.length) work();
    });
}

async function process(item) {
    const { message, modResult } = item;
    const text = String(message.content || '').trim();
    const h = hash(text);
    let result = cacheGet(h);
    if (!result) {
        try {
            result = await ModerationClassifier.classifyMessage(text, modResult || {}, { guildId: message.guild.id });
            cacheSet(h, result);
        } catch (e) {
            logError(`[ModerationQueue] erro ao classificar: ${e.message}`);
            result = { flagged: false, decision: DECISION.NEEDS_REVIEW, aiStatus: 'unavailable' };
        }
    }
    stats.processed++;
    if (result.aiStatus === 'unavailable' || result.aiStatus === 'skipped') stats.unavailable++;

    const flagged = !!(result.flagged && result.decision === DECISION.FINAL);
    if (!flagged) {
        if (result.decision === DECISION.NEEDS_REVIEW) {
            logInfo(`[ModerationQueue] review: ${message.author.tag} em ${message.guild.name}: ${text.slice(0, 60)}`);
        }
        if (config.MODERATION_IMAGE_CHECK && message.attachments && message.attachments.size) {
            const att = message.attachments.first();
            if (att && att.contentType && att.contentType.startsWith('image/')) {
                const img = await ModerationClassifier.classifyImage(att.url);
                if (img.unsafe && img.confidence >= (config.MODERATION_MIN_CONFIDENCE || 0.8)) {
                    stats.flagged++;
                    await ModerationPunish.apply(message, 'imagem insegura', {
                        category: 'image',
                        severity: 'high',
                        confidence: img.confidence,
                        aiStatus: 'ai_classified_offensive'
                    });
                }
            }
        }
        return;
    }
    stats.flagged++;
    let foundWord = null;
    try { foundWord = FilterManager.findOffensiveWord(modResult || result); } catch (e) {}
    if (!foundWord) foundWord = text.slice(0, 40);
    await ModerationPunish.apply(message, foundWord, result);
}

function enqueue(message, modResult) {
    if (shouldSkip(message)) { stats.skipped++; return false; }
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    if (queue.length >= (config.MODERATION_QUEUE_MAX || 200)) {
        stats.skipped++;
        return false;
    }
    queue.push({ message, modResult });
    stats.enqueued++;
    work();
    return true;
}

function getStats() { return Object.assign({}, stats, { queue: queue.length, active }); }

module.exports = { enqueue, getStats };
