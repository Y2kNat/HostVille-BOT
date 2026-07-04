const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket-setup')
        .setDescription('📋 Criar painel de atendimento com botões')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(opt =>
            opt.setName('canal')
                .setDescription('Canal onde o painel será enviado')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });

        const channel = interaction.options.getChannel('canal');
        const guildId = interaction.guild.id;

        const connection = db.getConnection(guildId);
        if (!connection) {
            return interaction.editReply({ content: '❌ Use /ticket-config primeiro.' });
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🎫 Central de Atendimento')
            .setDescription('Selecione abaixo a categoria do seu atendimento.\nNossa equipe está pronta para ajudar! 🤙')
            .setImage('https://image2url.com/r2/default/images/1771620829907-063df89a-ab09-4afa-8e32-417f5f06d867.png')
            .addFields(
                { 
                    name: '・**Denúncias**', 
                    value: 'Denúncias, ajuda técnica e revisão de punições.', 
                    inline: false 
                },
                { 
                    name: '・**Suporte**', 
                    value: 'Contestação de punições, denúncias de admins, contato com o fundador e suporte de conexão.', 
                    inline: false 
                },
                { 
                    name: '・**Dúvidas**', 
                    value: 'Dúvidas sobre o RP, frequência, como fazemos, ou qualquer coisa que podemos ajudar.', 
                    inline: false 
                }
            )
            .setFooter({ text: `${interaction.guild.name} • Central de Atendimento`, iconURL: interaction.guild.iconURL() })
            .setTimestamp();

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_denuncias')
                    .setLabel('Denúncias')
                    .setEmoji('🚨')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('ticket_suporte')
                    .setLabel('Suporte')
                    .setEmoji('🆘')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('ticket_duvidas')
                    .setLabel('Dúvidas')
                    .setEmoji('❓')
                    .setStyle(ButtonStyle.Primary)
            );

        // Remover painéis antigos deste canal
        const panels = db.tickets?.panels || {};
        for (const [id, panel] of Object.entries(panels)) {
            if (panel.channelId === channel.id && panel.guildId === guildId) {
                try {
                    const oldMsg = await channel.messages.fetch(id);
                    if (oldMsg) await oldMsg.delete();
                } catch (e) {}
                delete db.tickets.panels[id];
            }
        }

        const msg = await channel.send({ embeds: [embed], components: [buttons] });

        db.savePanel(msg.id, {
            guildId,
            channelId: channel.id,
            messageId: msg.id,
            title: 'Central de Atendimento',
            category: 'geral',
            createdAt: Date.now()
        });

        await interaction.editReply({ content: `✅ Central de atendimento criada em ${channel}!\n🚨 Denúncias | 🆘 Suporte | ❓ Dúvidas` });
    }
};