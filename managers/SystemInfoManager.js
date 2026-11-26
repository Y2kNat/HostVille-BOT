const { EmbedBuilder, Colors } = require('discord.js');
const discord = require('discord.js');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('../config');
const { logInfo, logWarn } = require('../utils/logger');

const BOT_UNITS = [
    { key: 'hostville', label: 'HostVille', unit: 'bot-hostville.service' },
    { key: 'review', label: 'Review', unit: 'bot-review.service' },
    { key: 'warn', label: 'Warn', unit: 'bot-warn.service' },
    { key: 'ascend', label: 'Ascend', unit: 'bot-ascend.service' },
    { key: 'atlas', label: 'Atlas', unit: 'bot-atlas.service' },
    { key: 'insight', label: 'Insight', unit: 'bot-insight.service' },
    { key: 'vehix', label: 'Vehix', unit: 'bot-vehix.service' },
];

const COOLDOWN_MS = 5000;
const cooldowns = new Map();

function isSystemCommand(message) {
    const content = String(message?.content || '').trim().toLowerCase();
    return content === 'hv%' || content === '-hv%' ||
        content.startsWith('hv% ') || content.startsWith('-hv% ');
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return 'N/A';
    if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + ' GB';
    if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
}

function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return 'N/A';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h || d) parts.push(`${h}h`);
    if (m || h || d) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}

function readSysfs(file) {
    try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
}

function getBattery() {
    const bat = '/sys/class/power_supply/BAT0';
    if (!fs.existsSync(bat)) return null;
    const status = readSysfs(bat + '/status') || 'N/A';
    const capacity = readSysfs(bat + '/capacity');
    const powerNow = readSysfs(bat + '/power_now');
    const energyNow = readSysfs(bat + '/energy_now');
    const energyFull = readSysfs(bat + '/energy_full');
    let acOnline = null;
    for (const name of ['ADP0', 'AC0', 'ACAD', 'AC']) {
        const p = `/sys/class/power_supply/${name}/online`;
        if (fs.existsSync(p)) { acOnline = readSysfs(p); break; }
    }
    return {
        status,
        capacity: capacity ? capacity + '%' : 'N/A',
        power: powerNow ? (Number(powerNow) / 1e6).toFixed(2) + ' W' : 'N/A',
        energy: (energyNow && energyFull)
            ? `${(Number(energyNow) / 1e6).toFixed(1)} / ${(Number(energyFull) / 1e6).toFixed(1)} Wh`
            : 'N/A',
        ac: acOnline === '1' ? 'Tomada' : acOnline === '0' ? 'Bateria' : 'N/A',
    };
}

function getDisk() {
    try {
        const s = fs.statfsSync('/');
        const total = s.blocks * s.bsize;
        const free = s.bfree * s.bsize;
        const used = total - free;
        return {
            total: formatBytes(total),
            used: formatBytes(used),
            free: formatBytes(free),
            percent: total > 0 ? (used / total * 100).toFixed(1) + '%' : 'N/A',
        };
    } catch {
        return null;
    }
}

function getSwap() {
    try {
        const mem = fs.readFileSync('/proc/meminfo', 'utf8');
        const value = (key) => {
            const m = mem.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
            return m ? Number(m[1]) * 1024 : 0;
        };
        const total = value('SwapTotal');
        const free = value('SwapFree');
        const used = total - free;
        return {
            total,
            used,
            free,
            percent: total > 0 ? (used / total * 100).toFixed(1) : '0.0',
        };
    } catch {
        return null;
    }
}

function getNetwork() {
    const nets = os.networkInterfaces();
    const result = [];
    for (const [name, addrs] of Object.entries(nets || {})) {
        const ips = (addrs || []).filter(a => !a.internal && (a.family === 'IPv4' || a.family === 'IPv6')).map(a => a.address);
        if (ips.length) result.push({ name, ips });
    }
    return result;
}

function getCpuTemp() {
    try {
        const zones = fs.readdirSync('/sys/class/thermal').filter(z => z.startsWith('thermal_zone'));
        for (const z of zones) {
            const type = readSysfs(`/sys/class/thermal/${z}/type`) || '';
            const temp = readSysfs(`/sys/class/thermal/${z}/temp`);
            if (temp && /cpu|x86|pkg/i.test(type)) {
                return (Number(temp) / 1000).toFixed(1) + ' °C';
            }
        }
        if (zones.length) {
            const temp = readSysfs(`/sys/class/thermal/${zones[0]}/temp`);
            if (temp) return (Number(temp) / 1000).toFixed(1) + ' °C';
        }
    } catch {}
    return null;
}

function systemctlShow(unit, props) {
    try {
        const args = ['--user', 'show', unit, ...props.flatMap(p => ['-p', p])];
        const out = execFileSync('systemctl', args, {
            encoding: 'utf8',
            env: { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}` },
            timeout: 5000,
        });
        const result = {};
        for (const line of out.split(/\r?\n/)) {
            const idx = line.indexOf('=');
            if (idx > 0) result[line.slice(0, idx)] = line.slice(idx + 1);
        }
        return result;
    } catch {
        return null;
    }
}

async function getBotStats() {
    const stats = BOT_UNITS.map(b => ({
        ...b,
        state: 'N/A',
        pid: null,
        memory: null,
        swap: null,
        cpuTime: null,
        restarts: 0,
        cpuPct: null,
    }));

    const first = {};
    const t0 = Date.now();
    for (const b of stats) {
        const s = systemctlShow(b.unit, ['ActiveState', 'MainPID', 'MemoryCurrent', 'MemorySwapCurrent', 'CPUUsageNSec', 'NRestarts']);
        if (s) {
            b.state = s.ActiveState || 'unknown';
            b.pid = s.MainPID && s.MainPID !== '0' ? s.MainPID : null;
            b.memory = s.MemoryCurrent && s.MemoryCurrent !== '[not set]' ? Number(s.MemoryCurrent) : null;
            b.swap = s.MemorySwapCurrent && s.MemorySwapCurrent !== '[not set]' ? Number(s.MemorySwapCurrent) : null;
            b.cpuTime = s.CPUUsageNSec && s.CPUUsageNSec !== '[not set]' ? Number(s.CPUUsageNSec) : null;
            b.restarts = s.NRestarts ? Number(s.NRestarts) : 0;
            first[b.key] = b.cpuTime;
        } else {
            b.state = 'N/A (systemd)';
        }
    }

    await new Promise(r => setTimeout(r, 500));
    const elapsed = (Date.now() - t0) / 1000;
    for (const b of stats) {
        const s = systemctlShow(b.unit, ['CPUUsageNSec']);
        if (s && s.CPUUsageNSec && s.CPUUsageNSec !== '[not set]') {
            const cpu2 = Number(s.CPUUsageNSec);
            const cpu1 = first[b.key];
            if (cpu1 !== null && cpu2 >= cpu1 && elapsed > 0) {
                b.cpuPct = ((cpu2 - cpu1) / 1e9 / elapsed) * 100;
            }
        }
    }
    return stats;
}

function getSystemSnapshot() {
    let username = 'N/A';
    try { username = os.userInfo().username; } catch {}
    const cpus = os.cpus() || [];
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const load = os.loadavg();
    const battery = getBattery();
    const disk = getDisk();
    const swap = getSwap();
    const temp = getCpuTemp();
    const network = getNetwork();

    return {
        hostname: os.hostname(),
        username,
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        uptime: os.uptime(),
        bootTime: new Date(Date.now() - os.uptime() * 1000),
        cpuModel: cpus.length ? cpus[0].model : 'N/A',
        cpuCores: cpus.length,
        load1: Number.isFinite(load[0]) ? load[0].toFixed(2) : 'N/A',
        load5: Number.isFinite(load[1]) ? load[1].toFixed(2) : 'N/A',
        load15: Number.isFinite(load[2]) ? load[2].toFixed(2) : 'N/A',
        totalMem,
        usedMem,
        freeMem,
        memPercent: totalMem > 0 ? (usedMem / totalMem * 100).toFixed(1) : 'N/A',
        disk,
        swap,
        battery,
        temp,
        network,
        nodeVersion: process.version,
        discordVersion: discord.version,
        cwd: process.cwd(),
        botUptime: process.uptime(),
        ping: 0,
    };
}

function buildBotField(stats, isDM) {
    const lines = stats.map(b => {
        const ram = b.memory !== null ? (b.memory / 1024 / 1024).toFixed(1) + ' MB' : 'N/A';
        const cpu = b.cpuPct !== null ? b.cpuPct.toFixed(1) + '%' : 'N/A';
        const state = b.state || 'N/A';
        if (isDM) {
            const pid = b.pid || 'N/A';
            const cpuTime = b.cpuTime !== null ? (b.cpuTime / 1e9 / 60).toFixed(1) + ' min' : 'N/A';
            return `${b.label.padEnd(9)} ${ram.padStart(9)} ${cpu.padStart(6)} ${state.padEnd(12)} PID ${String(pid).padStart(6)} CPU ${cpuTime}`;
        }
        return `${b.label.padEnd(9)} ${ram.padStart(9)} ${cpu.padStart(6)} ${state}`;
    });
    const header = isDM
        ? 'Bot        RAM        CPU  Estado       PID      CPU acum.'
        : 'Bot        RAM        CPU  Estado';
    return '```\n' + header + '\n' + lines.join('\n') + '\n```';
}

function buildSwapField(botStats, swap) {
    const using = botStats.filter(b => b.swap && b.swap > 0);
    if (!using.length) return 'Nenhum bot usando swap no momento.';
    const total = swap?.total || 0;
    return using.map(b => {
        const pct = total > 0 ? (b.swap / total * 100).toFixed(2) : '0.00';
        return `${b.label}: ${(b.swap / 1024 / 1024).toFixed(1)} MB (${pct}% do swap)`;
    }).join('\n');
}

function buildEmbed(snapshot, botStats, isDM, ping) {
    const embed = new EmbedBuilder()
        .setTitle(isDM ? '🖥️ Status do PC (detalhado)' : '🖥️ Status do PC / Servidor')
        .setColor(Colors.Blue)
        .setTimestamp();

    const sysLines = [];
    if (isDM) {
        sysLines.push(`Host: ${snapshot.hostname}`);
        sysLines.push(`Usuário: ${snapshot.username}`);
        sysLines.push(`OS: ${snapshot.platform} ${snapshot.release} (${snapshot.arch})`);
    }
    sysLines.push(`CPU: ${snapshot.cpuModel} (${snapshot.cpuCores} núcleos)`);
    sysLines.push(`Carga: ${snapshot.load1} / ${snapshot.load5} / ${snapshot.load15} (1/5/15 min)`);
    sysLines.push(`Uptime: ${formatDuration(snapshot.uptime)}`);
    if (snapshot.temp) sysLines.push(`Temp CPU: ${snapshot.temp}`);
    embed.addFields({ name: '🖥️ Sistema', value: sysLines.join('\n'), inline: false });

    const swap = snapshot.swap;
    const swapLine = swap
        ? `Swap: ${formatBytes(swap.used)} / ${formatBytes(swap.total)} (${swap.percent}%)`
        : 'Swap: N/A';
    embed.addFields({
        name: '🧠 Memória',
        value: `RAM: ${(snapshot.usedMem / 1024 / 1024).toFixed(1)} MB / ${(snapshot.totalMem / 1024 / 1024).toFixed(1)} MB (${snapshot.memPercent}%)\n${swapLine}`,
        inline: true,
    });

    if (snapshot.disk) {
        embed.addFields({
            name: '💾 Disco (/)',
            value: `${snapshot.disk.used} / ${snapshot.disk.total} (${snapshot.disk.percent})`,
            inline: true,
        });
    } else {
        embed.addFields({ name: '💾 Disco (/)', value: 'N/A', inline: true });
    }

    const bat = snapshot.battery;
    if (bat) {
        const batLines = [`Status: ${bat.status}`, `Carga: ${bat.capacity}`, `Fonte: ${bat.ac}`, `Potência: ${bat.power}`];
        if (isDM) batLines.push(`Energia: ${bat.energy}`);
        embed.addFields({ name: '🔋 Bateria', value: batLines.join('\n'), inline: true });
    } else {
        embed.addFields({ name: '🔋 Bateria', value: 'N/A (sem bateria/VM)', inline: true });
    }

    embed.addFields({ name: '🤖 Bots', value: buildBotField(botStats, isDM), inline: false });
    embed.addFields({ name: '💤 Swap dos bots', value: buildSwapField(botStats, snapshot.swap), inline: false });

    const hvLines = [`Ping: ${ping} ms`, `Uptime do bot: ${formatDuration(snapshot.botUptime)}`];
    if (isDM) {
        hvLines.push(`RSS: ${formatBytes(process.memoryUsage().rss)}`);
        hvLines.push(`Node: ${snapshot.nodeVersion}`);
        hvLines.push(`discord.js: ${snapshot.discordVersion}`);
    }
    embed.addFields({ name: 'HostVille • BOT', value: hvLines.join('\n'), inline: true });

    if (isDM) {
        const netLines = snapshot.network.length
            ? snapshot.network.map(n => `${n.name}: ${n.ips.join(', ')}`).join('\n')
            : 'Nenhuma interface externa';
        embed.addFields({ name: '🌐 Rede', value: netLines, inline: false });

        const detailLines = [
            `Boot: ${snapshot.bootTime.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
            `CWD: ${snapshot.cwd}`,
            `Dir: ${__dirname}`,
        ];
        embed.addFields({ name: '🔒 Detalhes', value: detailLines.join('\n'), inline: false });
    }

    embed.setFooter({ text: isDM ? 'Dados sensíveis - uso exclusivo do dono' : 'Perfil público - sem dados sensíveis' });
    return embed;
}

async function execute(message) {
    const ownerId = config.OWNER_ID;
    if (!ownerId || message.author.id !== ownerId) {
        logWarn(`[SystemInfo] tentativa não autorizada de ${message.author.tag} (${message.author.id}) em ${message.guild?.name || 'DM'}#${message.channel?.name || 'DM'}`);
        return;
    }

    const now = Date.now();
    const last = cooldowns.get(message.author.id) || 0;
    if (now - last < COOLDOWN_MS) {
        const wait = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
        try { await message.reply({ content: `⏳ Aguarde ${wait}s antes de executar novamente.` }); } catch {}
        return;
    }
    cooldowns.set(message.author.id, now);

    const isDM = message.channel?.type === 1;

    try {
        const ping = message.client?.ws?.ping ?? 0;
        const snapshot = getSystemSnapshot(isDM);
        snapshot.ping = ping;
        const botStats = await getBotStats();
        const embed = buildEmbed(snapshot, botStats, isDM, ping);
        await message.reply({ embeds: [embed] });
        logInfo(`[SystemInfo] executado por ${message.author.tag} em ${message.guild?.name || 'DM'} (${isDM ? 'DM' : 'servidor'})`);
    } catch (err) {
        logWarn(`[SystemInfo] erro: ${err.message}`);
        try { await message.reply({ content: '❌ Erro ao coletar informações do sistema.' }); } catch {}
    }
}

module.exports = { isSystemCommand, execute, BOT_UNITS };