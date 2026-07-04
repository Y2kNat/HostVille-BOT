const db = require('../database/db');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class DynamicCommands {

    static async create(guildId, name, response) {
        const commands = this.getAll(guildId);
        commands[name.toLowerCase()] = {
            response,
            createdAt: Date.now(),
            uses: 0
        };
        this.saveAll(guildId, commands);
        return true;
    }

    static async delete(guildId, name) {
        const commands = this.getAll(guildId);
        if (commands[name.toLowerCase()]) {
            delete commands[name.toLowerCase()];
            this.saveAll(guildId, commands);
            return true;
        }
        return false;
    }

    static async execute(message, commandName, guildId) {
        const commands = this.getAll(guildId);
        const cmd = commands[commandName.toLowerCase()];
        
        if (!cmd) return null;

        cmd.uses = (cmd.uses || 0) + 1;
        this.saveAll(guildId, commands);

        if (cmd.response.includes('{ia}')) {
            try {
                const question = message.content.replace(commandName, '').trim();
                const completion = await groq.chat.completions.create({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: 'Responda útil e carismático. Máximo 3 linhas. Português.' },
                        { role: 'user', content: question || cmd.response.replace('{ia}', '') }
                    ],
                    temperature: 0.8,
                    max_tokens: 150
                });
                return completion.choices[0]?.message?.content?.trim() || cmd.response;
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

    static list(guildId) {
        const commands = this.getAll(guildId);
        return Object.entries(commands).map(([name, cmd]) => ({
            name,
            response: cmd.response.substring(0, 50),
            uses: cmd.uses || 0
        }));
    }

    static getAll(guildId) {
        const conn = db.getConnection(guildId) || {};
        return conn.dynamicCommands || {};
    }

    static saveAll(guildId, commands) {
        const conn = db.getConnection(guildId) || {};
        conn.dynamicCommands = commands;
        db.saveConnection(guildId, conn);
    }
}

module.exports = DynamicCommands;
