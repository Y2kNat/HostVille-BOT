const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const estados = new Map();
const EXPIRA_MS = 15 * 60 * 1000;
const DEBOUNCE_MS = 500;

function criar({ itens, porPagina = 5, buildEmbed }) {
    const total = Array.isArray(itens) ? itens.length : 0;
    const paginas = Math.max(1, Math.ceil(total / porPagina));
    const fatiar = (i) => itens.slice(i * porPagina, (i + 1) * porPagina);
    return { paginas, embed: (i) => buildEmbed(fatiar(i), i, total) };
}

function controles(chave, pagina, total) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${chave}_prev`).setLabel('Anterior').setStyle(ButtonStyle.Secondary).setDisabled(pagina === 0),
        new ButtonBuilder().setCustomId(`${chave}_info`).setLabel(`${pagina + 1}/${total}`).setStyle(ButtonStyle.Primary).setDisabled(true),
        new ButtonBuilder().setCustomId(`${chave}_next`).setLabel('Próximo').setStyle(ButtonStyle.Secondary).setDisabled(pagina >= total - 1)
    );
}

async function enviar(interaction, paginador, chavePrefixo = 'pag') {
    const embed = paginador.embed(0);
    const row = controles(chavePrefixo, 0, paginador.paginas);
    const msg = await interaction.editReply({ embeds: [embed], components: paginador.paginas > 1 ? [row] : [] });
    estados.set(msg.id, { paginador, pagina: 0, autorId: interaction.user.id, chavePrefixo, atualizadoEm: Date.now() });
    return msg;
}
async function clicar(interaction) {
    const estado = estados.get(interaction.message.id);
    if (!estado) return false;
    const { paginador, autorId, chavePrefixo } = estado;
    if (interaction.user.id !== autorId) {
        return interaction.reply({ content: '❌ Só quem pediu pode navegar.', flags: 64 });
    }
    if (Date.now() - estado.atualizadoEm < DEBOUNCE_MS) return interaction.deferUpdate();
    if (interaction.customId === `${chavePrefixo}_prev`) estado.pagina = Math.max(0, estado.pagina - 1);
    else if (interaction.customId === `${chavePrefixo}_next`) estado.pagina = Math.min(paginador.paginas - 1, estado.pagina + 1);
    else return interaction.deferUpdate();
    estado.atualizadoEm = Date.now();
    await interaction.update({ embeds: [paginador.embed(estado.pagina)], components: [controles(chavePrefixo, estado.pagina, paginador.paginas)] });
    return true;
}

function expirar(messageId) { estados.delete(messageId); }
function limpar() {
    const agora = Date.now();
    for (const [id, e] of estados) if (agora - e.atualizadoEm > EXPIRA_MS) estados.delete(id);
}
setInterval(limpar, 60000).unref?.();

module.exports = { criar, enviar, clicar, expirar, limpar, _estados: estados };
