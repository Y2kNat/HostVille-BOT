const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config');
const StatsManager = require('../../managers/StatsManager');
const { confereAcesso } = require('../../utils/accessCode');
const { logInfo } = require('../../utils/logger');
const { menuInicial } = require('../../handlers/adminPanel');

/**
 * `/adm` — porta de entrada do painel.
 *
 * Este arquivo só faz TRÊS coisas, e deliberadamente pouco:
 *   1. autentica com `confereAcesso(..., 'adm')` — tempo constante e 5
 *      tentativas por minuto;
 *   2. monta o menu com o escopo (servidor onde foi digitado, por padrão);
 *   3. devolve efêmero.
 *
 * Tudo que é decisão fica no handlers/adminPanel.js. Slash command com lógica
 * aqui dentro é como o painel ficou para trás do resto do bot: o `/adm` usava
 * `!==` no código de acesso e os botões não checavam autor, porque a
 * autorização estava escrita no arquivo errado.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('adm')
        .setDescription('🔐 Painel administrativo - HostVille • BOT')
        .addStringOption(option =>
            option.setName('code')
                .setDescription('Senha de acesso administrativo')
                .setRequired(true)),

    async execute(interaction) {
        const code = interaction.options.getString('code');

        // O portão shared com a DM: `timingSafeEqual` + rate limit. A versão
        // anterior comparava com `!==` e sem limite, e o caminho de slash não
        // passa pelo anti-spam (o messageCreate morre no isChatInputCommand),
        // então nada segurava força bruta aqui.
        const recusa = confereAcesso(interaction.user.id, code, 'adm', {
            dica: '❌ Use: `/adm SEU_CÓDIGO`'
        });
        if (recusa) {
            return interaction.reply({ content: recusa, flags: 64 });
        }

        if (!config.ACCESS_CODE) {
            logInfo('[adm] recusado: ACCESS_CODE não está definido no .env');
            return interaction.reply({
                content: '❌ Painel indisponível: nenhum `ACCESS_CODE` configurado.',
                flags: 64
            });
        }

        StatsManager.trackCommand('adm');

        // Escopo: o servidor onde o comando foi digitado. O painel tem um
        // seletor para trocar — o bot roda em vários servidores e as funções
        // são por servidor.
        const guildId = interaction.guild?.id || 'global';
        const painel = menuInicial(interaction.client, guildId, interaction.user);

        await interaction.reply({
            content: 'Painel Administrativo:',
            ...painel,
            flags: 64
        });

        logInfo(`/adm aberto por ${interaction.user.tag} | escopo=${guildId} | owner=${interaction.user.id === config.OWNER_ID}`);
    }
};
