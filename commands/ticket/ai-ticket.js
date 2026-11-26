const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const db = require('../../database/db');
const { isAdmin } = require('../../utils/permissions');
const StatsManager = require('../../managers/StatsManager');
const TicketManager = require('../../managers/TicketManager');
const TicketQueue = require('../../managers/TicketQueue');

/**
 * /ai-ticket — liga ou desliga a resposta automática da IA num ticket.
 *
 * Só admin. Só funciona dentro de um ticket. Não afeta os outros tickets
 * nem a IA do servidor inteiro.
 *
 * Desligar a IA NÃO deixa o usuário sem resposta: o bot avisa e chama a
 * equipe no canal.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('ai-ticket')
        .setDescription('🤖 Liga ou desliga a resposta automática da IA neste ticket')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('O que fazer')
                .setRequired(true)
                .addChoices(
                    { name: 'Desligar a IA', value: 'off' },
                    { name: 'Ativar a IA', value: 'on' },
                    { name: 'Ver status', value: 'status' }
                )),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: '❌ Só administradores podem usar este comando.', flags: 64 });
        }

        const action = interaction.options.getString('action');
        const canal = interaction.channel;
        StatsManager.trackCommand('ai-ticket');

        // Precisa estar num ticket de verdade (registrado no banco)
        const ticket = await db.getTicket(canal.id);
        if (!ticket) {
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('🤖 AI do Ticket')
                    .setDescription('Este comando só funciona **dentro de um ticket**. Use-o no canal do ticket.')
                    .setColor(Colors.Red)],
                flags: 64
            });
        }

        await TicketManager.refreshTicketAi(true);
        const ativa = TicketManager.isAiEnabled(interaction.guild.id, canal.id);

        if (action === 'status') {
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('🤖 Status da IA neste ticket')
                    .setColor(ativa ? Colors.Green : Colors.Orange)
                    .addFields(
                        { name: 'Canal', value: `${canal}\nID: \`${canal.id}\``, inline: false },
                        { name: 'Resposta automática', value: ativa ? '🟢 Ligada' : '🔴 Desligada', inline: true },
                        { name: 'Tipo de ticket', value: `\`${ticket.category || 'desconhecido'}\``, inline: true },
                        { name: 'Dono', value: `<@${ticket.userId}>`, inline: true }
                    )
                    .setFooter({ text: 'Só afeta este ticket. A IA do resto do servidor continua normal.' })
                    .setTimestamp()],
                flags: 64
            });
        }

        const desligar = action === 'off';
        await TicketManager.setTicketAi(interaction.guild.id, canal.id, desligar);
        if (desligar) {
            try { TicketQueue.cancel(canal.id, { removerRefs: true }); } catch (e) {}
        }
        await TicketManager.refreshTicketAi(true);

        // Se reativou, a sessão precisa perder o aviso de "IA desligada"
        if (!desligar) {
            try {
                const sess = TicketManager.getSession(canal.id);
                if (sess) delete sess.aiAvisou;
            } catch (e) { /* sem sessão ativa: normal */ }
        }

        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle(desligar ? '🔴 IA desligada neste ticket' : '🟢 IA religada neste ticket')
                .setDescription(desligar
                    ? 'A partir de agora o bot **não responde automaticamente** aqui. Quando alguém escrever, a equipe é chamada no canal.'
                    : 'A resposta automática voltou a funcionar neste ticket.')
                .setColor(desligar ? Colors.Orange : Colors.Green)
                .addFields(
                    { name: 'Canal', value: `${canal}`, inline: false },
                    { name: 'Efeito', value: desligar
                        ? 'Usuário é avisado e a staff é chamada. O ticket de **denúncia** não é afetado (não usa IA).'
                        : 'O bot volta a responder as perguntas pelo conhecimento.', inline: false }
                )
                .setFooter({ text: 'Só este ticket. Use /ai-ticket status para conferir.' })
                .setTimestamp()],
            flags: 64
        });
    }
};
