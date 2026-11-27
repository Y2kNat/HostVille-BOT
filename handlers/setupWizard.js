const { EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');
const db = require('../database/db');

const PASSOS = [
    { id: 'staffRole', titulo: 'Cargo de staff', tipo: 'role' },
    { id: 'logChannel', titulo: 'Canal de log', tipo: 'channel' },
    { id: 'voiceChannel', titulo: 'Canal de voz da staff', tipo: 'voice' },
    { id: 'resumo', titulo: 'Resumo', tipo: 'resumo' }
];
const sessoes = new Map();
const EXPIRA_MS = 10 * 60 * 1000;

function pegar(userId) {
    const s = sessoes.get(userId);
    if (!s) return null;
    if (Date.now() - s.atualizadoEm > EXPIRA_MS) { sessoes.delete(userId); return null; }
    s.atualizadoEm = Date.now();
    return s;
}

function render(s) {
    const passo = PASSOS[s.passo];
    const embed = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setTitle(`⚙️ Setup — passo ${s.passo + 1}/${PASSOS.length}`)
        .setDescription(passo.titulo)
        .setFooter({ text: 'Seus valores só são gravados no botão Aplicar.' });
    const row = new ActionRowBuilder();
    if (passo.tipo === 'role') {
        row.addComponents(new RoleSelectMenuBuilder().setCustomId('setup_role').setPlaceholder('Escolha o cargo de staff'));
    } else if (passo.tipo === 'channel' || passo.tipo === 'voice') {
        row.addComponents(new ChannelSelectMenuBuilder()
            .setCustomId('setup_channel')
            .setChannelTypes(passo.tipo === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText)
            .setPlaceholder('Escolha o canal'));
    }
    const nav = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('setup_voltar').setLabel('Voltar').setStyle(ButtonStyle.Secondary).setDisabled(s.passo === 0),
        new ButtonBuilder().setCustomId('setup_avancar').setLabel('Avançar').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('setup_cancelar').setLabel('Cancelar').setStyle(ButtonStyle.Danger)
    );
    if (passo.tipo === 'resumo') {
        nav.addComponents(new ButtonBuilder().setCustomId('setup_aplicar').setLabel('Aplicar').setStyle(ButtonStyle.Success));
    }
    return { embeds: [embed], components: passo.tipo === 'resumo' ? [nav] : [row, nav] };
}
async function handleSetup(interaction) {
    const s = pegar(interaction.user.id);
    if (!s) return interaction.reply({ content: '⏱️ Sessão de setup expirada. Rode /setup de novo.', flags: 64 });
    if (interaction.customId === 'setup_voltar') { s.passo = Math.max(0, s.passo - 1); return interaction.update(render(s)); }
    if (interaction.customId === 'setup_avancar') { s.passo = Math.min(PASSOS.length - 1, s.passo + 1); return interaction.update(render(s)); }
    if (interaction.customId === 'setup_cancelar') {
        sessoes.delete(interaction.user.id);
        return interaction.update({ embeds: [new EmbedBuilder().setColor(Colors.Green).setTitle('⚙️ Setup cancelado')], components: [] });
    }
    if (interaction.customId === 'setup_role') { s.valores.staffRole = interaction.values[0]; s.passo++; return interaction.update(render(s)); }
    if (interaction.customId === 'setup_channel') {
        s.valores[PASSOS[s.passo].id] = interaction.values[0];
        s.passo++;
        return interaction.update(render(s));
    }
    if (interaction.customId === 'setup_aplicar') {
        await interaction.deferUpdate();
        const v = s.valores;
        if (v.staffRole) await db.updateConfig(interaction.guild.id, { staffRoleId: v.staffRole });
        if (v.logChannel) await db.updateConfig(interaction.guild.id, { logChannelId: v.logChannel });
        await db.saveConnection(interaction.guild.id, {
            communityGuildId: interaction.guild.id,
            answer: v.logChannel || '',
            staffRoleId: v.staffRole || '',
            voice: v.voiceChannel || ''
        });
        sessoes.delete(interaction.user.id);
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(Colors.Green).setTitle('⚙️ Setup aplicado').setDescription('Configuração salva.')], components: [] });
    }
}

function iniciar(userId) {
    sessoes.set(userId, { passo: 0, valores: {}, atualizadoEm: Date.now() });
    return render(sessoes.get(userId));
}

module.exports = { handleSetup, iniciar, PASSOS };
