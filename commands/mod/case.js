const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, Colors } = require('discord.js');
const ModerationLog = require('../../utils/ModerationLog');
const Paginator = require('../../utils/paginator');
const { formatDate } = require('../../utils/formatters');

function severidade(s) {
    return { critical: '🔴 Crítica', high: '🟠 Alta', medium: '🟡 Média', low: '🟢 Baixa' }[s] || s || '—';
}

function buildCaso(reg, numero) {
    return new EmbedBuilder()
        .setColor(Colors.Orange)
        .setTitle(`📋 Caso #${numero}`)
        .addFields(
            { name: '👤 Usuário', value: `${reg.userTag || '—'}\n\`${reg.userId}\``, inline: true },
            { name: '🕒 Quando', value: formatDate(reg.ts), inline: true },
            { name: '⚖️ Ação', value: String(reg.acao || '—'), inline: true },
            { name: '📂 Origem', value: String(reg.origem || '—'), inline: true },
            { name: '🚨 Severidade', value: severidade(reg.severidade), inline: true },
            { name: '📝 Motivo', value: String(reg.palavra || '—').slice(0, 1024), inline: false },
            { name: '🤖 Decisão', value: String(reg.via || '—'), inline: true },
            { name: '📍 Canal', value: reg.channelId ? `<#${reg.channelId}>` : '—', inline: true }
        )
        .setFooter({ text: 'HostVille • BOT' })
        .setTimestamp();
}

function buildLista(pagina, indice, total, userOpt) {
    const embed = new EmbedBuilder()
        .setColor(Colors.Orange)
        .setTitle(`📋 Casos${userOpt ? ` de ${userOpt.tag}` : ''}`)
        .setDescription(`**${total}** caso(s) no log`)
        .setFooter({ text: `Página ${indice + 1} de ${Math.ceil(total / 5)}` })
        .setTimestamp();
    pagina.forEach((reg, i) => {
        const numero = indice * 5 + i + 1;
        embed.addFields({
            name: `#${numero} · ${formatDate(reg.ts)} · ${reg.userTag || reg.userId}`,
            value: `**${reg.acao}** · ${reg.origem} · ${reg.severidade}\n${String(reg.palavra || '—').slice(0, 200)}`,
            inline: false
        });
    });
    return embed;
}
module.exports = {
    data: new SlashCommandBuilder()
        .setName('case')
        .setDescription('📋 Lista os casos do log de moderação')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(opt => opt.setName('user').setDescription('Filtrar por usuário').setRequired(false))
        .addStringOption(opt => opt.setName('id').setDescription('Número do caso (1 = mais recente)').setRequired(false)),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });
        }
        await interaction.deferReply({ flags: 64 });
        const guildId = interaction.guild.id;
        const userOpt = interaction.options.getUser('user');
        const idOpt = interaction.options.getString('id');
        let lista = ModerationLog.recentes(100, guildId);
        if (userOpt) lista = lista.filter(r => r.userId === userOpt.id);
        if (idOpt) {
            const n = parseInt(idOpt, 10);
            if (!Number.isFinite(n) || n < 1 || n > lista.length) {
                return interaction.editReply({ content: `❌ Caso \`${idOpt}\` não encontrado. Vão de 1 a ${lista.length}.` });
            }
            return interaction.editReply({ embeds: [buildCaso(lista[n - 1], n)] });
        }
        if (!lista.length) {
            return interaction.editReply({ content: userOpt ? '✅ Nenhum caso para este usuário.' : '✅ Nenhum caso registrado.' });
        }
        const paginador = Paginator.criar({ itens: lista, porPagina: 5, buildEmbed: (p, i, t) => buildLista(p, i, t, userOpt) });
        return Paginator.enviar(interaction, paginador, 'case');
    }
};
