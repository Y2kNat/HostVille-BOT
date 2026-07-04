const config = require('../config');
const db = require('../database/db');
const fs = require('fs');
const path = require('path');
const StatsManager = require('../managers/StatsManager');
const ReportManager = require('../managers/ReportManager');
const AutoInteraction = require('../managers/AutoInteraction');
const { logSuccess, logInfo, logWarn, logError } = require('../utils/logger');
const Groq = require('groq-sdk');

const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });

const commands = [
    require('../commands/mod/warn').data,
    require('../commands/mod/warnings').data,
    require('../commands/mod/clearwarns').data,
    require('../commands/mod/kick').data,
    require('../commands/mod/ban').data,
    require('../commands/mod/timeout').data,
    require('../commands/mod/purge').data,
    require('../commands/config/filter').data,
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
    require('../commands/ticket/ticketsetup').data
];

const consoleDir = path.join(__dirname, '..', 'console');

function runRoutineTest(client) {
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
    rCheck('ENV: GROQ_API_KEY', !!process.env.GROQ_API_KEY, 'configurado');
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

function updateStatus(client) {
    const activities = [
        { name: '🎫 Sistema de Tickets', type: 2 },
        { name: '🤖 Atendimento com IA', type: 2 },
        { name: '🌆 Boas-vindas Interativas', type: 2 },
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
                    try { fs.unlinkSync(path.join(consoleDir, crashLog)); console.log(`🗑️ Log removido: ${crashLog}`); } catch (err) {}
                }
            }
        } catch (err) {}

        setInterval(() => { createStatusFile(); }, 5 * 60 * 1000);
        
        console.log('\n🧪 Testando banco de dados...\n');
        const testUserId = '__TEST_USER__';
        const testWord = '__TEST_WORD__';
        let passed = 0, failed = 0;
        
        try {
            const warns = await db.getWarnings(testUserId);
            if (Array.isArray(warns)) { console.log('   ✅ getWarnings'); passed++; } else { console.log('   ❌ getWarnings'); failed++; }
            
            const addWarn = await db.addWarning(testUserId, { reason: 'Teste', timestamp: Date.now() });
            if (addWarn && addWarn.length > 0) { console.log('   ✅ addWarning'); passed++; } else { console.log('   ❌ addWarning'); failed++; }
            
            await db.clearWarnings(testUserId);
            const warnsAfter = await db.getWarnings(testUserId);
            if (warnsAfter.length === 0) { console.log('   ✅ clearWarnings'); passed++; } else { console.log('   ❌ clearWarnings'); failed++; }
            
            const words = await db.getCustomWords();
            if (Array.isArray(words)) { console.log('   ✅ getCustomWords'); passed++; } else { console.log('   ❌ getCustomWords'); failed++; }
            
            const addWord = await db.addCustomWord(testWord);
            if (addWord === true) { console.log('   ✅ addCustomWord'); passed++; } else { console.log('   ❌ addCustomWord'); failed++; }
            
            await db.removeCustomWord(testWord);
            const wordsAfter = await db.getCustomWords();
            if (!wordsAfter.includes(testWord)) { console.log('   ✅ removeCustomWord'); passed++; } else { console.log('   ❌ removeCustomWord'); failed++; }
            
            const mon = await db.getMonitoringStatus('__TEST__');
            if (mon === true) { console.log('   ✅ getMonitoringStatus'); passed++; } else { console.log('   ❌ getMonitoringStatus'); failed++; }
            
            const links = await db.getLinkSettings();
            if (typeof links === 'object') { console.log('   ✅ getLinkSettings'); passed++; } else { console.log('   ❌ getLinkSettings'); failed++; }
            
            const stats = await db.getStats();
            if (typeof stats === 'object') { console.log('   ✅ getStats'); passed++; } else { console.log('   ❌ getStats'); failed++; }
            
            if (typeof db.getConnection === 'function') { console.log('   ✅ getConnection'); passed++; } else { console.log('   ❌ getConnection'); failed++; }
            if (typeof db.getKnowledge === 'function') { console.log('   ✅ getKnowledge'); passed++; } else { console.log('   ❌ getKnowledge'); failed++; }
            if (typeof db.getTicket === 'function') { console.log('   ✅ getTicket'); passed++; } else { console.log('   ❌ getTicket'); failed++; }
            if (typeof db.addKnowledge === 'function') { console.log('   ✅ addKnowledge'); passed++; } else { console.log('   ❌ addKnowledge'); failed++; }
        } catch (e) {
            console.log(`   ❌ Erro nos testes: ${e.message}`);
            failed = 13;
        }
        
        console.log(`\n🧪 Resultado: ${passed} ✅ | ${failed} ❌\n`);
        
        for (const guild of client.guilds.cache.values()) {
            await db.setMonitoringStatus(guild.id, true);
        }
        logInfo('Monitoramento inicializado');
        await StatsManager.loadStats();
        
        console.log('='.repeat(50));
        console.log(`  ✅️ HostVille • BOT ONLINE!`);
        console.log(`  🤖 ${client.user.tag} | ${client.guilds.cache.size} servidores`);
        console.log('='.repeat(50));
        
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
        
        console.log('\n  🎫 TICKETS: /ticket-config | /ticket-setup');
        console.log('  🤖 IA: Groq (Llama 3.3 70B)');
        console.log('  💬 Chat: HvBot <pergunta>');
        console.log('  🌆 Boas-vindas interativas\n');
        
        ReportManager.scheduleDailyReport(client);
        updateStatus(client);
        
        setInterval(() => { runRoutineTest(client); }, 60 * 60 * 1000);
        setTimeout(() => { runRoutineTest(client); }, 5 * 60 * 1000);
        
        AutoInteraction.startRandomInteractions(client);
        console.log('💬 Interações aleatórias ativadas');
        
        const MemoryWatcher = require('../managers/MemoryWatcher');
        MemoryWatcher.start(client);
        console.log('🧠 MemoryWatcher iniciado (5s)');
        
        // ============================================
        // SALVE QUANDO LIGAR (SÓ SE NÃO FOR RESTART)
        // ============================================
        if (!restartFlag) {
            try {
                const guilds = client.guilds.cache.filter(g => {
                    const conn = db.getConnection(g.id);
                    return conn && !conn.isStaffServer;
                });

                for (const [id, guild] of guilds) {
                    const channel = guild.channels.cache.find(c => 
                        c.id === '1392306454756720742' &&
                        c.permissionsFor(guild.members.me).has('SendMessages')
                    );

                    if (channel) {
                        const completion = await groqClient.chat.completions.create({
                            model: 'llama-3.3-70b-versatile',
                            messages: [{
                                role: 'system',
                                content: 'Você é o HostBot da HostVille. Acabou de ligar. Mande um salve criativo e brasileiro. Máximo 2 linhas. Use gírias. ÚNICO.'
                            }],
                            temperature: 1.0,
                            max_tokens: 80
                        });

                        const salve = completion.choices[0]?.message?.content?.trim();
                        if (salve) {
                            await channel.send({ content: salve });
                            console.log(`👋 Salve em #${channel.name}`);
                        }
                    }
                }
            } catch (error) {
                console.log('Erro ao mandar salve:', error.message);
            }
        }
        
        console.log('');
    }
};