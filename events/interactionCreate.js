const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const { logError } = require('../utils/logger');
const StatsManager = require('../managers/StatsManager');
const { handleButtonInteraction } = require('../handlers/adminPanel');
const { handleMonitorButtons, handleServerSelection } = require('../handlers/monitoring');
const TicketManager = require('../managers/TicketManager');
const db = require('../database/db');

const commands = {
    warn: require('../commands/mod/warn'),
    warnings: require('../commands/mod/warnings'),
    clearwarns: require('../commands/mod/clearwarns'),
    kick: require('../commands/mod/kick'),
    ban: require('../commands/mod/ban'),
    timeout: require('../commands/mod/timeout'),
    purge: require('../commands/mod/purge'),
    filter: require('../commands/config/filter'),
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
    'ticket-setup': require('../commands/ticket/ticketsetup')
};

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        try {

            // SELECIONAR VOZ
            if (interaction.isStringSelectMenu() && interaction.customId === 'select_voice') {
                const voice = interaction.values[0];
                const guildConfig = await db.getConnection(interaction.guild.id) || {};
                guildConfig.selectedVoice = voice;
                await db.saveConnection(interaction.guild.id, guildConfig);
                await interaction.reply({ content: `✅ Voz alterada! 🎙️`, flags: 64 });
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
                if (category) await TicketManager.createTicket(interaction, category);
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
                return;
            }

            // TICKET - BOTÃO FECHAR
            if (interaction.isButton() && interaction.customId === 'ticket_close') {
                await interaction.deferReply({ flags: 64 });
                const ticket = await db.getTicket(interaction.channel.id);
                if (!ticket) return interaction.editReply({ content: '❌ Não é um ticket.' });
                const conn = await db.getConnection(interaction.guild.id);
                const isStaff = interaction.member.roles.cache.has(conn?.staffRoleId);
                const isOwner = ticket.userId === interaction.user.id;
                if (!isStaff && !isOwner) return interaction.editReply({ content: '❌ Sem permissão.' });
                await TicketManager.closeTicket(interaction.channel, interaction.user);
                return;
            }

            // TICKET - BOTÃO ASSUMIR
            if (interaction.isButton() && interaction.customId === 'ticket_claim') {
                await interaction.deferReply({ flags: 64 });
                const conn = await db.getConnection(interaction.guild.id);
                if (!interaction.member.roles.cache.has(conn?.staffRoleId)) return interaction.editReply({ content: '❌ Apenas staff.' });
                await TicketManager.claimTicket(interaction.channel, interaction.member);
                await interaction.editReply({ content: '✅ Ticket assumido!' });
                return;
            }

            // SLASH COMMANDS
            if (interaction.isChatInputCommand()) {
                const cmdName = interaction.commandName;
                StatsManager.trackCommand(cmdName);
                await StatsManager.saveStats();
                const command = commands[cmdName];
                if (command) await command.execute(interaction);
                else await interaction.reply({ content: '❌ Comando não encontrado.', flags: 64 });
                return;
            }

            // BOTÕES ADMIN
            if (interaction.isButton()) {
                if (interaction.customId === 'stats' || interaction.customId === 'console' || interaction.customId === 'help') {
                    await handleButtonInteraction(interaction); return;
                }
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
            }
            try { if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Erro.', flags: 64 }).catch(() => {}); } catch (e) {}
        }
    }
};