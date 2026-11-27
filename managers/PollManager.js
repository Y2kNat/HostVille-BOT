const fs = require('fs');
const path = require('path');
const { logInfo, logError } = require('../utils/logger');

const FILE = path.join(__dirname, '..', 'data', 'polls.json');
const TZ = 'America/Sao_Paulo';
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DEFAULT = {
    channelId: '1392306453678915625',
    title: 'RP as 20:00 no sabado',
    message: 'RP começa às 20:00 no sábado.',
    options: ['Irei Participar', 'Não irei Participar', 'Entrarei depois do horário', 'Talvez entrarei'],
    schedule: [{ day: 5, time: '14:00' }],
    closeHours: 24,
    sent: {}
};

let cache = null;
let timer = null;

function ler() {
    if (cache) return cache;
    try {
        cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch {
        cache = { '928614664840052757': { ...DEFAULT, sent: {} } };
    }
    return cache;
}

function salvar() {
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        const tmp = FILE + '.tmp-' + process.pid;
        fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
        fs.renameSync(tmp, FILE);
        return true;
    } catch (e) {
        logError('[PollManager] falha ao gravar: ' + e.message);
        return false;
    }
}

function config(guildId) {
    const c = ler();
    if (!c[guildId]) c[guildId] = { ...DEFAULT, sent: {} };
    return c[guildId];
}

function salvarConfig(guildId, dados) {
    ler()[guildId] = dados;
    return salvar();
}
function agoraSP() {
    const now = new Date();
    const weekday = now.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' });
    const mapa = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const time = now.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
    const date = now.toLocaleDateString('en-CA', { timeZone: TZ });
    return { day: mapa[weekday] ?? 0, time, date, key: `${date}T${time}` };
}

async function enviar(client, guildId, cfg, occurrenceKey) {
    const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
    if (!channel) { logError(`[PollManager] canal ${cfg.channelId} inacessível`); return false; }
    try {
        await channel.send({
            poll: {
                question: { text: String(cfg.title || 'Enquete').slice(0, 300) },
                answers: cfg.options.slice(0, 10).map(text => ({ text: String(text).slice(0, 50) })),
                duration: 24,
                allowMultiselect: false
            }
        });
        await channel.send({ content: '@everyone' + (cfg.message ? `\n${cfg.message}` : '') }).catch(() => {});
        cfg.sent[occurrenceKey] = new Date().toISOString();
        const antigos = Object.keys(cfg.sent).sort().slice(0, -7);
        for (const k of antigos) delete cfg.sent[k];
        salvar();
        logInfo(`[PollManager] enquete enviada em ${guildId} (${occurrenceKey})`);
        return true;
    } catch (e) {
        logError(`[PollManager] falha ao enviar: ${e.message}`);
        return false;
    }
}

async function check(client) {
    const { day, time, date } = agoraSP();
    for (const [guildId, cfg] of Object.entries(ler())) {
        for (const s of cfg.schedule || []) {
            if (s.day !== day) continue;
            const chave = `${date}T${s.time}`;
            if (cfg.sent[chave]) continue;
            if (time >= s.time) await enviar(client, guildId, cfg, chave);
        }
    }
}

function start(client) {
    if (timer) return;
    check(client).catch(() => {});
    timer = setInterval(() => check(client).catch(() => {}), 30000);
    if (timer.unref) timer.unref();
}

function validarOpcoes(opcoes) {
    if (!Array.isArray(opcoes) || opcoes.length < 2 || opcoes.length > 10) return 'A enquete precisa de 2 a 10 opções.';
    if (opcoes.some(o => !String(o || '').trim() || String(o).length > 50)) return 'Cada opção precisa ter de 1 a 50 caracteres.';
    return null;
}

function addOption(guildId, texto) {
    const cfg = config(guildId);
    if (cfg.options.length >= 10) return 'Máximo de 10 opções.';
    cfg.options.push(String(texto).slice(0, 50));
    salvarConfig(guildId, cfg);
    return null;
}

function editOption(guildId, indice, texto) {
    const cfg = config(guildId);
    if (indice < 1 || indice > cfg.options.length) return 'Índice inválido.';
    const candidata = cfg.options.slice();
    candidata[indice - 1] = String(texto).slice(0, 50);
    const erro = validarOpcoes(candidata);
    if (erro) return erro;
    cfg.options = candidata;
    salvarConfig(guildId, cfg);
    return null;
}

function removeOption(guildId, indice) {
    const cfg = config(guildId);
    if (indice < 1 || indice > cfg.options.length) return 'Índice inválido.';
    if (cfg.options.length <= 2) return 'A enquete precisa de pelo menos 2 opções.';
    cfg.options.splice(indice - 1, 1);
    salvarConfig(guildId, cfg);
    return null;
}

function addDay(guildId, dia, hora) {
    const cfg = config(guildId);
    if (!/^\d{2}:\d{2}$/.test(hora)) return 'Hora inválida. Use HH:MM.';
    if (!cfg.schedule.some(s => s.day === dia && s.time === hora)) cfg.schedule.push({ day: dia, time: hora });
    salvarConfig(guildId, cfg);
    return null;
}

function removeDay(guildId, dia, hora) {
    const cfg = config(guildId);
    if (cfg.schedule.length <= 1) return 'A enquete precisa de pelo menos um dia.';
    cfg.schedule = cfg.schedule.filter(s => !(s.day === dia && s.time === hora));
    salvarConfig(guildId, cfg);
    return null;
}

module.exports = {
    start, check, config, salvarConfig, enviar, validarOpcoes,
    addOption, editOption, removeOption, addDay, removeDay,
    DIAS, DEFAULT, agoraSP
};
