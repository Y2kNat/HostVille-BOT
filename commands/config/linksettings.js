const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/db');
const { isAdmin } = require('../../utils/permissions');
const StatsManager = require('../../managers/StatsManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('linksettings')
        .setDescription('🔗 Filtro anti-link deste servidor (convites e domínios permitidos)')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Ação')
                .setRequired(true)
                .addChoices(
                    { name: 'Ativar/Desativar bloqueio de convites', value: 'toggle_invites' },
                    { name: 'Adicionar domínio permitido', value: 'add_domain' },
                    { name: 'Remover domínio permitido', value: 'remove_domain' },
                    { name: 'Listar domínios permitidos', value: 'list_domains' }
                ))
        .addStringOption(option =>
            option.setName('domain')
                .setDescription('Domínio (ex: youtube.com)')
                .setRequired(false)),
    
    async execute(interaction) {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: '❌ Sem permissão.', flags: 64 });
        }
        
        const action = interaction.options.getString('action');
        const domain = interaction.options.getString('domain')?.toLowerCase().trim();
        const cfg = await db.getLinkSettings(interaction.guild.id);
        StatsManager.trackCommand('linksettings');
        
        if (action === 'toggle_invites') {
            cfg.deleteInvites = !cfg.deleteInvites;
            await db.setLinkSettings(interaction.guild.id, cfg);
            return interaction.reply({
                content: `✅ Bloqueio de convites em ${interaction.guild.name}: **${cfg.deleteInvites ? 'ATIVADO' : 'DESATIVADO'}**`,
                flags: 64
            });
        }
        
        if (action === 'add_domain' && domain) {
            if (cfg.allowedDomains.includes(domain)) {
                return interaction.reply({ content: `⚠️ ${domain} já está na lista.`, flags: 64 });
            }
            cfg.allowedDomains.push(domain);
            await db.setLinkSettings(interaction.guild.id, cfg);
            return interaction.reply({ content: `✅ ${domain} adicionado à lista de permitidos deste servidor.`, flags: 64 });
        }
        
        if (action === 'remove_domain' && domain) {
            cfg.allowedDomains = cfg.allowedDomains.filter(d => d !== domain);
            await db.setLinkSettings(interaction.guild.id, cfg);
            return interaction.reply({ content: `✅ ${domain} removido da lista deste servidor.`, flags: 64 });
        }
        
        if (action === 'list_domains') {
            if (cfg.allowedDomains.length === 0) {
                return interaction.reply({ content: '📋 Nenhum domínio na lista de permitidos deste servidor.', flags: 64 });
            }
            return interaction.reply({
                content: `📋 **Domínios permitidos em ${interaction.guild.name}:**\n${cfg.allowedDomains.join('\n')}`,
                flags: 64
            });
        }
        
        return interaction.reply({ content: '❌ Ação inválida.', flags: 64 });
    }
};