const db = require('../database/db');
const BotModes = require('./BotModes');
const DynamicCommands = require('./DynamicCommands');
const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

class AdminChatManager {

    static isAdminCommand(message) {
        const ownerId = process.env.OWNER_ID;
        const conn = db.getConnection(message.guild?.id);
        const isStaff = message.member?.roles?.cache?.has(conn?.staffRoleId);
        
        if (message.author.id !== ownerId && !isStaff) return false;

        const content = message.content.toLowerCase();
        return content.startsWith('hvbot admin') || content.startsWith('hostbot admin');
    }

    static async processAdminCommand(message) {
        const ownerId = process.env.OWNER_ID;
        const conn = db.getConnection(message.guild?.id);
        const isStaff = message.member?.roles?.cache?.has(conn?.staffRoleId);

        if (message.author.id !== ownerId && !isStaff) {
            return message.reply({ content: '❌ Apenas DONO ou STAFF podem usar este comando.' });
        }

        const content = message.content
            .replace(/hvbot admin/gi, '')
            .replace(/hostbot admin/gi, '')
            .trim();

        // COMANDOS PERSONALIZADOS - SILENCIAR
        if (content.includes('não deixe') || content.includes('nao deixe') || content.includes('silenciar') || content.includes('mute')) {
            const userMatch = content.match(/<@(\d+)>/);
            const userId = userMatch ? userMatch[1] : null;
            if (!userId) return message.reply({ content: '❌ Mencione o usuário!' });

            const guildConfig = db.getConnection(message.guild.id) || {};
            if (!guildConfig.mutedUsers) guildConfig.mutedUsers = [];
            if (!guildConfig.mutedUsers.includes(userId)) {
                guildConfig.mutedUsers.push(userId);
                db.saveConnection(message.guild.id, guildConfig);
            }
            await message.reply({ content: `🔇 <@${userId}> foi **silenciado**! 🤫` });
            return true;
        }

        // DEIXE FALAR
        if (content.includes('deixe falar') || content.includes('deixa falar') || content.includes('desmutar') || content.includes('unmute')) {
            const userMatch = content.match(/<@(\d+)>/);
            const userId = userMatch ? userMatch[1] : null;
            if (!userId) return message.reply({ content: '❌ Mencione o usuário!' });

            const guildConfig = db.getConnection(message.guild.id) || {};
            if (guildConfig.mutedUsers) {
                guildConfig.mutedUsers = guildConfig.mutedUsers.filter(id => id !== userId);
                db.saveConnection(message.guild.id, guildConfig);
            }
            await message.reply({ content: `🔊 <@${userId}> pode voltar a falar!` });
            return true;
        }

        // LISTAR SILENCIADOS
        if (content.includes('silenciados') || content.includes('mutados') || content.includes('lista mute')) {
            const guildConfig = db.getConnection(message.guild.id) || {};
            const muted = guildConfig.mutedUsers || [];
            if (muted.length === 0) return message.reply({ content: '✅ Ninguém está silenciado!' });
            let list = '🔇 **Usuários Silenciados:**\n';
            muted.forEach(id => { list += `• <@${id}>\n`; });
            await message.reply({ content: list });
            return true;
        }

        // BANIR PALAVRA
        if (content.includes('banir palavra') || content.includes('proibir palavra')) {
            const word = content.replace(/banir palavra|proibir palavra/gi, '').trim();
            if (!word) return message.reply({ content: '❌ Diga a palavra!' });
            db.addCustomWord(word);
            await message.reply({ content: `🚫 Palavra **"${word}"** banida!` });
            return true;
        }

        // LIBERAR PALAVRA
        if (content.includes('liberar palavra') || content.includes('permitir palavra')) {
            const word = content.replace(/liberar palavra|permitir palavra/gi, '').trim();
            if (!word) return message.reply({ content: '❌ Diga a palavra!' });
            db.removeCustomWord(word);
            await message.reply({ content: `✅ Palavra **"${word}"** liberada!` });
            return true;
        }

        // MODO VOZ / MODO TEXTO
        if (content.includes('voicemode') || content.includes('voice mode') || content.includes('modo voz')) {
            const guildConfig = db.getConnection(message.guild.id) || {};
            guildConfig.voiceMode = true;
            db.saveConnection(message.guild.id, guildConfig);
            await message.reply({ content: '🔊 **MODO VOZ ATIVADO!**\nTodas as respostas serão em áudio!\nUse `HvBot admin textmode` para voltar.' });
            return true;
        }

        if (content.includes('textmode') || content.includes('text mode') || content.includes('modo texto')) {
            const guildConfig = db.getConnection(message.guild.id) || {};
            guildConfig.voiceMode = false;
            db.saveConnection(message.guild.id, guildConfig);
            await message.reply({ content: '📝 **MODO TEXTO ATIVADO!**\nRespostas normais em texto.' });
            return true;
        }

        // SELECIONAR VOZ
        if (content.includes('set voice') || content.includes('escolher voz') || content.includes('selecionar voz')) {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_voice')
                .setPlaceholder('🎙️ Escolha a voz do bot...')
                .addOptions(
                    { label: 'Padrão (Google)', value: 'default', emoji: '🔊' },
                    { label: 'Antonio (Homem Adulto)', value: 'antonio', emoji: '👨' },
                    { label: 'Francisca (Mulher Adulta)', value: 'francisca', emoji: '👩' },
                    { label: 'Thalita (Mulher Jovem)', value: 'thalita', emoji: '👧' },
                    { label: 'Giovanna (Jovem)', value: 'giovanna', emoji: '💁' },
                    { label: 'Fabio (Homem)', value: 'fabio', emoji: '🧔' },
                    { label: 'Humberto (Homem)', value: 'humberto', emoji: '👴' },
                    { label: 'Leticia (Mulher)', value: 'leticia', emoji: '👩‍💼' },
                    { label: 'Manuela (Mulher)', value: 'manuela', emoji: '👩‍🦰' },
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);
            await message.reply({ content: '🎙️ **Escolha a voz do bot:**', components: [row] });
            return true;
        }

        // MUDAR MODO DO BOT
        if (content.includes('modo') || content.includes('mode')) {
            if (content.includes('hacker')) { BotModes.setMode(message.guild.id, 'hacker'); await message.reply({ content: '💻 **MODO HACKER ATIVADO!**' }); return true; }
            if (content.includes('savage') || content.includes('xinga')) { BotModes.setMode(message.guild.id, 'savage'); await message.reply({ content: '🔥 **MODO SAVAGE ATIVADO!**' }); return true; }
            if (content.includes('respeitoso') || content.includes('educado')) { BotModes.setMode(message.guild.id, 'respeitoso'); await message.reply({ content: '🤝 **MODO RESPEITOSO ATIVADO!**' }); return true; }
            if (content.includes('boiola') || content.includes('bicha')) { BotModes.setMode(message.guild.id, 'boiola'); await message.reply({ content: '💅 **MODO BOIOLA ATIVADO!**' }); return true; }
            if (content.includes('padrão') || content.includes('padrao') || content.includes('original')) { BotModes.setMode(message.guild.id, 'normal'); await message.reply({ content: '🎭 **MODO NORMAL ATIVADO!**' }); return true; }

            const currentMode = BotModes.getMode(message.guild.id);
            let modesList = '🎭 **Modos disponíveis:**\n';
            for (const [key, mode] of Object.entries(BotModes.MODES)) {
                modesList += `\n• \`${key}\` - ${mode.name}: ${mode.description}`;
            }
            modesList += `\n\n📌 **Atual:** ${currentMode.name}\nUse: \`HvBot admin modo <nome>\``;
            await message.reply({ content: modesList });
            return true;
        }

        // ESTATÍSTICAS
        if (content.includes('stats') || content.includes('estatisticas')) {
            const stats = db.getTicketsStats ? db.getTicketsStats() : { total: 0, active: 0 };
            const knowledge = db.getKnowledge(message.guild.id);
            const mode = BotModes.getMode(message.guild.id);
            const guildConfig = db.getConnection(message.guild.id) || {};
            const mutedCount = (guildConfig.mutedUsers || []).length;
            
            let resposta = '📊 **Estatísticas:**\n';
            resposta += `🔢 Tickets: **${stats.total || 0}** | 🟢 Ativos: **${stats.active || 0}**\n`;
            resposta += `🧠 Conhecimentos: **${Object.keys(knowledge).length}**\n`;
            resposta += `🔇 Silenciados: **${mutedCount}**\n`;
            resposta += `🎭 Modo: **${mode.name}**\n`;
            resposta += `🔊 Voice mode: **${guildConfig.voiceMode ? 'ON' : 'OFF'}**\n`;
            await message.reply({ content: resposta });
            return true;
        }

        // LISTAR CONHECIMENTO
        if (content.includes('listar') || content.includes('respostas') || content.includes('conhecimento')) {
            const knowledge = db.getKnowledge(message.guild.id);
            const entries = Object.entries(knowledge);
            if (entries.length === 0) return message.reply({ content: '📭 Nenhuma resposta aprendida.' });
            let resposta = '🧠 **Respostas Aprendidas:**\n';
            for (const [id, entry] of entries.slice(0, 10)) {
                resposta += `\n🆔 \`${id}\`\n🔑 ${entry.keywords.slice(0, 5).join(', ')}\n💬 ${entry.response.substring(0, 100)}...\n`;
            }
            if (entries.length > 10) resposta += `\n...e mais ${entries.length - 10}`;
            await message.reply({ content: resposta });
            return true;
        }

        // REMOVER CONHECIMENTO
        if (content.includes('remover') || content.includes('deletar') || content.includes('apagar')) {
            const id = content.replace(/remover|deletar|apagar/gi, '').trim();
            if (!id) return message.reply({ content: '❌ Use: `HvBot admin remover <id>`' });
            let removed = db.removeKnowledge(message.guild.id, id);
            const conn = db.getConnection(message.guild.id);
            if (conn && conn.communityGuildId) db.removeKnowledge(conn.communityGuildId, id);
            if (removed) await message.reply({ content: `🗑️ Resposta \`${id}\` removida!` });
            else await message.reply({ content: `❌ Resposta \`${id}\` não encontrada.` });
            return true;
        }

        // CONEXÃO
        if (content.includes('conexao') || content.includes('conexão') || content.includes('config')) {
            const conn = db.getConnection(message.guild.id);
            if (!conn) return message.reply({ content: '❌ Nenhuma conexão configurada.' });
            let resposta = '🔗 **Conexão:**\n';
            resposta += `🏠 ${conn.communityGuildName}\n🏢 ${conn.staffGuildName}\n`;
            await message.reply({ content: resposta });
            return true;
        }

        // CRIAR COMANDO DINÂMICO
        if (content.includes('criar comando') || content.includes('novo comando')) {
            const match = content.match(/comando\s+[!\/]?(\S+)\s+(?:que\s+)?responde\s+[""](.+?)[""]/i);
            if (!match) return message.reply({ content: '❌ Formato: `HvBot admin criar comando /nome que responde "mensagem"`' });
            const cmdName = match[1].toLowerCase();
            const response = match[2];
            await DynamicCommands.create(message.guild.id, cmdName, response);
            await message.reply({ content: `✅ Comando \`/${cmdName}\` criado!\n💬 ${response}` });
            return true;
        }

        // DELETAR COMANDO DINÂMICO
        if (content.includes('deletar comando') || content.includes('remover comando')) {
            const match = content.match(/(?:deletar|remover)\s+comando\s+[!\/]?(\S+)/i);
            if (!match) return message.reply({ content: '❌ Use: `HvBot admin deletar comando /nome`' });
            const cmdName = match[1].toLowerCase();
            const deleted = await DynamicCommands.delete(message.guild.id, cmdName);
            if (deleted) await message.reply({ content: `🗑️ Comando \`/${cmdName}\` deletado!` });
            else await message.reply({ content: `❌ Comando \`/${cmdName}\` não encontrado.` });
            return true;
        }

        // LISTAR COMANDOS DINÂMICOS
        if (content.includes('comandos dinamicos') || content.includes('comandos dinâmicos') || content.includes('meus comandos')) {
            const commands = DynamicCommands.list(message.guild.id);
            if (commands.length === 0) return message.reply({ content: '📭 Nenhum comando dinâmico.' });
            let lista = '📋 **Comandos Dinâmicos:**\n';
            commands.forEach(cmd => { lista += `\n/${cmd.name} - Usos: ${cmd.uses}\n💬 ${cmd.response}...\n`; });
            await message.reply({ content: lista });
            return true;
        }

        // ENSINAR CASO ESPECÍFICO
        if (content.includes('caso o usuário') || content.includes('caso o usuario')) {
            const userIdMatch = content.match(/<@(\d+)>/);
            const userId = userIdMatch ? userIdMatch[1] : null;
            const userNameMatch = content.match(/com usu[áa]rio\s+(\S+)/i);
            const userName = userNameMatch ? userNameMatch[1] : null;
            let keywords = [], response = '';
            const quotes = content.match(/[""](.+?)[""]/g);
            if (quotes && quotes.length >= 2) {
                keywords = quotes[0].replace(/[""]/g, '').toLowerCase().replace(/[?.,!?¿¡]/g, '').split(' ').filter(w => w.length > 2);
                response = quotes[1].replace(/[""]/g, '');
            } else return message.reply({ content: '❌ Formato inválido.' });
            if (keywords.length === 0 || !response) return message.reply({ content: '❌ Formato inválido.' });
            if (userId || userName) { keywords.push(userId || userName); keywords.push('especial'); }
            const entryId = (userName || userId || 'especial').replace(/[^a-z0-9_]/g, '_').substring(0, 20);
            let finalId = entryId, counter = 1;
            const knowledge = db.getKnowledge(message.guild.id);
            while (knowledge[finalId]) { finalId = `${entryId}_${counter}`; counter++; }
            db.addKnowledge(message.guild.id, finalId, keywords, response);
            const conn = db.getConnection(message.guild.id);
            if (conn && conn.communityGuildId && conn.communityGuildId !== message.guild.id) db.addKnowledge(conn.communityGuildId, finalId, keywords, response);
            await message.reply({ content: `✅ **Ensinado!**\n🆔 \`${finalId}\`\n💬 ${response}` });
            return true;
        }

        // ENSINAR NORMAL
        if (content.includes('quando alguém perguntar') || content.includes('se alguem perguntar') || content.includes('ensinar')) {
            let keywords = [], response = '';
            const quotes = content.match(/[""](.+?)[""]/g);
            if (quotes && quotes.length >= 2) {
                keywords = quotes[0].replace(/[""]/g, '').toLowerCase().replace(/[?.,!?¿¡]/g, '').split(' ').filter(w => w.length > 3);
                response = quotes[1].replace(/[""]/g, '');
            }
            if (keywords.length === 0 || !response) return message.reply({ content: '❌ Formato: `HvBot admin quando alguém perguntar "..." você deve "..."`' });
            const entryId = keywords[0].replace(/[^a-z0-9_]/g, '_').substring(0, 30);
            let finalId = entryId, counter = 1;
            const knowledge = db.getKnowledge(message.guild.id);
            while (knowledge[finalId]) { finalId = `${entryId}_${counter}`; counter++; }
            db.addKnowledge(message.guild.id, finalId, keywords, response);
            const conn = db.getConnection(message.guild.id);
            if (conn && conn.communityGuildId && conn.communityGuildId !== message.guild.id) db.addKnowledge(conn.communityGuildId, finalId, keywords, response);
            await message.reply({ content: `✅ **Ensinado!**\n🆔 \`${finalId}\`\n🔑 ${keywords.join(', ')}\n💬 ${response}` });
            return true;
        }

        // HELP
        await message.reply({ 
            content: `📋 **Comandos Admin:**\n\n🎭 **Modos:** modo <hacker|savage|respeitoso|boiola|normal>\n🔊 **Voz:** voicemode | textmode | set voice\n🔇 **Silenciar:** não deixe @user falar | deixe @user falar | silenciados\n🚫 **Palavras:** banir palavra | liberar palavra\n🧠 **Ensinar:** quando alguém perguntar "..." você deve "..."\n📋 **Dinâmicos:** criar comando | deletar comando | comandos dinamicos\n📊 **Stats:** stats\n📋 **Listar:** listar | remover <id>\n🔗 **Conexão:** conexao`
        });
        return true;
    }
}

module.exports = AdminChatManager;