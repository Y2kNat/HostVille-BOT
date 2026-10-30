const kilo = require('./KiloClient');
const db = require('../database/db');
const Memory = require('../models/Memory');
const Pending = require('../models/Pending');
const TicketManager = require('./TicketManager');
const { isAdmin } = require('../utils/permissions');

class StaffLearner {

    static LEARN_CHANNEL = '1519076713395519510';

    static async process(message) {
        if (message.channel.id !== this.LEARN_CHANNEL) return false;
        if (message.author.bot) return false;

        // Chave `canal_estudo` do /adm. Sem ela o canal volta a ser um canal
        // comum: nada é aprendido e nada é executado a partir do que é
        // escrito nele.
        try {
            const Features = require('./FeatureRegistry');
            if (!Features.ligadoSync('canal_estudo')) return false;
        } catch (e) { /* registry indisponível: mantém o comportamento */ }

        const msg = message.content.trim();
        if (!msg || msg.length < 3) return false;

        await message.channel.sendTyping();

        try {
            const conn = await db.getConnection(message.guild.id);
            const mainGuild = conn?.communityGuildId || message.guild.id;
            const knowledge = await db.getKnowledge(mainGuild);
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const ticketsHoje = await Memory.countDocuments({ category: 'ticket', timestamp: { $gte: today } });
            const ticketsAtivos = await Memory.countDocuments({ category: 'ticket', understood: false });
            const totalMemorias = await Memory.countDocuments({});
            const guildConfig = await db.getConnection(mainGuild) || {};

            const dataContext = `📊 DADOS REAIS:
- Tickets hoje: ${ticketsHoje} | Ativos: ${ticketsAtivos}
- Memórias: ${totalMemorias}
- Conhecimentos: ${Object.keys(knowledge).length}
- Voz: ${guildConfig.voiceMode ? 'ON' : 'OFF'}
- Servidor: ${conn?.communityGuildName || 'HostVille'}
- StaffRole: ${conn?.staffRoleId || 'N/A'}`;

            const systemPrompt = `Você é o HostBot, um assistente que EXECUTA QUALQUER COISA que o staff pedir.

${dataContext}

O staff ${message.author.username} pediu: "${msg}"

VOCÊ PODE FAZER TUDO. Para ações, responda EXATAMENTE neste formato:
ACAO: nome_da_acao
ALVO: ids ou nomes
VALOR: o que for necessário

AÇÕES QUE VOCÊ PODE EXECUTAR:
- FECHAR_TICKET: fecha ticket por número
- ATIVAR_VOZ: ativa modo voz
- DESATIVAR_VOZ: desativa modo voz  
- MUTAR: silencia usuário (precisa ID)
- DESMUTAR: libera usuário
- EXPULSAR: expulsa usuário
- BANIR: bane usuário
- APRENDER: salva conhecimento (ALVO=palavras, VALOR=resposta)
- ADICIONAR_PENDENCIA: cria tarefa pro bot
- RESPONDER_CANAL: manda mensagem em canal específico
- LIMPAR: limpa mensagens do chat

Se não for ação, responda como assistente normal.
Máximo 4 linhas. Português brasileiro.`;

            const response = await kilo.chat({
                messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: msg }],
                temperature: 0.3,
                max_tokens: 400
            });

            await Memory.create({
                user: message.author.username,
                userId: message.author.id,
                question: msg,
                answer: response || 'Processado',
                understood: true,
                category: 'staff_learning',
                guildId: message.guild.id,
                timestamp: new Date()
            });

            // TENTAR EXECUTAR AÇÃO
            const executed = await this.executeAnyAction(response, message, mainGuild, conn);
            
            if (executed) {
                await message.reply({ content: executed });
            } else {
                await this.extractKnowledge(msg, mainGuild, conn);
                if (response && !response.includes('ACAO:')) {
                    await message.reply({ content: response });
                } else if (!response) {
                    await message.reply({ content: '✅ Entendido! O que mais?' });
                }
            }

            return true;
        } catch (e) {
            console.error('StaffLearner:', e.message);
            await message.reply({ content: '❌ ' + e.message }).catch(() => {});
            return true;
        }
    }

    static canModerate(message, conn) {
        const member = message.member;
        if (!member) return false;
        if (message.author.id === process.env.OWNER_ID) return true;
        try {
            if (isAdmin(member)) return true;
        } catch (e) {}
        if (conn?.staffRoleId && member.roles.cache.has(conn.staffRoleId)) return true;
        return false;
    }

    static async executeAnyAction(response, message, mainGuild, conn) {
        if (!response) return null;

        const acaoMatch = response.match(/ACAO\s*:\s*(.+)/i);
        if (!acaoMatch) return null;

        const acao = acaoMatch[1].trim().toUpperCase().replace(/\s+/g, '_');
        const alvoMatch = response.match(/ALVO\s*:\s*(.+)/i);
        const valorMatch = response.match(/VALOR\s*:\s*([\s\S]+)/i);
        const alvo = alvoMatch ? alvoMatch[1].trim() : '';
        const valor = valorMatch ? valorMatch[1].trim() : '';

        // Bloquear ações de punição/gerenciamento sem permissão de staff.
        //
        // B24: RESPONDER_CANAL não estava nesta lista, e era a lacuna mais
        // grave do canal de aprendizado. Qualquer membro daquele canal
        // escrevia "ACAO: RESPONDER_CANAL / ALVO: <id> / VALOR: <texto>",
        // o modelo obedecia, e o bot postava a mensagem — em QUALQUER
        // canal de QUALQUER servidor onde estivesse, porque o lookup era
        // `global.client.channels.cache.get(chId)`, o cache global, sem
        // comparar com mainGuild. O conteúdo ainda era texto gerado por IA.
        //
        // ADICIONAR_PENDENCIA entra junto: cria tarefa para o bot executar
        // depois, o que é a mesma coisa com um passo de atraso.
        const EXIGEM_PERMISSAO = [
            'FECHAR_TICKET', 'MUTAR', 'DESMUTAR', 'EXPULSAR', 'BANIR', 'LIMPAR',
            'RESPONDER_CANAL', 'ADICIONAR_PENDENCIA'
        ];
        if (EXIGEM_PERMISSAO.includes(acao) && !this.canModerate(message, conn)) {
            return '❌ Sem permissão para executar essa ação.';
        }

        console.log(`⚡ Executando: ${acao}`);

        try {
            switch (acao) {
                case 'FECHAR_TICKET': {
                    const num = parseInt(alvo.replace(/\D/g, ''));
                    if (!num) return '❌ Qual número do ticket?';
                    const tickets = await Memory.find({ category: 'ticket', understood: false }).lean();
                    for (const t of tickets) {
                        const d = JSON.parse(t.answer || '{}');
                        if (d.number === num) {
                            const ch = global.client?.channels?.cache?.get(d.channelId);
                            if (ch) { await TicketManager.closeTicket(ch, message.author, 'Fechado via comando da staff'); return `✅ Ticket #${String(num).padStart(4, '0')} fechado!`; }
                            else { await db.closeTicket(d.channelId); return `✅ Ticket #${String(num).padStart(4, '0')} fechado (canal já removido).`; }
                        }
                    }
                    return `❌ Ticket #${String(num).padStart(4, '0')} não encontrado.`;
                }

                case 'ATIVAR_VOZ': {
                    const gc = await db.getConnection(mainGuild) || {};
                    gc.voiceMode = true;
                    await db.saveConnection(mainGuild, gc);
                    return '🔊 Voz ATIVADA!';
                }

                case 'DESATIVAR_VOZ': {
                    const gc = await db.getConnection(mainGuild) || {};
                    gc.voiceMode = false;
                    await db.saveConnection(mainGuild, gc);
                    return '📝 Voz DESATIVADA!';
                }

                case 'MUTAR': {
                    const userId = alvo.replace(/\D/g, '');
                    if (!userId) return '❌ ID do usuário?';
                    const guild = global.client?.guilds?.cache?.get(mainGuild);
                    if (!guild) return '❌ Servidor não encontrado';
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (!member) return '❌ Usuário não encontrado';
                    const tempo = parseInt(valor) || 600000;
                    await member.timeout(tempo, 'StaffLearner');
                    return `🔇 <@${userId}> mutado por ${tempo/60000}min`;
                }

                case 'DESMUTAR': {
                    const userId = alvo.replace(/\D/g, '');
                    const guild = global.client?.guilds?.cache?.get(mainGuild);
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (!member) return '❌ Usuário não encontrado';
                    await member.timeout(null);
                    return `🔊 <@${userId}> desmutado!`;
                }

                case 'EXPULSAR': {
                    const userId = alvo.replace(/\D/g, '');
                    const guild = global.client?.guilds?.cache?.get(mainGuild);
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (!member) return '❌ Usuário não encontrado';
                    await member.kick(valor || 'StaffLearner');
                    return `👢 ${member.user.tag} expulso!`;
                }

                case 'BANIR': {
                    const userId = alvo.replace(/\D/g, '');
                    const guild = global.client?.guilds?.cache?.get(mainGuild);
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (!member) return '❌ Usuário não encontrado';
                    await member.ban({ reason: valor || 'StaffLearner' });
                    return `🔨 ${member.user.tag} banido!`;
                }

                case 'APRENDER': {
                    const keywords = alvo.toLowerCase().split(/[, ]+/).filter(w => w.length > 2);
                    if (keywords.length === 0 || !valor) return '❌ Palavras e resposta?';
                    const entryId = keywords[0].replace(/[^a-z0-9_]/g, '_').substring(0, 30);
                    await db.addKnowledge(mainGuild, entryId, keywords, valor);
                    return `✅ Aprendido: ${keywords.join(', ')}`;
                }

                case 'ADICIONAR_PENDENCIA': {
                    await Pending.create({ type: alvo.toLowerCase() || 'acao', data: { descricao: valor, guildId: mainGuild } });
                    return '✅ Pendência criada!';
                }

                case 'RESPONDER_CANAL': {
                    const chId = alvo.replace(/\D/g, '');
                    const ch = global.client?.channels?.cache?.get(chId);
                    // B24: mesmo já exigindo permissão acima, o canal ainda
                    // precisa ser DESTA guild. `client.channels.cache` é o
                    // cache global e devolve canais de qualquer servidor
                    // onde o bot esteja; sem esta comparação, um admin da
                    // staff de um servidor manda o bot escrever em outro.
                    if (ch && mainGuild && ch.guildId !== mainGuild) {
                        return '❌ Esse canal não é deste servidor.';
                    }
                    if (ch) { await ch.send(valor); return '✅ Mensagem enviada!'; }
                    return '❌ Canal não encontrado';
                }

                case 'LIMPAR': {
                    const qtd = parseInt(alvo) || 10;
                    const fetched = await message.channel.messages.fetch({ limit: qtd + 1 });
                    await message.channel.bulkDelete(fetched);
                    return `🧹 ${qtd} mensagens limpas!`;
                }

                default:
                    return `⚠️ Entendi que era uma ação, mas não reconheci "${acao}". Pode reformular?`;
            }
        } catch (e) {
            return '❌ Erro: ' + e.message;
        }

        return null;
    }

    static async extractKnowledge(msg, guildId, conn) {
        const ensinarMatch = msg.match(/quando\s+(?:algu[ée]m\s+)?perguntar(?:em)?\s+[""](.+?)[""]\s+(?:voc[eê]\s+deve|responda|diga|fale)\s+[""](.+?)[""]/i);
        if (ensinarMatch) {
            const keywords = ensinarMatch[1].toLowerCase().replace(/[?.,!?]/g, '').split(' ').filter(w => w.length > 3);
            if (keywords.length > 0) {
                await db.addKnowledge(guildId, keywords[0].replace(/[^a-z0-9_]/g, '_').substring(0, 30), keywords, ensinarMatch[2]);
            }
            return;
        }

        if (msg.length > 100) {
            const keywords = msg.substring(0, 100).toLowerCase().split(' ').filter(w => w.length > 3).slice(0, 5);
            await db.addKnowledge(guildId, 'staff_' + Date.now().toString(36), keywords, msg.substring(0, 500));
        }
    }
}

module.exports = StaffLearner;