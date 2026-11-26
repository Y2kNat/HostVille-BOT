const fs = require('fs');
const path = require('path');
const { EmbedBuilder, Colors } = require('discord.js');
const config = require('../config');
const { logInfo, logWarn } = require('../utils/logger');

const BAT = '/sys/class/power_supply/BAT0';
const CHANNEL_ID = '1483646073284198551';
const THRESHOLD = 30;
const RESET = 35;
const CHECK_MS = 5 * 60 * 1000;
const STATE_FILE = path.join(__dirname, '..', 'data', 'battery-alert.json');

let timer = null;
let state = {
    channelMessageId: null,
    dmMessageId: null,
    lastCapacity: null,
};

function loadState() {
    try {
        Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
    } catch {}
}

function saveState() {
    try {
        fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) {
        logWarn(`[BatteryAlert] falha ao salvar estado: ${e.message}`);
    }
}

function read(file) {
    try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
}

function acOnline() {
    for (const name of ['ADP0', 'AC0', 'ACAD', 'AC']) {
        const value = read(`/sys/class/power_supply/${name}/online`);
        if (value !== null) return value === '1';
    }
    return null;
}

function snapshot() {
    if (!fs.existsSync(BAT)) return null;
    const capacity = Number(read(BAT + '/capacity'));
    return {
        capacity: Number.isFinite(capacity) ? capacity : null,
        status: read(BAT + '/status') || 'N/A',
        ac: acOnline(),
    };
}

function buildEmbed(snap) {
    return new EmbedBuilder()
        .setTitle('🔋 Bateria baixa no servidor')
        .setDescription(`A bateria está em **${snap.capacity}%** e o notebook **não está carregando**.`)
        .setColor(snap.capacity <= 15 ? Colors.Red : 0xFFA500)
        .addFields(
            { name: 'Carga', value: `${snap.capacity}%`, inline: true },
            { name: 'Status', value: snap.status, inline: true },
            { name: 'Fonte', value: snap.ac ? 'Tomada' : 'Bateria', inline: true },
        )
        .setTimestamp();
}

async function fetchMessage(channel, id) {
    if (!id) return null;
    try { return await channel.messages.fetch(id); } catch { return null; }
}

async function sendOrUpdate(client, snap) {
    const ownerId = config.OWNER_ID;
    if (!ownerId) return;
    const embed = buildEmbed(snap);
    const channelText = `<@${ownerId}> 🔋 Bateria do servidor em **${snap.capacity}%**. Avise o responsável para carregar.`;

    try {
        const user = await client.users.fetch(ownerId);
        const dm = await user.createDM();
        let msg = await fetchMessage(dm, state.dmMessageId);
        if (msg) await msg.edit({ embeds: [embed] });
        else msg = await dm.send({ embeds: [embed] });
        state.dmMessageId = msg.id;
    } catch (e) {
        logWarn(`[BatteryAlert] falha na DM: ${e.message}`);
    }

    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (channel?.isTextBased()) {
            let msg = await fetchMessage(channel, state.channelMessageId);
            if (msg) await msg.edit({ content: channelText, embeds: [embed], allowedMentions: { users: [ownerId] } });
            else msg = await channel.send({ content: channelText, embeds: [embed], allowedMentions: { users: [ownerId] } });
            state.channelMessageId = msg.id;
        }
    } catch (e) {
        logWarn(`[BatteryAlert] falha no canal: ${e.message}`);
    }

    state.lastCapacity = snap.capacity;
    saveState();
    logInfo(`[BatteryAlert] alerta atualizado: ${snap.capacity}% (${snap.status})`);
}

async function deleteMessages(client) {
    if (!state.dmMessageId && !state.channelMessageId) return;
    const ownerId = config.OWNER_ID;
    try {
        if (state.dmMessageId && ownerId) {
            const user = await client.users.fetch(ownerId);
            const dm = await user.createDM();
            const msg = await fetchMessage(dm, state.dmMessageId);
            if (msg) await msg.delete();
        }
    } catch (e) {
        logWarn(`[BatteryAlert] falha ao apagar DM: ${e.message}`);
    }
    try {
        if (state.channelMessageId) {
            const channel = await client.channels.fetch(CHANNEL_ID);
            const msg = await fetchMessage(channel, state.channelMessageId);
            if (msg) await msg.delete();
        }
    } catch (e) {
        logWarn(`[BatteryAlert] falha ao apagar canal: ${e.message}`);
    }
    state = { channelMessageId: null, dmMessageId: null, lastCapacity: null };
    saveState();
    logInfo('[BatteryAlert] mensagens apagadas (bateria carregando/recuperada)');
}

async function check(client) {
    try {
        const snap = snapshot();
        if (!snap || snap.capacity === null) return;
        const charging = snap.status === 'Charging' || snap.ac === true;
        if (charging || snap.capacity >= RESET) {
            if (state.dmMessageId || state.channelMessageId || state.lastCapacity !== null) {
                await deleteMessages(client);
            }
            return;
        }

        if (snap.capacity <= THRESHOLD) {
            if (!state.dmMessageId && !state.channelMessageId) {
                await sendOrUpdate(client, snap);
            } else if (snap.capacity !== state.lastCapacity) {
                await sendOrUpdate(client, snap);
            }
        } else if ((state.dmMessageId || state.channelMessageId) && snap.capacity !== state.lastCapacity) {
            await sendOrUpdate(client, snap);
        }
    } catch (e) {
        logWarn(`[BatteryAlert] erro: ${e.message}`);
    }
}

function start(client) {
    if (timer) return;
    loadState();
    setTimeout(() => check(client), 10 * 1000);
    timer = setInterval(() => check(client), CHECK_MS);
    logInfo(`[BatteryAlert] monitor ativo (<=${THRESHOLD}% sem carregador)`);
}

module.exports = { start, check, buildEmbed, THRESHOLD, CHANNEL_ID };
