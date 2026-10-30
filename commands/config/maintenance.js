const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const MaintenanceManager = require('../../managers/MaintenanceManager');
const config = require('../../config');
const { sendLog } = require('../../utils/realtime');
const { logInfo } = require('../../utils/logger');

function buildData(name = 'maintenance') {
    return new SlashCommandBuilder()
        .setName(name)
        .setDescription('🔧 Liga/desliga a manutenção do bot')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt => opt
            .setName('motivo')
            .setDescription('Motivo exibido aos usuários (só ao ligar)')
            .setRequired(false));
}

async function execute(interaction) {
    if (interaction.user.id !== config.OWNER_ID) {
        await interaction.reply({ content: '❌ Apenas o **dono do bot** pode usar este comando.', flags: 64 });
        return;
    }

    const atual = MaintenanceManager.getData();
    const motivo = interaction.options.getString('motivo');

    if (atual.enabled) {
        MaintenanceManager.setData({ enabled: false, motivo: '', updatedBy: '', updatedAt: null });
        await interaction.reply({ content: '✅ **Manutenção DESLIGADA.** O bot voltou ao normal.', flags: 64 });
        logInfo(`🔧 Manutenção desligada por ${interaction.user.tag}`);
        sendLog(`🔧 Manutenção desligada por ${interaction.user.tag}`, 'success', 'system');
        return;
    }

    const texto = motivo || 'Estou passando por uma manutenção, volto já já!';
    MaintenanceManager.setData({
        enabled: true,
        motivo: texto,
        updatedBy: interaction.user.id,
        updatedAt: Date.now()
    });

    await interaction.reply({
        content: `🔧 **Manutenção LIGADA!**\n📌 Motivo: **${texto}**\nO bot agora só responde quando for chamado.`,
        flags: 64
    });
    logInfo(`🔧 Manutenção ligada por ${interaction.user.tag} | Motivo: ${texto}`);
    sendLog(`🔧 Manutenção ligada por ${interaction.user.tag} | Motivo: ${texto}`, 'warn', 'system');
}

module.exports = { data: buildData('maintenance'), buildData, execute };
