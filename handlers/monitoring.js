const { EmbedBuilder, Colors, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const db = require('../database/db');
const { logError, logInfo } = require('../utils/logger');
const config = require('../config');

const pendingActions = new Map();

/**
 * B19 — autorização do botão de monitoramento.
 *
 * O QUE ERA
 * `handleMonitorButtons` rodava quando `customId.startsWith('monitor_')`.
 * Não validava autor, não consultava `pendingActions` e não conferia
 * `messageId`. No caminho 'all' não tocava em nenhum estado de sessão:
 * desligava a moderação, o anti-spam e o anti-link de TODOS os servidores
 * do bot de uma vez.
 *
 * O QUE É AGORA
 * O userId de quem recebeu o menu vai dentro do customId, e a chegada
 * confere. Um customId é preditível ('monitor_all_off:123'), mas só
 * carrega autoridade para quem tirou o valor de um menu que recebeu — o
 * clique ainda tem que vir de um botão real daquela mensagem.
 *
 * Correção de leitura: a AUDITORIA-3 diz que "qualquer pessoa que veja o
 * embed do menu clica, não precisa saber o ACCESS_CODE". Isso não se
 * sustenta — os botões nascem dentro da DM (handlers/dmCommands.js), e DM
 * só o dono vê. O risco real é outro: quem CONSEGUIU o código (B20) tinha
 * um botão sem nenhuma verificação de segunda linha por baixo. Isto aqui é
 * a segunda linha.
 */
function extrairAcao(customId) {
    // Formato: monitor_<acao>_<on|off>:<userId>
    const partes = String(customId || '').split('_');
    const estado = partes[2] || '';
    const [state, userId] = estado.split(':');
    return {
        action: partes[1],
        state,
        userId: userId || null
    };
}

/** A interação veio de quem recebeu o menu? */
function autorizado(interaction, esperadoUserId) {
    if (!esperadoUserId) return false;
    return interaction.user.id === esperadoUserId;
}

async function handleMonitorButtons(interaction) {
    const { action, state, userId } = extrairAcao(interaction.customId);
    const isOn = state === 'on';
    const actionText = isOn ? 'ATIVAR' : 'DESATIVAR';

    if (!autorizado(interaction, userId)) {
        logError(`[Monitoramento] clique recusado: user=${interaction.user.id} tentou ${action} de menu de user=${userId || '?'}`);
        await interaction.reply({ content: '❌ Este menu não é seu. Use `!MonitorOn ACCESS_CODE` para abrir o seu.', flags: 64 }).catch(() => {});
        return;
    }

    await interaction.deferReply({ flags: 64 });

    try {
        if (action === 'all') {
            let count = 0;
            for (const [guildId] of interaction.client.guilds.cache) {
                await db.setMonitoringStatus(guildId, isOn);
                count++;
            }

            const embed = createStatusEmbed(null, state, interaction.user);
            embed.setDescription(`✅ Monitoramento ${isOn ? 'ativado' : 'desativado'} em **${count} servidores**!`);

            await interaction.editReply({ content: `✅ Operação concluída!`, embeds: [embed] });
            setTimeout(async () => { try { await interaction.deleteReply(); } catch (e) {} }, 10000);

        } else if (action === 'select') {
            const options = [];
            let count = 0;

            for (const [guildId, guild] of interaction.client.guilds.cache) {
                if (count >= 25) break;

                const status = await db.getMonitoringStatus(guildId) ? '🟢 ATIVO' : '🔴 INATIVO';
                options.push(
                    new StringSelectMenuOptionBuilder()
                        .setLabel(guild.name.substring(0, 100))
                        .setDescription(`${guild.memberCount} membros - ${status}`)
                        .setValue(guildId)
                        .setEmoji('🏛️')
                );
                count++;
            }

            if (interaction.client.guilds.cache.size > 25) {
                options.push(
                    new StringSelectMenuOptionBuilder()
                        .setLabel('📌 Mais servidores...')
                        .setDescription('Use o comando novamente para ver outros servidores')
                        .setValue('more')
                        .setEmoji('📌')
                );
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`select_server_${state}:${interaction.user.id}`)
                .setPlaceholder('Selecione um servidor')
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            pendingActions.set(interaction.user.id, { action: state, messageId: interaction.id });

            await interaction.editReply({
                content: `🔍 **Selecione o servidor para ${actionText} o monitoramento:**`,
                components: [row]
            });
        }
    } catch (error) {
        logError(`Erro no handleMonitorButtons: ${error.message}`);
        await interaction.editReply({ content: '❌ Erro ao processar comando. Tente novamente.' });
        setTimeout(async () => { try { await interaction.deleteReply(); } catch (e) {} }, 5000);
    }
}

async function handleServerSelection(interaction) {
    await interaction.deferUpdate();
    
    try {
        const selectedValue = interaction.values[0];
        const customId = interaction.customId;
        const [state, esperadoUserId] = customId.split(':');

        // B19: o select carrega o userId de quem recebeu o menu, e a
        // chegada confere. Antes, o caminho 'select' consultava
        // pendingActions, mas o 'all' não consultava nada — e o 'all' é o
        // que desliga todos os servidores de uma vez.
        if (!autorizado(interaction, esperadoUserId)) {
            logError(`[Monitoramento] select recusado: user=${interaction.user.id} tentou ${state} de menu de user=${esperadoUserId || '?'}`);
            await interaction.reply({ content: '❌ Este menu não é seu.', flags: 64 }).catch(() => {});
            return;
        }

        const pending = pendingActions.get(interaction.user.id);
        
        if (!pending) {
            await interaction.editReply({ content: '❌ Esta seleção expirou. Use o comando novamente.', components: [] });
            setTimeout(async () => { try { await interaction.deleteReply(); } catch (e) {} }, 5000);
            return;
        }
        
        const isOn = state === 'on';
        const actionText = isOn ? 'ATIVADO' : 'DESATIVADO';
        
        if (selectedValue === 'more') {
            await interaction.editReply({
                content: '📌 **Use o comando novamente para ver mais servidores.**\nDigite `!MonitorOn` ou `!MonitorOff` novamente.',
                components: []
            });
            setTimeout(async () => { try { await interaction.deleteReply(); } catch (e) {} }, 5000);
            pendingActions.delete(interaction.user.id);
            return;
        }
        
        const guild = interaction.client.guilds.cache.get(selectedValue);
        if (!guild) {
            await interaction.editReply({ content: '❌ Servidor não encontrado.', components: [] });
            setTimeout(async () => { try { await interaction.deleteReply(); } catch (e) {} }, 5000);
            pendingActions.delete(interaction.user.id);
            return;
        }
        
        await db.setMonitoringStatus(selectedValue, isOn);
        
        const embed = createStatusEmbed(guild, state, interaction.user);
        
        await interaction.editReply({
            content: `✅ **Monitoramento ${actionText} em ${guild.name}!**`,
            embeds: [embed],
            components: []
        });
        
        setTimeout(async () => { try { await interaction.deleteReply(); } catch (e) {} }, 10000);
        pendingActions.delete(interaction.user.id);
        
    } catch (error) {
        logError(`Erro no handleServerSelection: ${error.message}`);
        await interaction.editReply({ content: '❌ Erro ao processar seleção.', components: [] });
        setTimeout(async () => { try { await interaction.deleteReply(); } catch (e) {} }, 5000);
    }
}

function createStatusEmbed(guild, action, user) {
    const isActive = action === 'on';
    const color = isActive ? Colors.Green : Colors.Red;
    const statusText = isActive ? '🟢 **ATIVO**' : '🔴 **INATIVO**';
    
    const embed = new EmbedBuilder()
        .setTitle(`🛡️ Monitoramento ${isActive ? 'Ativado' : 'Desativado'} - HostVille • BOT`)
        .setColor(color)
        .addFields(
            { name: '🛡️ Status', value: statusText, inline: true },
            { name: '🛠 Staff', value: user.toString(), inline: true },
            { name: '🗓 Data', value: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), inline: false }
        )
        .setTimestamp();
    
    if (guild) embed.addFields({ name: '🏛️ Servidor', value: guild.name, inline: true });
    
    return embed;
}

module.exports = { handleMonitorButtons, handleServerSelection, pendingActions, extrairAcao, autorizado };