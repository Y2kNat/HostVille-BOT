const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, Colors } = require('discord.js');
const LockStore = require('../../utils/lockStore');
const { logInfo } = require('../../utils/logger');
const { formatDate } = require('../../utils/formatters');

async function autoUnlock(canalId) {
    const lock = LockStore.get(canalId);
    if (!lock) return;
    const canal = await global.client.channels.fetch(canalId).catch(() => null);
    if (!canal) { LockStore.remove(canalId); return; }
    await canal.permissionOverwrites.edit(canal.guild.roles.everyone, { SendMessages: true }).catch(() => {});
    const msg = await canal.messages.fetch(lock.messageId).catch(() => null);
    if (msg) {
        const embed = EmbedBuilder.from(msg.embeds[0])
            .setColor(Colors.Green)
            .setTitle('🔓 Canal destrancado')
            .setDescription('O prazo de 4h terminou. Pode mandar mensagem.');
        await msg.edit({ embeds: [embed] }).catch(() => {});
    }
    LockStore.remove(canalId);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lock')
        .setDescription('🔒 Tranca o canal atual por 4h')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return interaction.reply({ content: '❌ Sem permissão para gerenciar cargos.', flags: 64 });
        }
        const canal = interaction.channel;
        const ja = LockStore.get(canal.id);
        if (ja) return interaction.reply({ content: `❌ Este canal já está trancado (desde ${formatDate(ja.lockedAt)}).`, flags: 64 });
        const expiresAt = Date.now() + 4 * 60 * 60 * 1000;
        try {
            await canal.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
            const embed = new EmbedBuilder()
                .setColor(Colors.DarkRed)
                .setTitle('🔒 Canal trancado')
                .setDescription('A staff bloqueou as mensagens neste canal.')
                .setFooter({ text: `Desbloqueio automático em 4h · ${interaction.user.tag}` })
                .setTimestamp();
            const msg = await canal.send({ embeds: [embed] });
            LockStore.set(canal.id, { messageId: msg.id, guildId: interaction.guild.id, lockedAt: Date.now(), expiresAt });
            setTimeout(() => autoUnlock(canal.id), 4 * 60 * 60 * 1000).unref?.();
            await interaction.reply({ content: '🔒 Canal trancado por 4h.', flags: 64 });
            logInfo(`Lock: ${interaction.user.tag} trancou #${canal.name}`);
        } catch (e) {
            await interaction.reply({ content: `❌ Erro ao trancar: ${e.message}`, flags: 64 });
        }
    },
    _autoUnlock: autoUnlock
};