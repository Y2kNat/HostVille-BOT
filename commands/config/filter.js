const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const { isAdmin } = require('../../utils/permissions');
const StatsManager = require('../../managers/StatsManager');
const FilterManager = require('../../managers/FilterManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('filter')
        .setDescription('📝 Gerencia o filtro de palavras ofensivas')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Ação a ser executada')
                .setRequired(true)
                .addChoices(
                    { name: 'Adicionar palavra', value: 'add' },
                    { name: 'Remover palavra', value: 'remove' },
                    { name: 'Listar palavras', value: 'list' },
                    { name: 'Desligar filtro NESTE canal', value: 'disable' },
                    { name: 'Religar filtro NESTE canal', value: 'enable' },
                    { name: 'Ver status deste canal', value: 'status' }
                ))
        .addStringOption(option =>
            option.setName('word')
                .setDescription('Palavra (para add/remove)')
                .setRequired(false)),
    
    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });
        }
        
        const action = interaction.options.getString('action');
        const word = interaction.options.getString('word')?.toLowerCase().trim();
        StatsManager.trackCommand('filter');
        const canal = interaction.channel;

        // --- estado do filtro no canal -------------------------------
        if (action === 'disable' || action === 'enable') {
            const desligado = action === 'disable';
            await FilterManager.setChannelModeration(interaction.guild.id, canal.id, desligado);
            await FilterManager.refreshChannelModeration(true);
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setTitle(desligado ? '🔕 Filtro desligado neste canal' : '🔔 Filtro religado neste canal')
                    .setDescription(desligado
                        ? `Nenhuma mensagem será apagada em ${canal}. Os outros canais continuam filtrando.`
                        : `O filtro voltou a valer em ${canal}.`)
                    .setColor(desligado ? Colors.Orange : Colors.Green)
                    .setFooter({ text: 'Afeta apenas este canal.' })
                ],
                flags: 64
            });
        }

        if (action === 'status') {
            await FilterManager.refreshChannelModeration(true);
            const ativo = FilterManager.isChannelEnabled(interaction.guild.id, canal.id);
            const custom = await FilterManager.wordsFor(interaction.guild.id);
            const map = FilterManager.channelModeration[interaction.guild.id] || {};
            const desligados = Object.keys(map).length;
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('🔍 Status do filtro')
                    .setColor(ativo ? Colors.Green : Colors.Orange)
                    .addFields(
                        { name: 'Canal', value: `${canal}\nID: \`${canal.id}\``, inline: false },
                        { name: 'Filtro de linguagem', value: ativo ? '🟢 Ativo' : '🔕 Desligado', inline: true },
                        { name: 'Palavras da staff', value: `${custom.length}`, inline: true },
                        { name: 'Canais com filtro desligado', value: `${desligados} neste servidor`, inline: true }
                    )
                    .setFooter({ text: 'Use /modtest para ver a decisão do motor sobre um texto.' })
                ],
                flags: 64
            });
        }
        
        // O cadastro é POR SERVIDOR. Antes era global e o admin de qualquer
        // servidor bania palavra para a rede inteira — o `guildId` missing
        // aqui é o que produzia esse efeito.
        if (action === 'add' && word) {
            const added = await FilterManager.addWord(interaction.guild.id, word);
            if (!added) {
                return interaction.reply({ content: `⚠️ A palavra "${word}" já está na lista **deste servidor**.`, flags: 64 });
            }
            return interaction.reply({
                content: `✅ Palavra "${word}" adicionada à lista **deste servidor**.\nOs outros servidores não foram alterados.`,
                flags: 64
            });
        }
        
        if (action === 'remove' && word) {
            await FilterManager.removeWord(interaction.guild.id, word);
            return interaction.reply({
                content: `✅ Palavra "${word}" removida **neste servidor** (e da lista global, se existisse lá).`,
                flags: 64
            });
        }
        
        if (action === 'list') {
            const customWords = await FilterManager.wordsFor(interaction.guild.id);
            if (customWords.length === 0) {
                return interaction.reply({ content: '📋 Nenhuma palavra customizada adicionada.', flags: 64 });
            }
            
            const embed = new EmbedBuilder()
                .setTitle('📋 Palavras banidas — ' + interaction.guild.name)
                .setDescription(customWords.map((w, i) => `${i + 1}. ${w}`).join('\n'))
                .setColor(Colors.Blue);
            
            return interaction.reply({ embeds: [embed], flags: 64 });
        }
        
        return interaction.reply({
            content: '❌ Use: `/filter add <palavra>`, `/filter remove <palavra>` ou `/filter list`',
            flags: 64
        });
    }
};