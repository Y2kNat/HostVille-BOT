const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, Colors } = require('discord.js');
const { logError } = require('../utils/logger');
const MaintenanceManager = require('../managers/MaintenanceManager');
const StatsManager = require('../managers/StatsManager');
const { handleAdmInteraction } = require('../handlers/adminPanel');
const { handleMonitorButtons, handleServerSelection } = require('../handlers/monitoring');
const TicketManager = require('../managers/TicketManager');
const db = require('../database/db');
const { sendLog } = require('../utils/realtime');
const WarnStore = require('../utils/warnStore');
const ModerationLog = require('../utils/ModerationLog');
const { formatDate } = require('../utils/formatters');

const commands = {
    warn: require('../commands/mod/warn'),
    warnings: require('../commands/mod/warnings'),
    clearwarns: require('../commands/mod/clearwarns'),
    kick: require('../commands/mod/kick'),
    ban: require('../commands/mod/ban'),
    timeout: require('../commands/mod/timeout'),
    purge: require('../commands/mod/purge'),
    filter: require('../commands/config/filter'),
    modtest: require('../commands/config/modtest'),
    linksettings: require('../commands/config/linksettings'),
    adm: require('../commands/info/adm'),
    ping: require('../commands/info/ping'),
    help: require('../commands/info/help'),
    avatar: require('../commands/info/avatar'),
    serverinfo: require('../commands/info/serverinfo'),
    userinfo: require('../commands/info/userinfo'),
    private: require('../commands/staff/private'),
    report: require('../commands/staff/report'),
    'ticket-config': require('../commands/ticket/ticketconfig'),
    'ai-ticket': require('../commands/ticket/ai-ticket'),
    'transcript': require('../commands/ticket/transcript'),
    'ticket-setup': require('../commands/ticket/ticketsetup'),
    close: require('../commands/ticket/close'),
    adicionar: require('../commands/ticket/adicionar'),
    ticket: require('../commands/ticket/ticket'),
    autointeraction: require('../commands/config/autointeraction'),
    maintenance: require('../commands/config/maintenance'),
    'ban-info': require('../commands/mod/ban-info'),
    case: require('../commands/mod/case'),
    slowmode: require('../commands/mod/slowmode'),
    lock: require('../commands/mod/lock'),
    unlock: require('../commands/mod/unlock'),
    setup: require('../commands/config/setup'),
    poll: require('../commands/config/poll')
};

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        try {

            // MANUTENÇÃO GLOBAL - bloqueia TUDO menos os comandos de manutenção
            if (MaintenanceManager.isEnabled()) {
                const isMaintCmd = interaction.isChatInputCommand() &&
                    (interaction.commandName === 'maintenance');
                if (!isMaintCmd) {
                    await interaction.reply({ embeds: [MaintenanceManager.buildEmbed()], flags: 64 }).catch(() => {});
                    return;
                }
            }

            // SETUP WIZARD
            if (interaction.customId?.startsWith('setup_')) {
                const { handleSetup } = require('../handlers/setupWizard');
                return handleSetup(interaction);
            }

            // BAN-INFO: detalhes
            if (interaction.isButton() && interaction.customId.startsWith('baninfo_detalhes:')) {
                const userId = interaction.customId.split(':')[1];
                const warns = WarnStore.get(userId, interaction.guild.id);
                const casos = ModerationLog.recentes(100, interaction.guild.id).filter(r => r.userId === userId);
                const embed = new EmbedBuilder()
                    .setColor(Colors.Orange)
                    .setTitle(`📋 Detalhes de <@${userId}>`)
                    .setDescription(warns.length
                        ? warns.map((w, i) => `**#${i + 1}** ${formatDate(w.timestamp)} — ${w.reason}`).join('\n').slice(0, 4096)
                        : 'Nenhum aviso registrado.');
                if (casos.length) embed.addFields({
                    name: '🛡️ Casos no log de moderação',
                    value: casos.slice(0, 10).map(c => `${formatDate(c.ts)} — ${c.acao} (${c.origem})`).join('\n').slice(0, 1024),
                    inline: false
                });
                return interaction.reply({ embeds: [embed], flags: 64 });
            }

            // PAGINAÇÃO
            if (interaction.isButton() && /_(prev|next|info)$/.test(interaction.customId)) {
                const { clicar } = require('../utils/paginator');
                if (await clicar(interaction)) return;
            }

            // SELECIONAR VOZ
            if (interaction.isStringSelectMenu() && interaction.customId === 'select_voice') {
                const voice = interaction.values[0];
                const guildConfig = await db.getConnection(interaction.guild.id) || {};
                guildConfig.selectedVoice = voice;
                await db.saveConnection(interaction.guild.id, guildConfig);
                await interaction.reply({ content: `✅ Voz alterada! 🎙️`, flags: 64 });
                sendLog('🎙️ Voz alterada para: ' + voice + ' | Servidor: ' + interaction.guild.name, 'info', 'config');
                return;
            }

            // TICKET - BOTÕES DO PAINEL
            if (interaction.isButton() && 
                (interaction.customId === 'ticket_denuncias' || 
                 interaction.customId === 'ticket_suporte' || 
                 interaction.customId === 'ticket_duvidas')) {
                await interaction.deferReply({ flags: 64 });
                const categoryMap = { 'ticket_denuncias': 'denuncias', 'ticket_suporte': 'suporte', 'ticket_duvidas': 'duvidas' };
                const category = categoryMap[interaction.customId];
                if (category) {
                    await TicketManager.createTicket(interaction, category);
                }
                return;
            }

            // TICKET - BOTÃO SUGERIR RESPOSTA
            if (interaction.isButton() && interaction.customId.startsWith('suggest_')) {
                const communityGuildId = interaction.customId.replace('suggest_', '');
                const modal = new ModalBuilder().setCustomId(`modal_${communityGuildId}`).setTitle('💡 Sugerir Resposta');
                const keywordsInput = new TextInputBuilder().setCustomId('keywords').setLabel('Palavras-chave (vírgula)').setStyle(TextInputStyle.Short).setPlaceholder('Ex: registro, veiculo').setRequired(true);
                const responseInput = new TextInputBuilder().setCustomId('response').setLabel('Resposta').setStyle(TextInputStyle.Paragraph).setPlaceholder('Ex: Acesse o canal #registro...').setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(keywordsInput), new ActionRowBuilder().addComponents(responseInput));
                await interaction.showModal(modal);
                return;
            }

            // TICKET - MODAL SALVAR
            if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_')) {
                await interaction.deferUpdate();
                const communityGuildId = interaction.customId.replace('modal_', '');
                const keywords = interaction.fields.getTextInputValue('keywords').split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
                const response = interaction.fields.getTextInputValue('response');
                if (keywords.length === 0) return interaction.editReply({ content: '❌ Informe palavras-chave.' });
                const entryId = keywords[0].replace(/[^a-z0-9_]/g, '_').substring(0, 30);
                let finalId = entryId, counter = 1;
                const knowledge = await db.getKnowledge(communityGuildId);
                while (knowledge[finalId]) { finalId = `${entryId}_${counter}`; counter++; }
                await db.addKnowledge(communityGuildId, finalId, keywords, response);
                const embed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x57F287).addFields({ name: '✅ Salvo', value: `ID: \`${finalId}\`` }).setFooter({ text: `Por ${interaction.user.tag}` });
                await interaction.editReply({ embeds: [embed], components: [] });
                sendLog('💡 Nova resposta sugerida: ' + keywords.join(', ') + ' | Por: ' + interaction.user.tag, 'success', 'knowledge');
                return;
            }

            // TICKET - BOTÃO FECHAR
            // O motivo é obrigatório, então o botão só abre o modal.
            // (não dá para deferReply aqui: showModal precisa responder direto)
            if (interaction.isButton() && interaction.customId === 'ticket_close') {
                const ticket = await db.getTicket(interaction.channel.id);
                if (!ticket) return interaction.reply({ content: '❌ Não é um ticket.', flags: 64 });
                const conn = await db.getConnection(interaction.guild.id);
                const isStaff = interaction.member.roles.cache.has(conn?.staffRoleId);
                const isOwner = ticket.userId === interaction.user.id;
                if (!isStaff && !isOwner) return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });

                const modal = new ModalBuilder()
                    .setCustomId('ticket_close_motivo')
                    .setTitle(`🔒 Fechar ticket #${String(ticket.number).padStart(4, '0')}`);
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('motivo')
                        .setLabel('Motivo do fechamento')
                        .setStyle(TextInputStyle.Paragraph)
                        .setPlaceholder('Ex: dúvida resolvida, resolvido no privado, usuário não respondeu, spam...')
                        .setMinLength(5)
                        .setMaxLength(500)
                        .setRequired(true)
                ));
                await interaction.showModal(modal);
                return;
            }

            // TICKET - MODAL FECHAR (motivo informado)
            if (interaction.isModalSubmit() && interaction.customId === 'ticket_close_motivo') {
                await interaction.deferReply({ flags: 64 });
                const motivo = (interaction.fields.getTextInputValue('motivo') || '').trim();
                if (motivo.length < 3) {
                    return interaction.editReply({ content: '❌ Escreva um motivo com pelo menos 3 caracteres.' });
                }
                const channel = interaction.channel;
                const ticket = await db.getTicket(channel.id);
                if (!ticket) return interaction.editReply({ content: '❌ Não é um ticket.' });
                // a permissão é reconferida no envio: o modal fica aberto até 15 min
                const conn = await db.getConnection(interaction.guild.id);
                const isStaff = interaction.member.roles.cache.has(conn?.staffRoleId);
                const isOwner = ticket.userId === interaction.user.id;
                if (!isStaff && !isOwner) return interaction.editReply({ content: '❌ Sem permissão.' });

                await TicketManager.closeTicket(channel, interaction.user, motivo);
                await interaction.editReply({
                    content: `🗑️ **Ticket #${String(ticket.number).padStart(4, '0')} fechado!**\n📝 Motivo: **${motivo}**`
                });
                sendLog('🔒 Ticket #' + String(ticket.number).padStart(4, '0') + ' fechado por ' + interaction.user.tag + ' | ' + motivo, 'warn', 'tickets');
                return;
            }

            // TICKET - BOTÃO ASSUMIR
            if (interaction.isButton() && interaction.customId === 'ticket_claim') {
                await interaction.deferReply({ flags: 64 });
                const conn = await db.getConnection(interaction.guild.id);
                if (!interaction.member.roles.cache.has(conn?.staffRoleId)) return interaction.editReply({ content: '❌ Apenas staff.' });
                await TicketManager.claimTicket(interaction.channel, interaction.member);
                await interaction.editReply({ content: '✅ Ticket assumido!' });
                sendLog('🙋 Ticket assumido por ' + interaction.user.tag, 'info', 'tickets');
                return;
            }

            // SLASH COMMANDS
            if (interaction.isChatInputCommand()) {
                const cmdName = interaction.commandName;
                StatsManager.trackCommand(cmdName);
                await StatsManager.saveStats();
                const command = commands[cmdName];
                if (command) {
                    await command.execute(interaction);
                    sendLog('⚡ /' + cmdName + ' executado por ' + interaction.user.tag + ' | ' + interaction.guild.name, 'info', 'commands');
                } else {
                    await interaction.reply({ content: '❌ Comando não encontrado.', flags: 64 });
                }
                return;
            }

            // ============================================================
            // ============================================================
            // AUTO-KB: aprovar / editar / ignorar documento sugerido
            // O canal fica no servidor de Administração HostVille, então este
            // bloco roda antes de qualquer filtro de guild.
            //
            // REGRA: UMA resposta por interaction. O botão usa deferUpdate e
            // fecha com UM editReply. Antes eu respondia duas vezes (update
            // dentro do manager + reply aqui) e o Discord estourava
            // "The reply to this interaction has already been sent".
            // ============================================================
            if (interaction.isButton() && interaction.customId.startsWith('autokb_')) {
                const { AutoKB } = require('../managers/AutoKB');
                const acao = interaction.customId.split(':')[0];

                const negado = '❌ Só o dono (ou os cargos em `APPROVE_ROLE` do .env) pode decidir isso.';
                if (!AutoKB.podeAprovar(interaction)) {
                    await interaction.reply({ content: negado, ephemeral: true });
                    return;
                }

                // editar não grava nada: só abre o modal
                if (acao === 'autokb_edit') {
                    const r = AutoKB.abrirEdicao(interaction.customId, interaction);
                    if (!r.ok) return interaction.reply({ content: r.msg, ephemeral: true });
                    return interaction.showModal(r.modal);
                }

                await interaction.deferUpdate();

                let r;
                if (acao === 'autokb_ignore') {
                    r = await AutoKB.ignorar(interaction.customId, interaction);
                } else {
                    r = await AutoKB.aprovar(interaction.customId, interaction);
                }

                if (!r.ok) {
                    // nada mudou: devolve os botões para a staff tentar de novo
                    await interaction.editReply({
                        embeds: [AutoKB.embedOriginal(customId)],
                        components: [AutoKB.linhaBotoes(customId)],
                    });
                    await interaction.followUp({ content: r.msg, ephemeral: true });
                    return;
                }

                await interaction.editReply({
                    embeds: [AutoKB.embedDecidido(r.status, interaction, r.docId, r.path)],
                    components: [],
                });
                return;
            }

            if (interaction.isModalSubmit() && interaction.customId.startsWith('autokb_edit_modal:')) {
                const { AutoKB } = require('../managers/AutoKB');
                if (!AutoKB.podeAprovar(interaction)) {
                    return interaction.reply({ content: '❌ Sem permissão para aprovar.', ephemeral: true });
                }
                const titulo = (interaction.fields.getTextInputValue('titulo') || '').trim();
                const fatos = (interaction.fields.getTextInputValue('fatos') || '').trim();
                if (titulo.length < 5 || fatos.length < 10) {
                    return interaction.reply({ content: '❌ Título ou fatos curtos demais. Nada foi gravado.', ephemeral: true });
                }

                await interaction.deferUpdate();
                const r = await AutoKB.aprovar(
                    interaction.customId.replace('autokb_edit_modal:', 'autokb_approve:'),
                    interaction,
                    fatos,
                    titulo
                );

                if (!r.ok) {
                    await interaction.followUp({ content: r.msg, ephemeral: true });
                    return;
                }
                await interaction.editReply({
                    embeds: [AutoKB.embedDecidido(r.status, interaction, r.docId, r.path)],
                    components: [],
                });
                return;
            }

            // PAINEL DO /adm
            //
            // Tudo do painel entra pelo prefixo `adm:`. A versão anterior
            // roteava três customId literais (`'stats' || 'console' || 'help'`)
            // numa comparação `||` — o quarto botão do painel exigia um quarto
            // literal, e a autorização vivia espalhada por `if`. Com o
            // prefixo, o handler é o único ponto de entrada e a checagem de
            // autor acontece uma vez, antes de qualquer efeito.
            if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())
                && String(interaction.customId || '').startsWith('adm:')) {
                if (await handleAdmInteraction(interaction)) return;
            }

            // BOTÕES ADMIN
            if (interaction.isButton()) {
                if (interaction.customId.startsWith('monitor_')) { await handleMonitorButtons(interaction); return; }
                if (interaction.customId === 'confirm_clear' || interaction.customId === 'cancel_clear') return;
            }

            // SELECT MENU SERVIDORES
            if (interaction.isStringSelectMenu()) {
                if (interaction.customId.startsWith('select_server_')) { await handleServerSelection(interaction); return; }
            }

        } catch (error) {
            if (!error.message.includes('Unknown interaction') && !error.message.includes('Unknown message')) {
                logError(`Erro no interactionCreate: ${error.message}`);
                sendLog('❌ Erro: ' + error.message, 'error', 'system');
            }
            try { if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Erro.', flags: 64 }).catch(() => {}); } catch (e) {}
        }
    }
};