const config = require('../config');
const db = require('../database/db');
const fs = require('fs');
const path = require('path');
const StatsManager = require('../managers/StatsManager');
const ReportManager = require('../managers/ReportManager');
const AutoInteraction = require('../managers/AutoInteraction');
const { logSuccess, logInfo, logWarn, logError } = require('../utils/logger');
const kilo = require('../managers/KiloClient');
const { sendLog } = require('../utils/realtime');

const commands = [
    require('../commands/mod/warn').data,
    require('../commands/mod/warnings').data,
    require('../commands/mod/clearwarns').data,
    require('../commands/mod/kick').data,
    require('../commands/mod/ban').data,
    require('../commands/mod/timeout').data,
    require('../commands/mod/purge').data,
    require('../commands/mod/ban-info').data,
    require('../commands/mod/case').data,
    require('../commands/mod/slowmode').data,
    require('../commands/mod/lock').data,
    require('../commands/mod/unlock').data,
    require('../commands/config/filter').data,
    require('../commands/config/modtest').data,
    require('../commands/config/linksettings').data,
    require('../commands/info/adm').data,
    require('../commands/info/ping').data,
    require('../commands/info/help').data,
    require('../commands/info/avatar').data,
    require('../commands/info/serverinfo').data,
    require('../commands/info/userinfo').data,
    require('../commands/staff/private').data,
    require('../commands/staff/report').data,
    require('../commands/ticket/ticketconfig').data,
    require('../commands/ticket/ticketsetup').data,
    require('../commands/ticket/close').data,
    require('../commands/ticket/ticket').data,
    require('../commands/ticket/adicionar').data,
    require('../commands/config/maintenance').data,
    require('../commands/config/setup').data,
    require('../commands/config/poll').data,
    // Este existia no mapa de handlers mas nunca foi registrado no Discord:
    // o comando aparecia no codigo e nao existia pra staff.
    require('../commands/config/autointeraction').data,
    require('../commands/ticket/ai-ticket').data,
    require('../commands/ticket/transcript').data
];

const consoleDir = path.join(__dirname, '..', 'console');

async function runRoutineTest(client) {
    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, '0')}_${String(now.getMonth() + 1).padStart(2, '0')}_${now.getFullYear()}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}_${String(now.getMinutes()).padStart(2, '0')}`;
    const logFileName = `rotineTest_${dateStr}-${timeStr}.js`;
    const logFilePath = path.join(consoleDir, logFileName);

    let routinePassed = 0, routineFailed = 0;
    const routineResults = [];

    function rCheck(name, condition, detail = '') {
        if (condition) { routineResults.push({ name, status: 'PASSED', detail }); routinePassed++; }
        else { routineResults.push({ name, status: 'FAILED', detail }); routineFailed++; }
    }

    rCheck('ENV: TOKEN', !!process.env.TOKEN, 'configurado');
    // .env: Função, bot precisa ligar, mas sem o TOKEN configurado nas variáveis de ambiente ou no codigo, o bot não pode iniciar
    rCheck('KILO: chave configurada', !!config.KILO_API_KEY, config.KILO_API_KEY ? 'configurada' : 'FALTA KILO_API_KEY no .env');
    rCheck('KILO: base URL', !!config.KILO_BASE_URL, config.KILO_BASE_URL || '');
    rCheck('KILO: modelo', !!config.KILO_DEFAULT_MODEL, config.KILO_DEFAULT_MODEL || 'FALTA KILO_DEFAULT_MODEL no .env');

    const iaStatus = await kilo.getStatus();
    rCheck('KILO: gateway no ar', iaStatus.serveRunning, iaStatus.serveRunning ? 'gateway respondendo' : 'gateway NÃO está respondendo (' + config.KILO_BASE_URL + ')');
    rCheck('KILO: modelo disponível', iaStatus.modelInstalled, iaStatus.modelInstalled ? config.KILO_DEFAULT_MODEL : 'modelo não encontrado no gateway: ' + (config.KILO_DEFAULT_MODEL || '(vazio)'));

    rCheck('BOT: online', client.isReady(), 'bot está online');
    rCheck('BOT: ping', client.ws.ping > 0, `ping: ${client.ws.ping}ms`);
    rCheck('BOT: guilds', client.guilds.cache.size > 0, `${client.guilds.cache.size} servidores`);

    let logContent = `============================================\nHostVille • BOT - Teste de Rotina\n============================================\nData: ${now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\nPassaram: ${routinePassed} | Falharam: ${routineFailed} | Total: ${routinePassed + routineFailed}\n============================================\n\n`;
    routineResults.forEach(r => { logContent += `  ${r.status === 'PASSED' ? '✅' : '❌'} ${r.name}: ${r.status} - ${r.detail}\n`; });
    logContent += '\n============================================\n';

    fs.writeFileSync(logFilePath, logContent);
    try {
        const logs = fs.readdirSync(consoleDir).filter(f => f.startsWith('rotineTest_') && f.endsWith('.js')).sort().reverse();
        logs.slice(1).forEach(f => { try { fs.unlinkSync(path.join(consoleDir, f)); } catch {} });
    } catch (err) {}
    console.log(`\n🔄 Teste de rotina feito (${routinePassed} ok, ${routineFailed} erros) → console/${logFileName}\n`);
}

/**
 * Verificar o status da IA no startup (apenas reporta, NÃO chama o modelo).
 * O gateway do Kilo é remoto e stateless: não existe processo local para
 * ligar nem modelo para "carregar". O que se verifica é se o gateway
 * responde e se o modelo configurado existe nele. As transições
 * (caiu/voltou) ficam por conta do watchdogIA().
 */
async function checkIA(showChart = true) {
    try {
        const status = await kilo.getStatus();
        if (!status.serveRunning) {
            logWarn('Gateway do Kilo NÃO está respondendo. IA indisponível.');
            console.log('⚠️  Gateway do Kilo NÃO está respondendo. Confira KILO_BASE_URL e a rede.');
            return;
        }
        if (!status.modelInstalled) {
            logWarn(`Modelo ${config.KILO_DEFAULT_MODEL || '(vazio)'} não encontrado no gateway do Kilo.`);
            console.log(`⚠️  Modelo ${config.KILO_DEFAULT_MODEL || '(vazio)'} não disponível no gateway. Confira KILO_DEFAULT_MODEL.`);
            return;
        }
        logInfo(`Kilo OK: gateway respondendo, modelo ${config.KILO_DEFAULT_MODEL} disponível.`);
    } catch (e) {
        logWarn('Erro ao verificar o gateway do Kilo: ' + e.message);
    }
}

/**
 * Watchdog da IA: monitora periodicamente se o gateway do Kilo responde e
 * se o modelo continua disponível. Só loga nas TRANSIÇÕES de estado, para não
 * encher o console:
 *   - gateway caiu          → "🛑 Funções de IA indisponíveis"
 *   - gateway voltou        → "✅ IA ativa"
 */
let iaAIState = 'unknown';

async function watchdogIA() {
    try {
        let serve = false, loaded = false;
        try {
            // UM fetch só: getStatus() já consulta /models uma vez e devolve
            // os dois estados. Duas chamadas separadas seriamos duas
            // requisições a cada ciclo do watchdog.
            const s = await kilo.getStatus();
            serve = s.serveRunning;
            loaded = s.modelLoaded;
        } catch (e) {}

        const available = serve && loaded;

        if (available && iaAIState !== 'on') {
            iaAIState = 'on';
            logSuccess(`Gateway do Kilo no ar || funções de IA ativas (${config.KILO_DEFAULT_MODEL || 'sem modelo'})`);
        } else if (!available && iaAIState !== 'off') {
            iaAIState = 'off';
            logWarn(`Funções de IA indisponíveis: o gateway do Kilo não está respondendo ou o modelo ${config.KILO_DEFAULT_MODEL || '(vazio)'} não existe.`);
        }
    } catch (e) {
        if (iaAIState !== 'off') {
            iaAIState = 'off';
            logWarn('Funções de IA indisponíveis: erro ao verificar o gateway do Kilo: ' + e.message);
        }
    }
}

function updateStatus(client) {
    const activities = [
        { name: 'Sistema de Tickets', type: 2 },
        { name: '𝙼𝚊𝚍𝚎 𝚋𝚢 𝚈𝟸𝚔_𝙽𝚊𝚝', type: 2 },
        { name: 'HostVille • BOT', type: 2 }
    ];
    let index = 0;
    setInterval(() => {
        client.user.setPresence({ activities: [{ name: activities[index % activities.length].name, type: activities[index % activities.length].type }], status: 'online' });
        index++;
    }, 10000);
}

module.exports = {
    name: 'clientReady',
    once: true,
    async execute(client) {
        // o client global e usado por varios managers (StaffLearner etc.)
        global.client = client;

        const PollManager = require('../managers/PollManager');
        PollManager.start(client);

        if (config.IMAGE_ANALYZER.ENABLED && !config.IMAGE_ANALYZER.CHANNEL_ID) {
            logWarn('⚠ IMAGE_ANALYZER.ENABLED=true sem CHANNEL_ID — feature desligada.');
            config.IMAGE_ANALYZER.ENABLED = false;
        }

        // Verificar se foi restart por comando
        const restartFlag = fs.existsSync('./temp/restart_flag.txt');
        if (restartFlag) {
            fs.unlinkSync('./temp/restart_flag.txt');
            console.log('🔄 Reiniciado por comando - sem salve');
        }

        const { createStatusFile } = require('../utils/crashLogger');
        createStatusFile();

        try {
            if (fs.existsSync(consoleDir)) {
                const crashLogs = fs.readdirSync(consoleDir).filter(f => f.startsWith('cause-fail(') && f.endsWith('.js'));
                for (const crashLog of crashLogs) {
                    try { fs.unlinkSync(path.join(consoleDir, crashLog)); } catch (err) {}
                }
            }
        } catch (err) {}

        setInterval(() => { createStatusFile(); }, 5 * 60 * 1000);

        logInfo('Testando banco de dados...');
        const testUserId = '__TEST_USER__';
        const testWord = '__TEST_WORD__';
        let passed = 0, failed = 0;

        try {
            // Avisos NÃO moram no Mongo (ficam em data/warnings.json), então
            // o smoke test do banco não os exercita. O teste do store local
            // é separado, logo abaixo, porque é o que garante que punição
            // está sendo persistida.
            // Palavras banidas: o registro é POR SERVIDOR agora. O teste
            // escreve no escopo de smoke e confere que some dele — não pode
            // mais usar o escopo global, que é onde a palavra-production
            // real mora.
            const escopoTeste = '__SMOKE__';
            const words = await db.getCustomWords(escopoTeste);
            if (Array.isArray(words)) passed++; else failed++;

            const addWord = await db.addCustomWord(escopoTeste, testWord);
            if (addWord === true) passed++; else failed++;

            await db.removeCustomWord(escopoTeste, testWord);
            const wordsAfter = await db.getCustomWords(escopoTeste);
            if (!wordsAfter.includes(testWord)) passed++; else failed++;

            const mon = await db.getMonitoringStatus('__TEST__');
            if (mon === true) passed++; else failed++;

            const links = await db.getLinkSettings('__TEST__');
            if (typeof links === 'object') passed++; else failed++;

            // Link settings tem que ser POR SERVIDOR: um admin de um servidor
            // mudando o filtro de todos era o bug do escopo global. O teste
            // grava num escopo de fumaça e o global não pode mudar.
            const globalAntes = JSON.stringify(await db.getLinkSettings());
            await db.setLinkSettings(escopoTeste, { deleteInvites: false, allowedDomains: ['exemplo.test'] });
            const localDepois = JSON.stringify(await db.getLinkSettings(escopoTeste));
            const globalDepois = JSON.stringify(await db.getLinkSettings());
            if (globalAntes === globalDepois
                && localDepois.includes('exemplo.test')
                && !localDepois.includes('"deleteInvites":true')) passed++;
            else {
                failed++;
                sendLog('❌ config de link não está isolada por servidor — admin de um servidor mexe em todos', 'error', 'system');
            }

            const feats = await db.getFeatures(escopoTeste);
            if (typeof feats === 'object') passed++; else failed++;

            const stats = await db.getStats();
            if (typeof stats === 'object') passed++; else failed++;

            if (typeof db.getConnection === 'function') passed++; else failed++;
            if (typeof db.getKnowledge === 'function') passed++; else failed++;
            if (typeof db.getTicket === 'function') passed++; else failed++;
            if (typeof db.addKnowledge === 'function') passed++; else failed++;
        } catch (e) {
            failed = 10;
        }

        // ═══════════════════════════════════════════════════════════════
        // SMOKE TEST DO STORE DE AVISOS  [arquivo local, não Mongo]
        // ═══════════════════════════════════════════════════════════════
        // Aviso é a única coisa do bot em que perder o registro significa
        // perder uma PUNICAÇÃO — a escada de mute/expulsão/banimento zera.
        // E é justamente a única que saiu do banco: ela dependia de rede,
        // e a rede do Termux já falhou. Então ela ganha smoke test
        // próprio, com escrita e leitura de verdade em disco.
        {
            const WarnStore = require('../utils/warnStore');
            const probeUser = '__TESTE_WARN_STORE__';
            const probeGuild = '__TESTE_GUILD__';
            let storeOk = true;
            try {
                WarnStore.clear(probeUser);           // começa limpo
                WarnStore.add(probeUser, { reason: 'teste', guildId: probeGuild });
                const lidos = WarnStore.get(probeUser, probeGuild);
                // tem que ler do DISCO, não do cache: só assim prova que
                // sobrevive a um restart de processo
                const emDisco = WarnStore._carregar()[`${probeGuild}:${probeUser}`];
                if (!Array.isArray(lidos) || lidos.length !== 1) storeOk = false;
                if (!Array.isArray(emDisco) || emDisco.length !== 1) storeOk = false;
                WarnStore.clear(probeUser);
                if (WarnStore.get(probeUser, probeGuild).length !== 0) storeOk = false;
            } catch (e) {
                storeOk = false;
                logError('Falha no smoke test do warnings.json: ' + e.message);
            }
            if (storeOk) passed++; else {
                failed++;
                sendLog('❌ data/warnings.json não está gravando/reading — aviso (punição) pode se perder', 'error', 'system');
            }
        }

        logInfo(`Persistência: ${passed} ok | ${failed} falhas (Mongo + data/warnings.json)`);

        await checkIA();
        await watchdogIA();

        // ERRO F (corrigido): isto forçava `monitoramento = true` em todo
        // servidor a cada boot. Quem desligasse a moderação pelo `!MonitorOff`
        // da DM ou pelo `/adm` recebia de volta um restart.
        //
        // O estado agora mora na chave `monitoramento` do FeatureRegistry, que
        // é a mesma que o painel desenha. Não se escreve nada aqui: o
        // default da chave JÁ é ligado, e qualquer desligamento feito pela
        // staff precisa sobreviver ao restart — que é a hora em que ele
        // importa.
        const Features = require('../managers/FeatureRegistry');
        await Features.aquecer();
        logInfo(`Monitoramento: ${client.guilds.cache.size} servidor(es) com chaves carregadas`);

        await StatsManager.loadStats();

        // O log de xingamento mora em disco local pelo mesmo motivo do
        // warnings.json: perder registro de moderação numa queda de rede é
        // perder a prova de quem foi punido. Falha aqui não impede o boot.
        try {
            const ModerationLog = require('../utils/ModerationLog');
            const d = ModerationLog.diagnostico();
            logInfo(`ModerationLog: ${d.registros} registro(s) em ${d.arquivo}`);
        } catch (e) {
            logWarn('ModerationLog indisponível: ' + e.message);
        }

        sendLog('✅ Bot online! ' + client.guilds.cache.size + ' servidores', 'success', 'system');
        logSuccess(`${config.BOT_NAME} online | ${client.guilds.cache.size} servidores`);

        if (client.guilds.cache.size > 0) {
            try {
                for (const guild of client.guilds.cache.values()) {
                    await guild.commands.set(commands);
                    logSuccess(`Comandos registrados em: ${guild.name}`);
                }
            } catch (error) {
                logWarn(`Erro ao registrar comandos: ${error.message}`);
            }
        }

        // ============================================
        // RESTAURAR SESSÕES DE TICKETS APÓS RESTART
        // ============================================
        try {
            const TicketManager = require('../managers/TicketManager');
            await TicketManager.restoreSessions(client);
            logInfo('Sessões de tickets ativos restauradas do registro');
        } catch (e) {
            logWarn('Erro ao restaurar sessões de tickets: ' + e.message);
        }

        ReportManager.scheduleDailyReport(client);
        updateStatus(client);

        // ============================================
        // AUTO-KB: minerar conversas e propor documentos
        // ============================================
        try {
            const { AutoKB } = require('../managers/AutoKB');
            AutoKB.start(client);
        } catch (e) {
            logWarn('Auto-KB não iniciou: ' + e.message);
        }

        setInterval(() => { runRoutineTest(client); }, 60 * 60 * 1000);
        setTimeout(() => { runRoutineTest(client); }, 5 * 60 * 1000);

        setInterval(() => { watchdogIA(); }, 2 * 60 * 1000);

        // AutoInteraction.startRandomInteractions(client);
        // console.log('💬 Interações aleatórias ativadas');

        // MemoryWatcher DESLIGADO na v6.0.0.
        // setInterval de 5s com query Mongo, IDs hardcoded, sem retry,
        // e StaffLearner criando pendings que ninguém executa.
        // Código preservado em managers/MemoryWatcher.js.
        // const MemoryWatcher = require('../managers/MemoryWatcher');
        // MemoryWatcher.start(client);
        // logSuccess('MemoryWatcher iniciado');

        // Reagenda locks que sobreviveram ao restart.
        const LockStore = require('../utils/lockStore');
        for (const l of LockStore.todos()) {
            const restante = l.expiresAt - Date.now();
            if (restante <= 0) require('../commands/mod/lock')._autoUnlock(l.canalId);
            else setTimeout(() => require('../commands/mod/lock')._autoUnlock(l.canalId), restante).unref?.();
        }

        const BatteryAlertManager = require('../managers/BatteryAlertManager');
        BatteryAlertManager.start(client);

        const QueueManager = require('../managers/QueueManager');
        QueueManager.start(client);
       logSuccess('Fila de respostas iniciada');

        // ============================================
        // ANTI-RAID (Protect): detecção + ban de raids
        // ============================================
        try {
            const AntiRaidManager = require('../managers/AntiRaidManager');
            await AntiRaidManager.start(client);
        } catch (e) {
            logWarn('Anti-Raid não iniciou: ' + e.message);
        }

        // ============================================
        // HONEYPOT (canal-armadilha): posta o aviso no canal isca
        // ============================================
        try {
            const HoneypotManager = require('../managers/HoneypotManager');
            await HoneypotManager.start(client);
        } catch (e) {
            logWarn('Honeypot não iniciou: ' + e.message);
        }

        // ============================================
        // SALVE AUTOMATICO: REMOVIDO
        // O envio estava comentado, mas a chamada ao modelo continuava
        // rodando a cada boot: gastava 1 request e, se falhasse, logava
        // "Erro ao mandar salve". Nao ha mais nenhuma chamada aqui.
        // ============================================

        console.log('');
    }
};
