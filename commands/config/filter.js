const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');
const db = require('../../database/db');
const { isAdmin } = require('../../utils/permissions');
const StatsManager = require('../../managers/StatsManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('filter')
        .setDescription('📝 Gerencia palavras ofensivas customizadas')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Ação a ser executada')
                .setRequired(true)
                .addChoices(
                    { name: 'Adicionar palavra', value: 'add' },
                    { name: 'Remover palavra', value: 'remove' },
                    { name: 'Listar palavras', value: 'list' }
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
        
        if (action === 'add' && word) {
            const added = await db.addCustomWord(word);
            if (!added) {
                return interaction.reply({ content: `⚠️ A palavra "${word}" já está na lista.`, flags: 64 });
            }
            return interaction.reply({ content: `✅ Palavra "${word}" adicionada à lista.`, flags: 64 });
        }
        
        if (action === 'remove' && word) {
            await db.removeCustomWord(word);
            return interaction.reply({ content: `✅ Palavra "${word}" removida da lista.`, flags: 64 });
        }
        
        if (action === 'list') {
            const customWords = await db.getCustomWords();
            if (customWords.length === 0) {
                return interaction.reply({ content: '📋 Nenhuma palavra customizada adicionada.', flags: 64 });
            }
            
            const embed = new EmbedBuilder()
                .setTitle('📋 Palavras Customizadas - HostVille • BOT')
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