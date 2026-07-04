const { EmbedBuilder } = require('discord.js');
const db = require('../database/db');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class TicketDuvidas {

    static async start(channel, user, guildId) {
        const embed = new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle('❓ Ticket de Dúvidas')
            .setDescription(`E aí ${user.username}! 👋\n\nVocê abriu um ticket de **dúvidas**.\nPode perguntar sobre RP, frequência, regras, ou qualquer coisa!`)
            .setFooter({ text: 'Nenhuma dúvida é boba. Pode perguntar!' });

        await channel.send({ embeds: [embed] });
        await this.delay(1000);
        await channel.send('💬 **Qual sua dúvida?** Tô aqui pra ajudar!');
    }

    static async process(message, session) {
        const msg = message.content;

        if (session.step === 0) {
            session.question = msg;
            session.step = 1;

            await message.channel.sendTyping();
            
            try {
                const knowledge = db.getKnowledge(session.guildId);
                let knowledgeText = '';
                for (const [id, entry] of Object.entries(knowledge)) {
                    knowledgeText += `- "${entry.keywords.join(', ')}" → "${entry.response}"\n`;
                }

                const systemPrompt = `Você é o HostBot tirando dúvidas.
CONHECIMENTO: ${knowledgeText}
Se a dúvida combinar, USE a resposta. Se não, responda de forma útil e amigável.
Máximo 4 linhas. Português brasileiro natural. Carismático. Use gírias leves.`;

                const completion = await groq.chat.completions.create({
                    model: 'llama-3.3-70b-versatile',
                    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: msg }],
                    temperature: 0.8,
                    max_tokens: 200
                });

                const response = completion.choices[0]?.message?.content?.trim();

                if (response) {
                    await message.channel.send({ embeds: [
                        new EmbedBuilder().setColor(0xf1c40f).setDescription(response).setFooter({ text: '🤖 Resposta automática' })
                    ]});
                } else {
                    await message.channel.send('🤔 Essa eu não sei... Vou chamar um staff! 🦾');
                    const conn = db.getConnection(session.guildId);
                    if (conn?.staffRoleId) await message.channel.send(`<@&${conn.staffRoleId}>`);
                }

                await this.delay(500);
                await message.channel.send('❓ **Mais alguma dúvida?** (sim/não)');
            } catch (e) {
                await message.channel.send('❓ **Mais alguma dúvida?** (sim/não)');
            }
        } else {
            const positives = ['sim', 's', 'yes', 'y', 'tenho', 'claro', 'ok'];
            if (positives.includes(msg.toLowerCase().trim())) {
                session.step = 0;
                await message.channel.send('💬 **Manda aí!** Qual a próxima dúvida?');
            } else {
                await message.channel.send({ embeds: [
                    new EmbedBuilder().setColor(0x57F287).setDescription('👋 **Valeu!** Qualquer coisa é só chamar. Tamo junto! 🤙')
                ]});
                session.state = 'done';
            }
        }
    }

    static delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = TicketDuvidas;
