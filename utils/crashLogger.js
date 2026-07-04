const fs = require('fs');
const path = require('path');
const { Logger } = require('./logger');

const consoleDir = path.join(__dirname, '..', 'console');
const statusFile = path.join(consoleDir, 'bot-status.js');

// Garantir que a pasta console existe
if (!fs.existsSync(consoleDir)) {
    fs.mkdirSync(consoleDir, { recursive: true });
}

// ============================================
// ARQUIVO DE STATUS DO BOT
// ============================================
function createStatusFile() {
    const now = new Date();
    const content = `// HostVille • BOT - Status File
// Atualizado: ${now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}

module.exports = {
    status: "online",
    message: "Bot is on service",
    startedAt: "${now.toISOString()}",
    startedAtBR: "${now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}",
    pid: ${process.pid}
};
`;
    try {
        fs.writeFileSync(statusFile, content);
    } catch (e) {
        // Tentar salvar em outro lugar se falhar
        try {
            fs.writeFileSync(path.join(__dirname, '..', 'bot-status.js'), content);
        } catch (e2) {}
    }
}

// ============================================
// EXTRAIR INFORMAÇÕES DO ERRO
// ============================================
function extractErrorInfo(error) {
    let file = 'Desconhecido';
    let line = 'N/A';
    let funcName = 'Desconhecida';
    
    if (error && error.stack) {
        const stackLines = error.stack.split('\n');
        for (const stackLine of stackLines) {
            // Pular a primeira linha (mensagem de erro)
            const match = stackLine.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/) || 
                         stackLine.match(/at\s+(.+?):(\d+):(\d+)/) ||
                         stackLine.match(/\((.+?):(\d+):(\d+)\)/);
            
            if (match) {
                if (match.length === 5) {
                    funcName = match[1].trim();
                    file = match[2].replace(process.cwd(), '').replace(/^[\/\\]/, '');
                    line = match[3];
                } else if (match.length === 4) {
                    file = match[1].replace(process.cwd(), '').replace(/^[\/\\]/, '');
                    line = match[2];
                }
                break;
            }
        }
    }
    
    let type = 'Unknown';
    if (error) {
        if (error.name) type = error.name;
        else if (error.code) type = error.code;
    }
    
    return { file, line, funcName, type };
}

// ============================================
// CRIAR LOG DE QUEDA
// ============================================
function createCrashLog(reason, error = null) {
    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, '0')}_${String(now.getMonth() + 1).padStart(2, '0')}_${now.getFullYear()}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    const logFileName = `cause-fail(${dateStr}_${timeStr}).js`;
    const logFilePath = path.join(consoleDir, logFileName);
    
    let errorDetails = [];
    
    if (error) {
        const info = extractErrorInfo(error);
        
        errorDetails.push(`Tipo: ${info.type}`);
        errorDetails.push(`Mensagem: ${error.message || 'Sem mensagem'}`);
        errorDetails.push(`Arquivo: ${info.file}`);
        errorDetails.push(`Linha: ${info.line}`);
        errorDetails.push(`Função: ${info.funcName}`);
        
        if (error.code) {
            errorDetails.push(`Código: ${error.code}`);
        }
        
        if (error.stack) {
            errorDetails.push('');
            errorDetails.push('Stack Trace:');
            errorDetails.push(error.stack);
        }
    }
    
    let reasonText = '';
    switch (reason) {
        case 'terminal':
            reasonText = 'Desligamento por terminal (CTRL+C / SIGINT)';
            break;
        case 'process_exit':
            reasonText = 'Processo encerrado (process.exit)';
            break;
        case 'crash':
            reasonText = 'Crash inesperado / Erro fatal';
            break;
        case 'uncaught_exception':
            reasonText = 'Exceção não capturada (uncaughtException)';
            break;
        case 'unhandled_rejection':
            reasonText = 'Promise rejeitada não tratada (unhandledRejection)';
            break;
        case 'token_error':
            reasonText = 'Erro de autenticação (Token inválido/expirado)';
            break;
        case 'connection_error':
            reasonText = 'Erro de conexão com Discord';
            break;
        default:
            reasonText = reason;
    }
    
    let logContent = '';
    logContent += '// ============================================\n';
    logContent += '// HostVille • BOT - Crash Report\n';
    logContent += '// ============================================\n';
    logContent += `// Data: ${now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n`;
    logContent += `// PID: ${process.pid}\n`;
    logContent += `// Motivo: ${reasonText}\n`;
    logContent += '// ============================================\n';
    logContent += '\n';
    logContent += 'module.exports = {\n';
    logContent += `    date: "${now.toISOString()}",\n`;
    logContent += `    dateBR: "${now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}",\n`;
    logContent += `    reason: "${reason}",\n`;
    logContent += `    reasonText: "${reasonText.replace(/"/g, '\\"')}",\n`;
    logContent += `    pid: ${process.pid},\n`;
    
    if (error) {
        const info = extractErrorInfo(error);
        logContent += '    error: {\n';
        logContent += `        type: "${info.type}",\n`;
        logContent += `        message: "${(error.message || 'Unknown').replace(/"/g, '\\"')}",\n`;
        logContent += `        file: "${info.file}",\n`;
        logContent += `        line: "${info.line}",\n`;
        logContent += `        function: "${info.funcName}",\n`;
        if (error.code) logContent += `        code: "${error.code}",\n`;
        logContent += '    },\n';
    }
    
    logContent += '};\n';
    
    try {
        fs.writeFileSync(logFilePath, logContent);
        console.log(`\n📄 Log de queda salvo: console/${logFileName}\n`);
    } catch (e) {
        try {
            fs.writeFileSync(path.join(__dirname, '..', logFileName), logContent);
            console.log(`\n📄 Log de queda salvo: ${logFileName}\n`);
        } catch (e2) {
            console.error('\n❌ NÃO FOI POSSÍVEL SALVAR O LOG DE QUEDA!\n');
            console.error(logContent);
        }
    }
    
    // Atualizar status para offline
    updateStatusFile('offline', reasonText);
}

// ============================================
// ATUALIZAR ARQUIVO DE STATUS
// ============================================
function updateStatusFile(status, message) {
    const now = new Date();
    const content = `// HostVille • BOT - Status File
// Atualizado: ${now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}

module.exports = {
    status: "${status}",
    message: "${message.replace(/"/g, '\\"')}",
    lastUpdate: "${now.toISOString()}",
    lastUpdateBR: "${now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}",
    pid: ${process.pid}
};
`;
    try {
        fs.writeFileSync(statusFile, content);
    } catch (e) {
        try {
            fs.writeFileSync(path.join(__dirname, '..', 'bot-status.js'), content);
        } catch (e2) {}
    }
}

// ============================================
// CONFIGURAR HANDLERS DE QUEDA
// ============================================
function setupCrashHandlers() {
    // Criar arquivo de status ao iniciar
    createStatusFile();
    
    // CTRL+C / Terminal
    process.on('SIGINT', () => {
        console.log('\n🛑 Sinal SIGINT recebido (CTRL+C)');
        createCrashLog('terminal');
        updateStatusFile('offline', 'Desligamento por terminal (CTRL+C)');
        process.exit(0);
    });
    
    // SIGTERM
    process.on('SIGTERM', () => {
        console.log('\n🛑 Sinal SIGTERM recebido');
        createCrashLog('terminal');
        updateStatusFile('offline', 'Desligamento por terminal (SIGTERM)');
        process.exit(0);
    });
    
    // Exceção não capturada
    process.on('uncaughtException', (error) => {
        Logger.error('Exceção não capturada', { error: error.message, stack: error.stack });
        console.log('\n💥 UNCAUGHT EXCEPTION - Salvando log de crash...');
        createCrashLog('uncaught_exception', error);
        updateStatusFile('offline', `Crash: ${error.message}`);
        console.error(error);
        process.exit(1);
    });
    
    // Promise rejeitada não tratada
    process.on('unhandledRejection', (error) => {
        Logger.error('Promise rejeitada não tratada', { error: error.message, stack: error.stack });
        console.log('\n⚠️ UNHANDLED REJECTION - Salvando log...');
        createCrashLog('unhandled_rejection', error);
        // Não encerra o processo para unhandledRejection, só loga
    });
    
    // Exit normal
    process.on('exit', (code) => {
        if (code !== 0) {
            console.log(`\n🛑 Processo encerrado com código ${code}`);
            // O log já foi criado pelo handler específico
        }
    });
    
    // Warning
    process.on('warning', (warning) => {
        if (warning.message && !warning.message.includes('Deprecation')) {
            console.log(`\n⚠️ WARNING: ${warning.message}`);
        }
    });
}

module.exports = { setupCrashHandlers, createCrashLog, createStatusFile };	
