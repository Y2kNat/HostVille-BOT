const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const PollManager = require('../../managers/PollManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('poll')
        .setDescription('📊 Configura a enquete automática')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(s => s.setName('show').setDescription('Mostra a configuração atual'))
        .addSubcommand(s => s.setName('set-title').setDescription('Define o título da enquete').addStringOption(o => o.setName('titulo').setDescription('Título').setRequired(true)))
        .addSubcommand(s => s.setName('set-message').setDescription('Define a mensagem após a enquete').addStringOption(o => o.setName('mensagem').setDescription('Mensagem').setRequired(true)))
        .addSubcommand(s => s.setName('set-channel').setDescription('Define o canal de envio').addChannelOption(o => o.setName('canal').setDescription('Canal').setRequired(true).addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(s => s.setName('add-day').setDescription('Adiciona um dia/hora').addStringOption(o => o.setName('dia').setDescription('Dia da semana').setRequired(true).addChoices(...PollManager.DIAS.map((d, i) => ({ name: d, value: String(i) })))).addStringOption(o => o.setName('hora').setDescription('HH:MM').setRequired(true)))
        .addSubcommand(s => s.setName('remove-day').setDescription('Remove um dia/hora').addStringOption(o => o.setName('dia').setDescription('Dia da semana').setRequired(true).addChoices(...PollManager.DIAS.map((d, i) => ({ name: d, value: String(i) })))).addStringOption(o => o.setName('hora').setDescription('HH:MM').setRequired(true)))
        .addSubcommand(s => s.setName('add-option').setDescription('Adiciona uma opção').addStringOption(o => o.setName('texto').setDescription('Texto da opção').setRequired(true)))
        .addSubcommand(s => s.setName('edit-option').setDescription('Edita uma opção').addIntegerOption(o => o.setName('indice').setDescription('Número da opção').setRequired(true).setMinValue(1)).addStringOption(o => o.setName('texto').setDescription('Novo texto').setRequired(true)))
        .addSubcommand(s => s.setName('remove-option').setDescription('Remove uma opção').addIntegerOption(o => o.setName('indice').setDescription('Número da opção').setRequired(true).setMinValue(1)))
        .addSubcommand(s => s.setName('test').setDescription('Envia a enquete agora')),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Só administradores.', flags: 64 });
        }
        const guildId = interaction.guild.id;
        const sub = interaction.options.getSubcommand();
        const cfg = PollManager.config(guildId);

        if (sub === 'show') {
            return interaction.reply({ content: `📊 **Enquete**\nCanal: <#${cfg.channelId}>\nTítulo: **${cfg.title}**\nOpções: ${cfg.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}\nDias: ${cfg.schedule.map(s => `${PollManager.DIAS[s.day]} ${s.time}`).join(', ')}`, flags: 64 });
        }
        if (sub === 'set-title') { cfg.title = interaction.options.getString('titulo'); PollManager.salvarConfig(guildId, cfg); return interaction.reply({ content: '✅ Título salvo.', flags: 64 }); }
        if (sub === 'set-message') { cfg.message = interaction.options.getString('mensagem'); PollManager.salvarConfig(guildId, cfg); return interaction.reply({ content: '✅ Mensagem salva.', flags: 64 }); }
        if (sub === 'set-channel') { cfg.channelId = interaction.options.getChannel('canal').id; PollManager.salvarConfig(guildId, cfg); return interaction.reply({ content: '✅ Canal salvo.', flags: 64 }); }
        if (sub === 'add-day' || sub === 'remove-day') {
            const dia = parseInt(interaction.options.getString('dia'), 10);
            const hora = interaction.options.getString('hora');
            const erro = sub === 'add-day' ? PollManager.addDay(guildId, dia, hora) : PollManager.removeDay(guildId, dia, hora);
            return interaction.reply({ content: erro ? `❌ ${erro}` : '✅ Dia salvo.', flags: 64 });
        }
        if (sub === 'add-option') {
            const erro = PollManager.addOption(guildId, interaction.options.getString('texto'));
            return interaction.reply({ content: erro ? `❌ ${erro}` : '✅ Opção adicionada.', flags: 64 });
        }
        if (sub === 'edit-option') {
            const erro = PollManager.editOption(guildId, interaction.options.getInteger('indice'), interaction.options.getString('texto'));
            return interaction.reply({ content: erro ? `❌ ${erro}` : '✅ Opção editada.', flags: 64 });
        }
        if (sub === 'remove-option') {
            const erro = PollManager.removeOption(guildId, interaction.options.getInteger('indice'));
            return interaction.reply({ content: erro ? `❌ ${erro}` : '✅ Opção removida.', flags: 64 });
        }
        if (sub === 'test') {
            await interaction.deferReply({ flags: 64 });
            const ok = await PollManager.enviar(interaction.client, guildId, cfg, 'manual-' + Date.now());
            return interaction.editReply({ content: ok ? '✅ Enquete enviada.' : '❌ Falha ao enviar.' });
        }
    }
};