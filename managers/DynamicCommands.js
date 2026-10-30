const db = require('../database/db');
const kilo = require('./KiloClient');

class DynamicCommands {

    static async create(guildId, name, response) {
        const commands = await this.getAll(guildId);
        commands[name.toLowerCase()] = {
            response,
            createdAt: Date.now(),
            uses: 0
        };
        await this.saveAll(guildId, commands);
        return true;
    }

    static async delete(guildId, name) {
        const commands = await this.getAll(guildId);
        if (commands[name.toLowerCase()]) {
            delete commands[name.toLowerCase()];
            await this.saveAll(guildId, commands);
            return true;
        }
        return false;
    }

    static async execute(message, commandName, guildId) {
        const commands = await this.getAll(guildId);
        const cmd = commands[commandName.toLowerCase()];
        
        if (!cmd) return null;

        cmd.uses = (cmd.uses || 0) + 1;
        await this.saveAll(guildId, commands);

        if (cmd.response.includes('{ia}')) {
            try {
                const question = message.content.replace(commandName, '').trim();
                const reply = await kilo.chat({
                    messages: [
                        { role: 'system', content: 'Responda útil e carismático. Máximo 3 linhas. Português.' },
                        { role: 'user', content: question || cmd.response.replace('{ia}', '') }
                    ],
                    temperature: 0.8,
                    max_tokens: 150
                });
                return reply || cmd.response;
            } catch (e) {
                return cmd.response.replace('{ia}', '');
            }
        }

        let response = cmd.response
            .replace('{user}', message.author.username)
            .replace('{mention}', `<@${message.author.id}>`)
            .replace('{guild}', message.guild.name)
            .replace('{uses}', cmd.uses);

        return response;
    }

    static async list(guildId) {
        const commands = await this.getAll(guildId);
        return Object.entries(commands).map(([name, cmd]) => ({
            name,
            response: cmd.response.substring(0, 50),
            uses: cmd.uses || 0
        }));
    }

    static async getAll(guildId) {
        const conn = await db.getConnection(guildId) || {};
        return conn.dynamicCommands || {};
    }

    static async saveAll(guildId, commands) {
        const conn = await db.getConnection(guildId) || {};
        conn.dynamicCommands = commands;
        await db.saveConnection(guildId, conn);
    }
}

module.exports = DynamicCommands;
