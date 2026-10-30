const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');
const StatsManager = require('../../managers/StatsManager');
const FilterManager = require('../../managers/FilterManager');

/**
 * /modtest — mostra a decisão do filtro de moderação sobre um texto.
 *
 * Não apaga nada, não dá warn, não gera punição. Existe para a staff
 * calibrar o filtro sem punir ninguém de verdade: o texto é analisado,
 * o resultado é mostrado, e a mensagem some da vista de todo mundo.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('modtest')
        .setDescription('🧪 Testa um texto no filtro de moderação, sem punir ninguém')
        .addStringOption(option =>
            option.setName('texto')
                .setDescription('A frase que o filtro deve avaliar')
                .setRequired(true)),

    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });
        }

        const texto = interaction.options.getString('texto');
        StatsManager.trackCommand('modtest');

        const filtroAtivo = FilterManager.isChannelEnabled(interaction.guild.id, interaction.channel.id);
        const r = await FilterManager.decide(texto);
        const puniria = FilterManager.shouldPunish(r);
        const termo = FilterManager.findOffensiveWord(r);

        const cor = puniria ? Colors.Red : (r.severity === 'low' ? Colors.Orange : Colors.Green);
        const veredito = puniria
            ? '🔴 APAGARIA + WARN'
            : (r.aiStatus === 'unavailable'
                ? '🟠 NÃO PUNE (IA indisponível)'
                : (r.aiStatus === 'classified' ? '🟢 NÃO PUNE (IA classificou)' : '🟢 NÃO PUNE'));

        const embed = new EmbedBuilder()
            .setTitle('🧪 Resultado do teste de moderação')
            .setColor(cor)
            .addFields(
                { name: '📝 Texto', value: `\`\`\`\n${texto.substring(0, 500)}\n\`\`\``, inline: false },
                { name: '⚖️ Veredito', value: veredito, inline: true },
                { name: '📊 Severidade', value: `\`${r.severity}\``, inline: true },
                { name: '🗂 Categoria', value: r.category ? `\`${r.category}\`` : '—', inline: true },
                { name: '🎯 Confiança', value: `${r.confidence}`, inline: true },
                { name: '🧠 Origem', value: `aiStatus: \`${r.aiStatus}\`${r.requiresAI ? ' · requiresAI: true' : ''}`, inline: true },
                { name: '🔁 Decisão', value: `\`${r.decision}\``, inline: true }
            )
            .setFooter({ text: 'Nada foi apagado. Nenhum warn foi aplicado.' })
            .setTimestamp();

        if (termo) {
            embed.addFields({ name: '🚫 Termo encontrado', value: `\`${termo}\``, inline: false });
        }
        if (Array.isArray(r.matched) && r.matched.length > 1) {
            embed.addFields({
                name: '📚 Todos os termos',
                value: r.matched.slice(0, 12).map(m => `\`${m.text}\` (${m.matchType || m.type})`).join('\n').slice(0, 1000),
                inline: false
            });
        }
        if (Array.isArray(r.reasons) && r.reasons.length) {
            embed.addFields({ name: '🧾 Motivos', value: r.reasons.join(', ').slice(0, 1000), inline: false });
        }
        if (r.aiStatus === 'unavailable') {
            embed.addFields({
                name: '⚠️ Por que',
                value: `A IA de moderação não respondeu (\`${r.aiError || 'indisponível'}\`). ` +
                       'Isso **não** significa que o texto é limpo: significa que não deu para classificar. ' +
                       'Na prática, uma mensagem assim passa sem punição.',
                inline: false
            });
        }
        if (!filtroAtivo) {
            embed.addFields({
                name: '🔕 Canal sem filtro',
                value: 'O filtro de linguagem está **desligado neste canal** (`/filter disable`), então nenhuma mensagem aqui seria apagada.',
                inline: false
            });
        }

        // ephemeral: só quem mandou vê
        return interaction.reply({ embeds: [embed], flags: 64 });
    }
};
