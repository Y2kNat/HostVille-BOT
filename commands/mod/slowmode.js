const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const StatsManager = require('../../managers/StatsManager');
const { logInfo } = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('slowmode')
        .setDescription('⏱️ Ajusta o modo lento do canal')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addIntegerOption(opt => opt.setName('segundos').setDescription('Segundos entre mensagens (0 desliga)').setRequired(true).setMinValue(0).setMaxValue(21600)),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.reply({ content: '❌ Sem permissão para gerenciar canais.', flags: 64 });
        }
        const canal = interaction.channel;
        const segundos = interaction.options.getInteger('segundos');
        if (canal.type === ChannelType.GuildVoice || canal.type === ChannelType.GuildStageVoice) {
            return interaction.reply({ content: '❌ Modo lento não existe em canal de voz.', flags: 64 });
        }
        try {
            await canal.setRateLimitPerUser(segundos);
            StatsManager.trackCommand('slowmode');
            await interaction.reply({
                content: segundos === 0 ? `✅ Modo lento **desligado** em <#${canal.id}>.` : `✅ Modo lento em <#${canal.id}>: **${segundos}s** por pessoa.`,
                flags: 64
            });
            logInfo(`Slowmode: ${interaction.user.tag} → ${segundos}s em #${canal.name}`);
        } catch (e) {
            await interaction.reply({ content: `❌ Não consegui aplicar: ${e.message}`, flags: 64 });
        }
    }
};