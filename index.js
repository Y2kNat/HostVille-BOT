const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { logInfo, logError } = require('./utils/logger');
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
process.on('unhandledRejection', (error) => {
    logError(`Erro não tratado: ${error.message}`);
    console.error(error);
});

process.on('uncaughtException', (error) => {
    logError(`Exceção não tratada: ${error.message}`);
    console.error(error);
    process.exit(1);
});

// ============================================
// CONFIGURAR HANDLERS DE CRASH (LOG DE QUEDA)
// ============================================
setupCrashHandlers();

// ============================================
// INICIALIZAÇÃO
// ============================================
console.log('='.repeat(60));
console.log('🚀 HostVille • BOT v5.0.0 - Moderação Completa');
console.log('='.repeat(60));
console.log(`🔧 Cargos Admin: ${config.ADMIN_ROLES.length}`);
console.log(`👥 Staff IDs: ${config.STAFF_USER_ID.length}`);
console.log(`📊 LOG_CHANNEL_ID: ${config.LOG_CHANNEL_ID || 'NÃO CONFIGURADO'}`);
console.log('='.repeat(60));

client.login(config.TOKEN).catch(error => {
    logError(`Erro ao fazer login: ${error.message}`);
    process.exit(1);
});