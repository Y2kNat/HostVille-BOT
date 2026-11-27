const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, Colors } = require('discord.js');
const LockStore = require('../../utils/lockStore');
const { logInfo } = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('🔓 Destranca o canal atual')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });
        }
        const canal = interaction.channel;
        const lock = LockStore.get(canal.id);
        if (!lock) return interaction.reply({ content: '✅ Este canal não está trancado.', flags: 64 });
        try {
            await canal.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: true });
            const msg = await canal.messages.fetch(lock.messageId).catch(() => null);
            if (msg) {
                const embed = EmbedBuilder.from(msg.embeds[0])
                    .setColor(Colors.Green)
                    .setTitle('🔓 Canal destrancado')
                    .setDescription(`Desbloqueado por ${interaction.user.tag}.`)
                    .setTimestamp();
                await msg.edit({ embeds: [embed] }).catch(() => {});
            }
            LockStore.remove(canal.id);
            await interaction.reply({ content: '🔓 Canal destrancado.', flags: 64 });
            logInfo(`Unlock: ${interaction.user.tag} destrancou #${canal.name}`);
        } catch (e) {
            await interaction.reply({ content: `❌ Erro ao destrancar: ${e.message}`, flags: 64 });
        }
    }
};