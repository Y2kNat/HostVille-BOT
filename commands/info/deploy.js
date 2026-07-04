const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deploy')
        .setDescription('🔄 Registrar comandos slash manualmente')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const commands = [];
            
            // Carregar comandos
            const folders = ['mod', 'config', 'info', 'staff', 'ticket'];
            
            for (const folder of folders) {
                const folderPath = path.join(__dirname, '..', folder);
                if (!fs.existsSync(folderPath)) continue;
                
                const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.js'));
                for (const file of files) {
                    const cmd = require(path.join(folderPath, file));
                    if (cmd.data) commands.push(cmd.data);
                }
            }

            // Registrar
            await interaction.guild.commands.set(commands);
            
            await interaction.editReply(`✅ ${commands.length} comandos registrados com sucesso!`);
        } catch (error) {
            await interaction.editReply(`❌ Erro: ${error.message}`);
        }
    }
};
