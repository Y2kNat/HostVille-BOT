const { exec } = require('child_process');

class RestartManager {

    static async restart(client, message) {
        // Verificar se é o dono
        const ownerId = process.env.OWNER_ID;
        if (message.author.id !== ownerId) {
            await message.reply({ content: '❌ Apenas o DONO pode reiniciar o bot.' });
            return;
        }

        await message.reply({ content: '🔄 Reiniciando... Até já! 👋' });

        // Salvar flag para não mandar "salve" ao reiniciar
        const fs = require('fs');
        fs.writeFileSync('./temp/restart_flag.txt', 'true');

        // Aguardar 2 segundos e reiniciar
        setTimeout(() => {
            process.exit(0); // Sai do processo
            // O tmux vai reiniciar automaticamente se tiver o script
        }, 2000);
    }
}

module.exports = RestartManager;
