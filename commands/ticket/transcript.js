const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const db = require('../../database/db');
const { isAdmin } = require('../../utils/permissions');
const StatsManager = require('../../managers/StatsManager');
const { TranscriptArchive } = require('../../utils/TranscriptArchive');

/**
 * /transcript — liga, desliga ou consulta a geração de PDF das transcrições.
 *
 * Só admin. Afeta o servidor inteiro.
 *
 * Desligar NÃO impede o fechamento do ticket nem apaga nada: apenas o bot
 * para de gravar e de gerar o PDF. Tickets já abertos continuam acumulando
 * mensagens e o PDF é gerado normalmente se você religar antes de fechar.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('transcript')
        .setDescription('📄 Liga, desliga ou consulta a geração de PDF das transcrições')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('O que fazer')
                .setRequired(true)
                .addChoices(
                    { name: '📄 Desligar transcrições', value: 'off' },
                    { name: '✅ Ligar transcrições', value: 'on' },
                    { name: '📊 Ver status', value: 'status' }
                ))
        .addStringOption(option =>
            option.setName('resumo')
                .setDescription('Gerar o resumo com IA (consome tokens)')
                .setRequired(false)
                .addChoices(
                    { name: 'Ligar resumo com IA', value: 'on' },
                    { name: 'Desligar resumo com IA', value: 'off' }
                )),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: '❌ Só administradores podem usar este comando.', flags: 64 });
        }

        const action = interaction.options.getString('action');
        const opcaoResumo = interaction.options.getString('resumo');
        const guildId = interaction.guild.id;
        StatsManager.trackCommand('transcript');

        const cfg = await db.getTranscriptSettings(guildId);
        const resumoAtivo = await db.getTranscriptAiStatus(guildId);

        // ---- ajusta o resumo, se informado ----
        if (opcaoResumo !== null) {
            const novo = opcaoResumo === 'on';
            await db.setTranscriptAi(guildId, novo);
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setTitle(novo ? '🤖 Resumo com IA ativado' : '⚙️ Resumo com IA desativado')
                    .setDescription(novo
                        ? 'Ao fechar um ticket, o bot usará a IA para resumir o **problema relatado** e a **solução aplicada**.\n\nIsso consome tokens do provedor de IA.'
                        : 'O PDF será gerado sem a resumo por IA. O histórico completo das mensagens continua sendo salvo normalmente.')
                    .setColor(novo ? Colors.Green : Colors.Orange)
                    .addFields(
                        { name: 'Transcrições', value: cfg.enabled ? '🟢 Ligadas' : '🔴 Desligadas', inline: true },
                        { name: 'Resumo com IA', value: novo ? '🟢 Ligado' : '🔴 Desligado', inline: true }
                    )
                    .setFooter({ text: 'Use /transcript status para conferir.' })
                    .setTimestamp()],
                flags: 64
            });
        }

        // ---- status ----
        if (action === 'status') {
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('📄 Status das Transcrições')
                    .setColor(cfg.enabled ? Colors.Green : Colors.Orange)
                    .addFields(
                        { name: 'Servidor', value: `${interaction.guild.name}\nID: \`${guildId}\``, inline: false },
                        { name: 'Geração de PDF', value: cfg.enabled ? '🟢 Ligada' : '🔴 Desligada', inline: true },
                        { name: 'Resumo com IA', value: resumoAtivo ? '🟢 Ligado' : '🔴 Desligado', inline: true },
                        { name: 'Formato', value: 'HTML (abre no navegador, igual ao Discord)', inline: true },
                        { name: 'Quando é gerado', value: [
                            '📌 Ao usar `/close` no ticket',
                            '📌 Ao o canal do ticket ser deletado',
                        ].join('\n'), inline: false },
                        { name: 'Onde fica salvo', value: 'Na pasta `transcripts/` do bot, e é enviado no canal de logs com botão para abrir.', inline: false }
                    )
                    .setFooter({ text: 'Só administradores podem alterar.' })
                    .setTimestamp()],
                flags: 64
            });
        }

        // ---- liga / desliga ----
        const ligar = action === 'on';
        await db.setTranscriptEnabled(guildId, ligar);
        // invalida o cache para a mudanca valer na proxima mensagem
        TranscriptArchive.invalidate(guildId);

        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle(ligar ? '📄 Transcrições ativadas' : '🔴 Transcrições desativadas')
                .setDescription(ligar
                    ? 'Ao fechar ou deletar um ticket, o bot vai gerar o **HTML da conversa** com avatar, autor, horário, menções e embeds lidos como texto — igual ao Discord.'
                    : 'O bot vai **parar de gravar e gerar o PDF** das transcrições neste servidor.\n\nOs tickets continuam funcionando normalmente.')
                .setColor(ligar ? Colors.Green : Colors.Orange)
                .addFields(
                    { name: 'Servidor', value: interaction.guild.name, inline: true },
                    { name: 'Estado', value: ligar ? '🟢 Ativado' : '🔴 Desativado', inline: true },
                    ...(ligar ? [] : [{
                        name: 'Importante',
                        value: [
                            '• Tickets **já abertos** continuam gravando as mensagens em memória.',
                            '• Se religar antes de fechar, o PDF sai normalmente.',
                            '• Arquivos já gerados **não são apagados**.',
                        ].join('\n'),
                        inline: false,
                    }])
                )
                .setFooter({ text: 'Use /transcript status para conferir.' })
                .setTimestamp()],
            flags: 64
        });
    }
};
