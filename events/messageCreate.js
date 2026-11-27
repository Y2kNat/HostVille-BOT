const { ChannelType, EmbedBuilder, Colors, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const config = require('../config');
const SystemInfoManager = require('../managers/SystemInfoManager');
const db = require('../database/db');
const { isAdmin, isStaff } = require('../utils/permissions');
const { logInfo, logModeration, logError } = require('../utils/logger');

// ── CONTROLE DE FEATURES (/adm) ────────────────────────────────────────────
// Toda feature desligável do bot passa por aqui. A chave é lida do cache em
// memória do FeatureRegistry (`ligadoSync`), que o ready.js aquece — sem I/O
// no caminho quente. O `.env` continua sendo o DEFAULT de cada chave, então
// nada quebra para quem nunca abriu o painel.
const Features = require('../managers/FeatureRegistry');
const ModerationLog = require('../utils/ModerationLog');

/**
 * O filtro de spam/link só roda com estas três chaves ligadas. `monitoramento`
 * é a chave-mestra que já existia; `anti_spam` e `anti_link` são as novas,
 * independentes, para desligar uma sem a outra.
 */
function moderacaoPermitida(guildId, feature) {
    return Features.ligadoSync('monitoramento', guildId) && Features.ligadoSync(feature, guildId);
}

// Log de mensagens NAO chamadas: so em depuracao (DEBUG_CHAT_LOG=true no .env)
const DEBUG_CHAT_LOG = process.env.DEBUG_CHAT_LOG === 'true';
const SpamManager = require('../managers/SpamManager');
const FilterManager = require('../managers/FilterManager');
const LinkManager = require('../managers/LinkManager');
const WarningManager = require('../managers/WarningManager');
const StatsManager = require('../managers/StatsManager');
const { handleDMMessage } = require('../handlers/dmCommands');
const TicketManager = require('../managers/TicketManager');
const { TranscriptArchive } = require('../utils/TranscriptArchive');

const ChatManager = require('../managers/ChatManager');
const AdminChatManager = require('../managers/AdminChatManager');
const ContextMemory = require('../managers/ContextMemory');
const ImageAnalyzer = require('../managers/ImageAnalyzer');
const DynamicCommands = require('../managers/DynamicCommands');
const LogExporter = require('../managers/LogExporter');
const MessageCache = require('../utils/messageCache');
const StaffLearner = require('../managers/StaffLearner');
const AutoInteraction = require('../managers/AutoInteraction');
const MaintenanceManager = require('../managers/MaintenanceManager');
const AntiRaidManager = require('../managers/AntiRaidManager');
const HoneypotManager = require('../managers/HoneypotManager');
const kilo = require('../managers/KiloClient');
const urlBypass = require('../utils/moderation/urlBypass');
const { DECISION, AI_STATUS } = require('../utils/moderation/constants');

/**
 * B29 — anti-spam e anti-link, isolados para poderem rodar em QUALQUER
 * caminho de guild sem duplicar código.
 *
 * Antes estes dois filtros viviam no fim do `execute()`, depois de oito
 * `return`. Quem saía por um deles não era moderada: o canal de aprendizado
 * da staff e o comando dinâmico eram os dois caminhos abertos, e ambos são
 * alcançáveis por membro comum.
 *
 * As isenções são as mesmas do fim do arquivo: o monitoramento precisa estar
 * ligado no servidor, e staff/admin não são punidos por spam nem por link.
 * Staff/admin continuam sujeitos ao filtro de PALAVRA (que é mais abaixo e
 * tem a própria regra de isenção, decided with the owner: staff não é
 * punida, mas fica no log).
 *
 * @returns {boolean} true se a mensagem foi moderada e o caller deve parar
 */
async function moderaSpamELink(message, opts = {}) {
    if (!message.guild) return false;

    // Quem chama o bot não conta como flood. Esta isenção É a ordem
    // original: o anti-spam fica DEPOIS do `if (called) respondToMessage`,
    // então uma conversa com o bot nunca entrava no contador.
    //
    // Mover a chamada para antes disso (o que a correção do B29 fez) mudou
    // o comportamento sem ninguém pedir: 6 perguntas seguidas para o bot
    // passaram a ser lidas como rajada. Só o canal de aprendizado precisa
    // do anti-spam antes do ChatManager — e lá quem escreve é a staff,
    // escrevendo instrução, não flood.
    if (!opts.forcar && ChatManager.isBotCalled(message)) return false;

    const ativo = await db.getMonitoringStatus(message.guild.id);
    if (!ativo) return false;
    if (isStaff(message.author.id)) return false;
    if (isAdmin(message.member)) return false;

    const querSpam = moderacaoPermitida(message.guild.id, 'anti_spam');
    const querLink = moderacaoPermitida(message.guild.id, 'anti_link');

    // Cada filtro decide sozinho agora. Antes os dois eram um bloco só, e não
    // havia como desligar o link sem desligar o spam (e vice-versa) — só o
    // /linksettings mexia no de link, e ele só mexe no de convite.
    if (querSpam) {
        const spamCheck = SpamManager.checkSpam(message);
        if (spamCheck.isSpam) {
            await SpamManager.handleSpam(message);
            StatsManager.incrementSpam();
            await StatsManager.saveStats();
            ModerationLog.registrar({
                guildId: message.guild.id, channelId: message.channel.id,
                channelName: message.channel.name,
                userId: message.author.id, userTag: message.author.tag,
                palavra: '—', categoria: 'spam', severidade: 'medium',
                confianca: null, via: 'volume', acao: 'punido', origem: 'spam'
            });
            logModeration('Spam', message.author, message.content, message.channel, spamCheck.reason || 'rajada');
            return true;
        }
    }

    if (querLink) {
        const linkCheck = await LinkManager.checkLink(message, message.guild.id);
        if (linkCheck.block) {
            await LinkManager.handleLinkBlock(message, linkCheck.reason);
            StatsManager.incrementLink();
            StatsManager.incrementMessagesDeleted();
            await StatsManager.saveStats();
            ModerationLog.registrar({
                guildId: message.guild.id, channelId: message.channel.id,
                channelName: message.channel.name,
                userId: message.author.id, userTag: message.author.tag,
                palavra: '—', categoria: 'link', severidade: 'low',
                confianca: null, via: 'regex', acao: 'punido', origem: 'link'
            });
            logModeration('Anti-link', message.author, message.content, message.channel, linkCheck.reason);
            return true;
        }
    }

    return false;
}

module.exports = {
    name: 'messageCreate',
    async execute(message) {
        // ============================================================
        // POLÍTICA DE ORDEM DOS FILTROS  [B29]
        // ============================================================
        // Este arquivo cresceu por acréscimo: cada feature nova entrou
        // ANTES da existente, e o filtro de palavra (que fica no meio) e o
        // anti-spam/anti-link (que ficam no fim) herdaram a posição. A
        // AUDITORIA-3 contou 8 `return` entre o início e o filtro.
        //
        // DECIDIR a ordem ideal sem servidor de teste é arriscado: mover o
        // anti-spam para o topo muda o comportamento de ticket, de comando
        // dinâmico e de canal de aprendizado, e não há como medir isso aqui.
        // Então a ordem fica, mas a POLÍTICA fica escrita e os buracos
        // abertos foram fechados. O que segue é o mapa honesto:
        //
        //  LINHA/CAMINHO                    LING.  SPAM  LINK  POR QUÊ
        //  -------------------------------  -----  ----  ----  -------------
        //  resposta ao bot (onBotMessage)    não    não   não  arrasto: a
        //                                                       pessoa está
        //                                                       respondendo
        //                                                       o BOT, e
        //                                                       o filtro
        //                                                       viu o texto
        //                                                       do bot, não
        //                                                       o dela
        //  DM (handleDMMessage)             n/a    n/a   link  filtro de
        //                                                       palavra é de
        //                                                       servidor; DM
        //                                                       tem dono
        //                                                       único
        //  ticket (processAutoAttendant)     não    sim   sim   é
        //                                                       atendimento:
        //                                                       o filtro de
        //                                                       palavra
        //                                                       atrapalharia
        //  comando admin (AdminChatManager)  não    sim   sim   staff não
        //                                                       vai ser
        //                                                       moderado nem
        //                                                       por spam
        //  canal de aprendizado               SIM    sim   sim   staff
        //  (StaffLearner)                                    digitando
        //                                                       instrução
        //  comando dinâmico (! ou /)         SIM    sim   sim   ver abaixo
        //  filtro de PALAVRA                 sim    —     —     o centro
        //  imagem / contexto pendente        sim    sim   sim   fluxo normal
        //  anti-spam e anti-link             —      sim   sim   no fim
        //
        // O QUE FOI FECHADO
        // O canal de aprendizado e o comando dinâmico saíam por `return`
        // antes do filtro de palavra E antes do anti-spam/anti-link: membro
        // comum nesses dois caminhos não passava por filtro nenhum. Agora
        // `moderacaoBasica()` roda antes deles.
        //
        // O QUE NÃO FOI FECHADO, E POR QUÊ
        // Mover o filtro de PALAVRA para antes do ticket e do comando admin
        // mudaria o comportamento de dois fluxos de atendimento sem forma de
        // medir. Precisa de servidor de teste. Fica registrado, não
        // esquecido.

        // Arquiva a mensagem ANTES de qualquer filtro: o channelDelete chega
        // depois da exclusao e o historico nao pode mais ser lido do Discord.
        // Inclui mensagens do bot, porque os embeds vive nelas.
        // O proprio TranscriptArchive checa se esta ligado no servidor.
        try {
            if (message.channel?.name?.startsWith('🎫・')) {
                TranscriptArchive.record(message);
            }
        } catch (e) { /* nunca quebra o fluxo */ }

        if (message.author.bot) return;
        MessageCache.add(message);

        // !export — dono/staff exporta o log estruturado mais recente em Markdown.
        if (message.content === '!export' || message.content.startsWith('!export ') || message.content === '!export-deleted' || message.content.startsWith('!export-deleted ')) {
            const isOwner = message.author.id === config.OWNER_ID;
            const isServerAdmin = !!message.member?.permissions?.has(PermissionFlagsBits.Administrator);
            if (!isOwner && !isServerAdmin) {
                const denied = await message.reply({ content: '❌ Sem permissão para exportar o log.' });
                setTimeout(async () => { try { await denied.delete(); } catch (e) {} }, 6000);
                return;
            }
            const args = message.content.trim().split(/\s+/);
            const soDeletadas = args[0] === '!export-deleted' || (args[0] === '!export' && args[1] === 'deleted');
            let days = 3;
            let userId = null;
            if (soDeletadas) {
                const rest = args[0] === '!export-deleted' ? args.slice(1) : args.slice(2);
                for (const token of rest) {
                    const userMatch = token.match(/^<@!?(\d+)>$/) || token.match(/^(\d{17,20})$/);
                    if (userMatch) { userId = userMatch[1]; continue; }
                    if (/^\d+$/.test(token)) days = Math.min(7, Math.max(1, parseInt(token, 10)));
                }
            }
            const result = soDeletadas ? LogExporter.exportDeleted({ days, userId }) : LogExporter.exportLatest();
            if (!result) {
                await message.reply({ content: '❌ Nenhum log estruturado encontrado.' });
                return;
            }
            const file = new AttachmentBuilder(result.buffer, { name: result.filename });
            const resumo = soDeletadas
                ? `🗑️ **Mensagens deletadas exportadas**\nArquivo: \`${result.filename}\`\nUsuário: ${result.userId ? `<@${result.userId}>` : 'todos'}\nDias: **${result.days}**\nTotal: **${result.total}**`
                : `📄 **Log exportado**\nArquivo: \`${result.filename}\`\nLinhas: **${result.stats.total}**`;
            await message.reply({ content: resumo, files: [file] });
            return;
        }

        // ============================================
        // HONEYPOT (canal-armadilha)
        // ============================================
        // Roda CEDO, antes de qualquer outro fluxo: uma mensagem no canal-
        // armadilha é punição imediata, não pode cair num `return` de ticket/
        // comando/aprendizado. Só age no canal configurado; nos outros é no-op.
        try {
            if (message.guild && message.channel && message.channel.id === HoneypotManager.getCanalId()) {
                await HoneypotManager.handleMessage(message);
                return;
            }
        } catch (e) {
            logError('Erro no honeypot: ' + e.message);
        }

        // ============================================
        // ANTI-RAID: contagem de @everyone / @here
        // ============================================
        // Roda CEDO, antes de qualquer `return` dos fluxos de ticket/comando/
        // aprendizado: um raid por menção massiva não pode passar despercebido
        // só porque a mensagem cairia num caminho que retorna antes. É
        // independente do resto e nunca derruba o fluxo (try/catch próprio).
        try {
            if (message.guild && message.mentions && (message.mentions.everyone || /@everyone|@here/.test(message.content || ''))) {
                await AntiRaidManager.handleEveryoneMention(message, message.author.id);
            }
        } catch (e) { /* nunca quebra o fluxo */ }

        // ============================================
        // COMANDO DE SISTEMA (-hv%): status do PC/servidor
        // ============================================
        // So o dono executa; tentativa de outro usuario e registrada no log.
        // Roda antes da manutencao para o dono poder diagnosticar mesmo com
        // o bot em manutencao.
        if (SystemInfoManager.isSystemCommand(message)) {
            await SystemInfoManager.execute(message);
            return;
        }
        // ============================================
        // MANUTENÇÃO GLOBAL - toda ação vira um embed
        // ============================================
        if (MaintenanceManager.isEnabled()) {
            // Em manutenção o bot só responde quando é chamado por "hvbot" ou @menção
            if (message.channel.type === ChannelType.DM || ChatManager.isBotCalled(message)) {
                await message.reply({ embeds: [MaintenanceManager.buildEmbed()] });
                return;
            }
            return;
        }

        // ============================================
        // RESPONDER QUANDO ALGUÉM RESPONDE O BOT (arrastar pro lado)
        // ============================================
        if (message.reference && message.guild) {
            const replied = await AutoInteraction.onBotMessageReplied(message, message.client);
            if (replied) return;
        }

        // ============================================
        // VERIFICAR SE USUÁRIO ESTÁ SILENCIADO
        // ============================================
        if (message.guild) {
            const guildConfig = await db.getConnection(message.guild.id) || {};
            const mutedUsers = guildConfig.mutedUsers || [];
            if (mutedUsers.includes(message.author.id)) {
                try {
                    if (message.deletable) await message.delete();
                } catch (e) {}
                return;
            }
        }

        // ============================================
        // MENSAGENS NA DM
        // ============================================
        if (message.channel.type === ChannelType.DM) {
            await handleDMMessage(message);
            return;
        }

        // ============================================
        // ATENDIMENTO AUTOMÁTICO NO TICKET
        // ============================================
        const ticketProcessed = await TicketManager.processAutoAttendant(message);
        if (ticketProcessed) return;

        // ============================================
        // COMANDOS DE ADMIN VIA CHAT (PRIMEIRO)
        // ============================================
        if (await AdminChatManager.isAdminCommand(message)) {
            await AdminChatManager.processAdminCommand(message);
            return;
        }

        // ============================================
        // CANAL DE APRENDIZADO DA STAFF
        // ============================================
        // B29: este caminho era o pior da lista. Saía por `return` antes do
        // filtro de palavra E antes do anti-spam e do anti-link — membro
        // comum no canal de aprendizado não passava por filtro nenhum, e o
        // canal é público.
        //
        // A moderação roda ANTES do StaffLearner porque este caminho sai por
        // `return` e nunca chegaria ao anti-spam do fim do arquivo. O filtro
        // de PALAVRA não roda aqui: o conteúdo é instrução para o modelo, e
        // o prompt lista ações ("FECHAR_TICKET", "MUTAR") que o filtro
        // pegaria, então a staff não conseguiria escrever a própria
        // instrução.
        //
        // `canal de aprendizado` no if, e NÃO depois: o `StaffLearner.process`
        // retorna `false` para qualquer outro canal, então chamar a moderação
        // sem testar o canal rodaria ela para TODA mensagem do servidor.
        // Com `forcar: true` (a staff escreve para o bot, cairia na isenção
        // de "chamou o bot"), isso significava tirar o mute de todos os
        // membros a 3 mensagens. Foi exatamente o que aconteceu em produção.
        if (message.channel.id === StaffLearner.LEARN_CHANNEL
            && await moderaSpamELink(message, { forcar: true })) return;

        const staffLearned = await StaffLearner.process(message);
        if (staffLearned) return;

        // ============================================
        // COMANDOS DINÂMICOS (! ou /)
        // ============================================
        const content = message.content;
        if (content.startsWith('!') || content.startsWith('/')) {
            const commandName = content.split(' ')[0].replace('!', '').replace('/', '').toLowerCase();
            const dynamicResponse = await DynamicCommands.execute(message, commandName, message.guild.id);
            if (dynamicResponse) {
                await message.reply({ content: dynamicResponse });
                return;
            }
        }

        // ============================================
        // FILTRO DE PALAVRAS OFENSIVAS (ANTES DA IA)
        // ============================================
        // Pode estar desligado neste canal via /filter disable, ou desligado
        // no servidor inteiro via `filtro_palavras` no /adm. Quando está,
        // só o filtro de linguagem pula: o resto do processamento (chat, IA,
        // links, imagens) continua normal.
        const filtroAtivo =
            Features.ligadoSync('filtro_palavras', message.guild.id) &&
            FilterManager.isChannelEnabled(message.guild.id, message.channel.id);
        const aiAll = !!config.MODERATION_AI_ALL;
        if (filtroAtivo) {
        // Uma única chamada: o motor decide, o classificador resolve o
        // ambíguo. Só há punição quando a decisão é FINAL — se a IA de
        // moderação cair, a mensagem passa e o caso vai para o log.
        //
        // BUG 2: mensagem que é SÓ uma URL não passa pelo filtro de
        // PALAVRA. O tokenizador quebra a URL e produz tokens do slug, e um
        // GIF de reação com o insulto no endereço gerava warn para quem só
        // mandou um link. Log real de 30/09:
        //   https://klipy.com/gifs/eita-cuzao -> "cuzao" [conf=0.916] -> warn
        //
        // O bypass é do filtro de PALAVRA e não toca o anti-invite: um
        // convite de Discord em URL continua barrado pelo LinkManager, que
        // roda mais abaixo. São controles separados de propósito.
        const soUrl = urlBypass.isSoUrl(message.content);
        const modResult = soUrl
            ? { flagged: false, decision: DECISION.FINAL_CLEAN, aiStatus: AI_STATUS.NOT_NEEDED, severity: 'none', confidence: 0, matched: [], reasons: ['url_only'] }
            : await FilterManager.decide(message.content, { guildId: message.guild.id });

        // ── O QUE ANTES SÓ IA PARA O CONSOLE ────────────────────────────
        // Três casos que se perdiam: o caso `needs_review` (a IA caiu e o
        // motor decidiu não punir), o caso staff (logado, sem punição) e o
        // caso sem permissão de apagar. Nenhum deles chegava a lugar nenhum
        // além do arquivo de texto do dia — que some no restart e não tem
        // agregação. É o que a tela de xingamento do /adm consome.
        const staffOuAdmin = isStaff(message.author.id) || isAdmin(message.member);
        const casoNeedsReview = !!(modResult.flagged && modResult.decision === DECISION.NEEDS_REVIEW);
        const achouAlgo = !!modResult.flagged || casoNeedsReview;

        // MODO RESPOSTA FIXA — chave `roast` do /adm, senão o
        // PROFANITY_AI_ROAST do .env. Ligado: o filtro detecta, mas NINGUÉM
        // é apagado nem warnado; se o bot for chamado ele manda a frase fixa
        // (ChatManager). Desligado: moderação normal, apaga + warn, e o bot
        // não responde o xingamento. Mesma fonte dos dois lados: os dois
        // arquivos têm que enxergar o mesmo valor ou o bot warna e ainda
        // responde "Tô suave" em cima.
        let roastAtivo = process.env.PROFANITY_AI_ROAST === 'true';
        try { roastAtivo = Features.ligadoSync('roast', 'global'); }
        catch (e) { /* registry indisponível: fica o .env */ }

        if (achouAlgo) {
            const palavra = FilterManager.findOffensiveWord(modResult);
            const severidade = modResult.severity || '—';
            let acao = casoNeedsReview ? 'review' : 'punido';
            if (casoNeedsReview && !Features.ligadoSync('ia_moderacao', message.guild.id)) {
                // Sem a IA, o ambíguo nunca vira decisão final: fica tudo em
                // needs_review e nada é apagado. Precisa aparecer na tela,
                // senão parece que o filtro desligou sozinho.
                acao = 'review';
            }
            if (!casoNeedsReview && staffOuAdmin) acao = 'staff';
            // No modo resposta fixa não há punição. Deixar 'punido' faria a
            // tela do /adm mostrar "apagados + avisados" gente que ficou
            // no canal. 'limpo' entra no "autorizado" do agregado.
            if (roastAtivo && acao === 'punido') acao = 'limpo';

            ModerationLog.registrar({
                guildId: message.guild.id,
                channelId: message.channel.id,
                channelName: message.channel.name,
                userId: message.author.id,
                userTag: message.author.tag,
                palavra: palavra || '—',
                categoria: modResult.category,
                severidade,
                confianca: modResult.confidence,
                via: modResult.aiStatus,
                acao,
                origem: 'palavra'
            });
            StatsManager.incrementXingamento({ staff: acao === 'staff', review: acao === 'review' });
            await StatsManager.saveStats();

            if (acao === 'review') {
                logInfo(`[revisão] ${message.author.tag} em ${message.guild.name}: "${palavra || '?'}" ` +
                    `(${severidade} conf=${modResult.confidence}) — a IA de moderação não decidiu, nada foi apagado`);
            }
        }

        if (!aiAll && FilterManager.shouldPunish(modResult)) {
            const foundWord = FilterManager.findOffensiveWord(modResult);

            // BUG 15: a staff não é punida pelo filtro de LINGUAGEM, mas o
            // log continua sendo gravado. O filtro de spam já isentava
            // staff/admin (linhas 300-301) e a assimetria atingia justamente
            // quem precisa explicar a moderação: sem isto, a staff não
            // consegue nem citar a palavra que acabou de moderar.
            //
            // BUG 15: staff/admin não leva punição, mas fica registrado.
            // O log vem ANTES do return para que a trilha exista mesmo
            // quando a punição é pulada — é assim que a staff descobre que
            // alguém do staff usou um termo bloqueado.
            logModeration('Palavras ofensivas detectadas', message.author, message.content, message.channel,
                `${foundWord || 'desconhecida'} [${modResult.category}/${modResult.severity} conf=${modResult.confidence} via=${modResult.aiStatus}]` +
                `${staffOuAdmin ? ' (staff/admin: SEM PUNICAO)' : ''}`);

            if (staffOuAdmin) {
                // Staff não é apagada nem warnada. Segue o fluxo normal.
                return;
            }

            // MODO RESPOSTA FIXA ligado (chave `roast` / PROFANITY_AI_ROAST):
            // a detecção fica registrada, mas ninguém é apagado nem warnado.
            // NÃO pode haver return aqui — a mensagem tem que continuar no
            // fluxo até o fim do arquivo, é o que permite o ChatManager
            // responder a frase fixa quando o bot é chamado.
            if (roastAtivo) {
                logInfo(`[roast] modo resposta fixa ativo em ${message.guild.name}: ` +
                    `"${foundWord || '?'}" detectado, SEM apagamento e SEM warn`);
            } else {

            // Escalada automática é uma chave própria: desligar o filtro não
            // pode derrubar a punição de quem já tem aviso, e vice-versa.
            if (!Features.ligadoSync('punicao_auto', message.guild.id)) {
                logInfo(`[Features] punicao_auto desligada em ${message.guild.name}: aviso registrado, escada não aplicada`);
                return;
            }

            try {
                const permissions = message.channel.permissionsFor(message.client.user);
                if (!permissions.has(PermissionFlagsBits.ManageMessages)) return;
                if (!message.deletable) return;

                // Marca no client: o evento messageDelete vai disparar em seguida
                // e nao deve repetir este log, porque a moderacao ja logou.
                message.client.__moderationDelete = {
                    channel: message.channel.id,
                    ts: Date.now(),
                    foundWord,
                    severity: modResult.severity,
                    category: modResult.category,
                    aiStatus: modResult.aiStatus
                };
                await message.delete();
                StatsManager.incrementMessagesDeleted();
                await StatsManager.saveStats();

                const warnData = {
                    reason: `Palavra ofensiva detectada: "${foundWord}"`,
                    moderator: message.client.user.id,
                    // A guild vai junto. Sem ela o aviso é gravado como
                    // 'unknown' e a escada de punição conta infrações de um
                    // servidor no outro — o usuário podia ser banido no B por
                    // avisos que só aconteceram no A.
                    guildId: message.guild.id,
                    auto: true,
                    timestamp: Date.now()
                };

                const warns = await WarningManager.addWarning(message.author.id, warnData);
                StatsManager.incrementWarns();
                await StatsManager.saveStats();

                const warningMsg = await message.channel.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('🚫 Mensagem Removida - HostVille • BOT')
                        .setDescription('Sua mensagem foi removida por conter palavras ofensivas.')
                        .setColor(Colors.Red)
                        .addFields(
                            { name: '👤 Usuário', value: message.author.toString(), inline: false },
                            { name: '🗓 Data', value: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), inline: false },
                            { name: '🚫 Palavra', value: `**${foundWord || "desconhecida"}**`, inline: false },
                            { name: '⚠️ Avisos', value: `${warns.length}`, inline: false }
                        )
                        .setFooter({ text: 'Caso isso tenha sido um erro, contate a staff.' })
                        .setTimestamp()
                    ]
                });

                setTimeout(async () => { try { await warningMsg.delete(); } catch (e) {} }, 10000);

                const punishment = await WarningManager.checkAutoPunishment(message.member, message.guild.id);
                if (punishment) {
                    const punishmentMsg = await message.channel.send(punishment);
                    setTimeout(async () => { try { await punishmentMsg.delete(); } catch (e) {} }, 10000);
                }

                return;
            } catch (err) {
                logError(`Erro ao moderar mensagem: ${err.message}`);
            }
            }   // fim: modo resposta fixa desligado
        }
        if (aiAll && !soUrl) {
            require('../managers/ModerationQueue').enqueue(message, modResult);
        }
        }   // fim: filtroAtivo

        // ============================================
// ANÁLISE DE IMAGENS (apenas canais permitidos)
// ============================================
// const ALLOWED_IMAGE_CHANNELS = ['1392306491683373077', '1392306454756720742'];
      const ALLOWED_IMAGE_CHANNELS = [];


if (ALLOWED_IMAGE_CHANNELS.includes(message.channel.id)) {
    // Só processa se tiver anexo de imagem
    const hasImage = message.attachments.size > 0 && message.attachments.first().contentType?.startsWith('image/');

    if (hasImage) {
        if (ChatManager.isBotCalled(message)) {
            const msgContent = message.content.toLowerCase();

            // Traduzir imagem
            if (msgContent.includes('traduz') || msgContent.includes('traduza') || msgContent.includes('traduzir')) {
                const translateResponse = await ImageAnalyzer.translateImage(message);
                if (translateResponse) {
                    await message.reply({ content: translateResponse });
                    return;
                }
            }

            // Analisar imagem
            const imageResponse = await ImageAnalyzer.analyzeWithAI(message);
            if (imageResponse) {
                await message.reply({ content: imageResponse });
                return;
            }
        } else {
            // Imagem sem menção: avisa e NÃO dá return
            await message.reply({ content: '📸 Se quiser que eu analise essa imagem, me menciona junto! Ex: `HvBot o que tem nessa imagem?`' });
        }
    }
}

        // ============================================
        // VERIFICAR SE USUÁRIO TEM CONTEXTO PENDENTE
        // ============================================
        // B23: a pendência é por (userId, guild). Ler sem a guild devolveria
        // o contexto de outro servidor, e o prompt abaixo manda "COPIE
        // EXATAMENTE" a resposta do conhecimento do guild ATUAL — o
        // usuário veria a informação de um servidor que não é o dele.
        const guildIdAtual = message.guild?.id || null;
        const pending = ContextMemory.getPending(message.author.id, { guildId: guildIdAtual });

        if (pending && !ChatManager.isBotCalled(message)) {
            ContextMemory.clearPending(message.author.id, { guildId: guildIdAtual });

            const answer = message.content;
            const question = pending.question;

            await message.channel.sendTyping();

            try {
                const knowledge = await db.getKnowledge(message.guild.id);
                let conhecimentoTexto = '';

                if (Object.keys(knowledge).length > 0) {
                    conhecimentoTexto = 'CONHECIMENTO DO SERVIDOR (USE EXATAMENTE):\n';
                    for (const [id, entry] of Object.entries(knowledge)) {
                        conhecimentoTexto += `- "${entry.keywords.join(', ')}" → "${entry.response}"\n`;
                    }
                }

                const systemPrompt = `O usuário tinha perguntado: "${question}"
E agora respondeu: "${answer}"
Ele está falando do SERVIDOR/JOGO/DISCORD.

${conhecimentoTexto}

REGRA ABSOLUTA:
- Se a pergunta combinar com o conhecimento, COPIE EXATAMENTE a resposta
- NÃO invente, NÃO explique, só COPIE
- Se não combinar: "Confira os canais de informação!"`;

                const response = await kilo.chat({
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: answer }
                    ],
                    temperature: 0.3,
                    max_tokens: 512
                }) || '📋 Confira os canais de informação!';

                await message.reply({ content: response });
            } catch (error) {
                await message.reply({ content: '📋 No servidor, confira os canais de informação.' });
            }

            return;
        }

        // ============================================
        // RESPONDER QUANDO MENCIONAR O BOT
        // ============================================
        const called = ChatManager.isBotCalled(message);
        // [log removido a pedido] logInfo(`💬 MSG | user=${message.author.username} guild=${message.guild.name} canal=#${message.channel.name} chamado=${called} texto="${String(message.content).substring(0, 70).replace(/\n/g, ' ')}"`);
        // Não é log de erro: é o caso NORMAL (conversa no canal sem chamar o
        // bot). Logar isso em warning polui o console a cada mensagem e
        // esconde o que importa. Fica disponível para depuração.
        if (!called && DEBUG_CHAT_LOG) {
            logInfo(`🔇 não chamado | "${String(message.content).substring(0, 50)}" (use "hvbot ..." ou @menção)`);
        }
        if (called) {
            if (!Features.ligadoSync('chat_ia', message.guild?.id)) {
                logInfo(`[Features] chat_ia desligada em ${message.guild?.name}: o bot foi chamado e não respondeu`);
                return;
            }
            await ChatManager.respondToMessage(message);
            return;
        }

        // ============================================
        // MODERAÇÃO EM CANAIS DE SERVIDOR
        // ============================================
        const isMonitoringActive = await db.getMonitoringStatus(message.guild.id);
        if (!isMonitoringActive) return;
        if (isStaff(message.author.id)) return;
        if (isAdmin(message.member)) return;

        // ============================================
        // ANTI-SPAM
        // ============================================
        if (moderacaoPermitida(message.guild.id, 'anti_spam')) {
            const spamCheck = SpamManager.checkSpam(message);
            if (spamCheck.isSpam) {
                await SpamManager.handleSpam(message);
                StatsManager.incrementSpam();
                await StatsManager.saveStats();
                ModerationLog.registrar({
                    guildId: message.guild.id, channelId: message.channel.id,
                    channelName: message.channel.name,
                    userId: message.author.id, userTag: message.author.tag,
                    palavra: '—', categoria: 'spam', severidade: 'medium',
                    via: 'volume', acao: 'punido', origem: 'spam'
                });
                logModeration('Spam', message.author, message.content, message.channel, spamCheck.reason || 'rajada');
                return;
            }
        }

        // ============================================
        // ANTI-LINK
        // ============================================
        if (moderacaoPermitida(message.guild.id, 'anti_link')) {
            const linkCheck = await LinkManager.checkLink(message, message.guild.id);
            if (linkCheck.block) {
                await LinkManager.handleLinkBlock(message, linkCheck.reason);
                StatsManager.incrementLink();
                StatsManager.incrementMessagesDeleted();
                await StatsManager.saveStats();
                ModerationLog.registrar({
                    guildId: message.guild.id, channelId: message.channel.id,
                    channelName: message.channel.name,
                    userId: message.author.id, userTag: message.author.tag,
                    palavra: '—', categoria: 'link', severidade: 'low',
                    via: 'regex', acao: 'punido', origem: 'link'
                });
                logModeration('Anti-link', message.author, message.content, message.channel, linkCheck.reason);
                return;
            }
        }
    }
};
