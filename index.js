const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { logInfo, logError, logWarn } = require('./utils/logger');
const { setupCrashHandlers } = require('./utils/crashLogger');

// ============================================
// CONFIGURAÇÃO DO CLIENTE
// ============================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageTyping
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User],
});

// ============================================
// TIMEOUT DE CONEXÃO DO DISCORD
// ============================================
// A rede do Termux é LENTA para Establishar TLS: medido, o handshake com
// discord.com leva ~17s. O undici (usado pelo @discordjs/rest) aborta o
// connect em 10s, então o login falhava SEMPRE com
// "Connect Timeout Error (attempted address: discord.com:443, timeout:
// 10000ms)" — e o bot morria depois de 8 tentativas.
//
// É o mesmo problema (e a mesma solução) do httpDispatcher do projeto: o
// mesmo Agent, com connect de 45s, serve as chamadas de IA e as do Discord.
try {
    const { dispatcher } = require('./utils/httpDispatcher');
    const agent = dispatcher();
    if (agent) client.rest.setAgent(agent);
} catch (e) {
    logWarn('Não foi possível configurar o connect timeout do Discord: ' + e.message);
}

client.commands = new Collection();

// ============================================
// GARANTIR QUE O BANCO DE DADOS EXISTE
// ============================================
const dbPath = path.join(__dirname, 'db.json');
if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({
        warnings: {},
        customWords: [],
        linkSettings: { deleteInvites: true, allowedDomains: [] },
        stats: { messagesDeleted: 0, warnsGiven: 0, membersJoined: 0, membersLeft: 0 },
        monitoring: {}
    }, null, 2));
    console.log('✅ Arquivo db.json criado com estrutura inicial');
}

// ============================================
// CARREGAR EVENTOS
// ============================================
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const eventModule = require(filePath);
    
    const events = Array.isArray(eventModule) ? eventModule : [eventModule];
    
    for (const event of events) {
        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args));
        } else {
            client.on(event.name, (...args) => event.execute(...args));
        }
    }
}

// ============================================
// TRATAMENTO DE ERROS
// ============================================
// NOTA: o handler de `uncaughtException` (e a decisão de sair ou não) mora
// em utils/crashLogger.js, que é importado mais acima e portanto registra o
// listener primeiro. Lá o erro operacional — rede, DNS, banco, timeout — é
// registrado e o processo SEGUE VIVO, com um contador de rajada. Aqui só
// tratamos o que sobra: o `unhandledRejection`, que por padrão do Node não
// derruba o processo mas precisa ficar registrado.

function ehOperacional(error) {
    const m = String((error && error.message) || '');
    return /EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|buffering timed out|connectTimeoutMS|MongooseServerSelectionError|getaddrinfo|network|timeout/i.test(m);
}

process.on('unhandledRejection', (error) => {
    if (ehOperacional(error)) {
        logWarn(`Falha operacional (promise, bot no ar): ${error.message}`);
        return;
    }
    logError(`Erro não tratado: ${error.message}`);
    console.error(error);
});

// ============================================
// CONFIGURAR HANDLERS DE CRASH (LOG DE QUEDA)
// ============================================
setupCrashHandlers();

// ============================================
// INICIALIZAÇÃO
// ============================================
logInfo(`${config.BOT_NAME} v${config.BOT_VERSION} iniciando | adm:${config.ADMIN_ROLES.length} staff:${config.STAFF_USER_ID.length} log:${config.LOG_CHANNEL_ID || '-'}`);

/**
 * Login com retentativa.
 *
 * A rede do Termux oscila: o DNSResolve falhou com "Connect Timeout Error" e
 * o processo morria na hora (process.exit(1)), sem chance de reconectar. Num
 * celular a internet cai e volta o tempo todo; matar o bot na primeira
 * oscilação deixava ele fora até alguém notar e subir de novo na mão.
 *
 * Erro de TOKEN invalido não e problema de rede e nao adianta repetir:
 * nesses caso o bot avisa e para, para nao ficar em loop eterno.
 */
const TENTATIVAS_LOGIN = 8;
const ESPERA_LOGIN_MS = 10000;

async function entrar(tentativa = 1) {
    try {
        await client.login(config.TOKEN);
    } catch (error) {
        const rede = /timeout|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|getaddrinfo|socket/i.test(error.message || '');
        logError(`Erro ao fazer login (tentativa ${tentativa}/${TENTATIVAS_LOGIN}): ${error.message}`);

        if (!rede) {
            // Token invalido / sem permissao: repetir nao resolve.
            logError('Nao parece problema de rede (token invalido ou sem permissao). Encerrando.');
            process.exit(1);
        }
        if (tentativa >= TENTATIVAS_LOGIN) {
            logError(`Falhei ${TENTATIVAS_LOGIN}x por falta de rede. Encerrando.`);
            process.exit(1);
        }
        logWarn(`Rede instavel. Nova tentativa em ${ESPERA_LOGIN_MS / 1000}s...`);
        await new Promise(r => setTimeout(r, ESPERA_LOGIN_MS));
        return entrar(tentativa + 1);
    }
}

entrar();