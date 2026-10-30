require('dotenv').config();
const { REST, Routes, Client, GatewayIntentBits, Partials } = require('discord.js');

/**
 * Limpa TODOS os comandos do bot no Discord:
 *   - comandos globais (application commands)
 *   - comandos de cada servidor (guild commands)
 *
 * Depois é só ligar o bot: events/ready.js registra os comandos por servidor.
 *
 * Uso: node deploy.js
 */

const TOKEN = process.env.TOKEN;
const APP_ID = process.env.CLIENT_ID;

if (!TOKEN || !APP_ID) {
    console.error('❌ Faltou TOKEN ou CLIENT_ID no .env');
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    const client = new Client({
        intents: [GatewayIntentBits.Guilds],
        partials: [Partials.Guild]
    });

    try {
        await client.login(TOKEN);

        // 1) Globais
        const globais = await rest.get(Routes.applicationCommands(APP_ID));
        if (Array.isArray(globais) && globais.length) {
            await rest.put(Routes.applicationCommands(APP_ID), { body: [] });
            console.log(`🗑️  ${globais.length} comando(s) global(is) removido(s): ${globais.map(c => c.name).join(', ')}`);
        } else {
            console.log('✅ Nenhum comando global para remover.');
        }

        // 2) Por servidor
        const guilds = [...client.guilds.cache.values()];
        for (const guild of guilds) {
            const porServidor = await rest.get(Routes.applicationGuildCommands(APP_ID, guild.id));
            if (Array.isArray(porServidor) && porServidor.length) {
                await rest.put(Routes.applicationGuildCommands(APP_ID, guild.id), { body: [] });
                console.log(`🗑️  ${porServidor.length} comando(s) removido(s) em "${guild.name}"`);
            } else {
                console.log(`✅ "${guild.name}" não tinha comandos.`);
            }
        }

        console.log('\n✅ Tudo limpo. Ligue o bot com "npm start" para registrar os comandos por servidor.');
    } catch (error) {
        console.error('❌ Erro ao limpar comandos:', error.message || error);
        process.exitCode = 1;
    } finally {
        client.destroy();
        process.exit(process.exitCode || 0);
    }
})();