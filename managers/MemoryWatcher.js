const Pending = require('../models/Pending');
const Memory = require('../models/Memory');
const db = require('../database/db');

class MemoryWatcher {

    static start(client) {
        console.log('🧠 MemoryWatcher iniciado (5s)');
        
        setInterval(async () => {
            try {
                const pendings = await Pending.find({ done: false }).sort({ createdAt: 1 });

                for (const task of pendings) {
                    console.log(`⚡ ${task.type} ${task.data?.command || ''}`);
                    
                    try {
                        await this.execute(task, client);
                        task.done = true;
                        task.executedAt = new Date();
                        console.log(`✅ ${task.result}`);
                    } catch (e) {
                        task.result = 'ERRO: ' + e.message;
                        console.error(`❌ ${e.message}`);
                    }
                    
                    await task.save();
                }
            } catch (e) {
                console.error('MemoryWatcher:', e.message);
            }
        }, 5000);
    }

    static async execute(task, client) {
        const { command, params, guildId } = task.data || {};

        switch (task.type) {
            case 'aprender':
                await db.addKnowledge(task.data.guildId, task.data.id, task.data.keywords, task.data.response);
                task.result = '✅ Conhecimento salvo!';
                break;

            case 'corrigir':
                if (task.data.removerConhecimento) {
                    await db.removeKnowledge(task.data.guildId, task.data.conhecimentoId);
                    task.result = '✅ Conhecimento removido!';
                }
                break;

            case 'comando':
                await this.executeCommand(client, task, command, params, guildId);
                break;

            case 'acao':
                await this.executeAction(client, task.data, guildId);
                task.result = '✅ Ação executada!';
                break;

            case 'responder':
                if (task.data.canalId && task.data.resposta) {
                    const channel = client.channels.cache.get(task.data.canalId);
                    if (channel) { await channel.send(task.data.resposta); task.result = '✅ Mensagem enviada!'; }
                }
                break;

            default:
                task.result = 'Tipo desconhecido';
        }
    }

    static async executeCommand(client, task, command, params, guildId) {
        const finalGuildId = guildId || '928614664840052757';
        const guild = client.guilds.cache.get(finalGuildId);
        const defaultChannelId = '1392306454756720742';
        const defaultChannel = client.channels.cache.get(defaultChannelId);
        const args = params ? params.split(' ') : [];

        try {
            switch (command) {
                case 'ping':
                    task.result = `🏓 Pong! Latência: ${client.ws.ping}ms`;
                    break;

                case 'uptime':
                    const uptime = Math.floor(client.uptime / 1000);
                    const h = Math.floor(uptime / 3600);
                    const m = Math.floor((uptime % 3600) / 60);
                    const s = uptime % 60;
                    task.result = `⏱️ Uptime: ${h}h ${m}m ${s}s`;
                    break;

                case 'stats':
                    task.result = `📊 Servidores: ${client.guilds.cache.size} | Usuários: ${client.users.cache.size}`;
                    break;

                case 'servidor':
                    const g = guild || client.guilds.cache.first();
                    task.result = g ? `🏠 ${g.name} | 👥 ${g.memberCount} membros` : 'Servidor não encontrado';
                    break;

                case 'bot':
                    task.result = `🤖 ${client.user.tag} | 🟢 Online | 🧠 Groq Llama 3.3`;
                    break;

                case 'say':
                    const msg = args.join(' ');
                    if (defaultChannel && msg) { await defaultChannel.send(msg); task.result = `✅ Mensagem enviada!`; }
                    break;

                case 'anuncio':
                    const msgAnuncio = args.join(' ');
                    if (defaultChannel && msgAnuncio) { await defaultChannel.send({ content: '@everyone ' + msgAnuncio }); task.result = `✅ Anúncio enviado!`; }
                    break;

                case 'modo':
                    const mode = args[0];
                    if (['normal', 'savage', 'respeitoso', 'hacker', 'boiola'].includes(mode)) {
                        await db.updateConfig(finalGuildId, { botMode: mode });
                        task.result = `✅ Modo alterado para: ${mode}`;
                    } else {
                        task.result = `❌ Modo inválido: ${mode}`;
                    }
                    break;

                case 'voicemode':
                    await db.updateConfig(finalGuildId, { voiceMode: args[0] === 'on' || args[0] === 'ativar' });
                    task.result = `🔊 Voice mode: ${args[0] === 'on' ? 'ATIVADO' : 'DESATIVADO'}`;
                    break;

                case 'mencionar':
                    const userId = args[0]?.replace(/[<@!>]/g, '');
                    if (defaultChannel && userId) { await defaultChannel.send(`<@${userId}> foi mencionado! 👋`); task.result = `✅ Usuário mencionado!`; }
                    break;

                case 'autointervalo':
                    const timeStr = args[0] || '20m';
                    let minutes = 20;
                    if (timeStr.includes('s')) minutes = parseInt(timeStr) / 60;
                    else if (timeStr.includes('m')) minutes = parseInt(timeStr);
                    else if (timeStr.includes('h')) minutes = parseInt(timeStr) * 60;
                    await db.updateConfig(finalGuildId, { autoInterval: Math.max(1, minutes) });
                    task.result = `✅ Intervalo: ${Math.max(1, minutes)}min`;
                    break;

                case 'automsg':
                    await db.updateConfig(finalGuildId, { autoMsgEnabled: args[0] === 'on' || args[0] === 'ativar' });
                    task.result = `📢 Mensagens automáticas: ${args[0] === 'on' ? 'ATIVADAS' : 'DESATIVADAS'}`;
                    break;

                default:
                    task.result = `Comando não reconhecido: /${command}`;
            }
        } catch (e) {
            task.result = `❌ Erro: ${e.message}`;
        }
    }

    static async executeAction(client, data, guildId) {
        if (data.guildId && data.userId && data.acao) {
            const guild = client.guilds.cache.get(data.guildId);
            if (guild) {
                const member = await guild.members.fetch(data.userId).catch(() => null);
                if (member) {
                    if (data.acao === 'mute') await member.timeout(data.tempo || 600000);
                    if (data.acao === 'kick') await member.kick();
                    if (data.acao === 'ban') await member.ban();
                }
            }
        }
    }
}

module.exports = MemoryWatcher;