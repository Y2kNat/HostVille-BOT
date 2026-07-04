const { EmbedBuilder } = require('discord.js');
const db = require('../database/db');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class TicketSuporte {

    static async start(channel, user, guildId) {
        const embed = new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle('🆘 Ticket de Suporte')
            .setDescription(`E aí ${user.username}, beleza? 👋\n\nVocê abriu um ticket de **suporte**.\nPode falar o que está acontecendo que vou te ajudar!`)
            .setFooter({ text: 'Descreva seu problema em detalhes' });

        await channel.send({ embeds: [embed] });
        await this.delay(1000);
        await channel.send('💬 **Qual o seu problema?** Pode falar à vontade!');
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

                const systemPrompt = `Você é o HostBot atendendo suporte técnico.
CONHECIMENTO: ${knowledgeText}
Se a pergunta combinar, USE a resposta. Se não, responda útil. Se não souber: "Vou chamar um staff!".
Máximo 4 linhas. Português brasileiro natural. Carismático.`;

                const completion = await groq.chat.completions.create({
                    model: 'llama-3.3-70b-versatile',
                    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: msg }],
                    temperature: 0.7,
                    max_tokens: 200
                });

                const response = completion.choices[0]?.message?.content?.trim();

                if (response && !response.includes('Vou chamar')) {
                    await message.channel.send({ embeds: [
                        new EmbedBuilder().setColor(0x2ecc71).setDescription(response).setFooter({ text: '🤖 Resposta automática' })
                    ]});
                } else {
                    await message.channel.send('🤔 Vou chamar um staff pra te ajudar melhor! 🦾');
                    const conn = db.getConnection(session.guildId);
                    if (conn?.staffRoleId) await message.channel.send(`<@&${conn.staffRoleId}>`);
                }

                await this.delay(500);
                await message.channel.send('❓ **Mais alguma coisa?** (sim/não)');
            } catch (e) {
                await message.channel.send('❓ **Mais alguma coisa?** (sim/não)');
            }
        } else {
            // Resposta sim/não
            const positives = ['sim', 's', 'yes', 'y', 'tenho', 'claro', 'ok'];
            if (positives.includes(msg.toLowerCase().trim())) {
                session.step = 0;
                await message.channel.send('💬 **Manda aí!** O que mais precisa?');
            } else {
                await message.channel.send({ embeds: [
                    new EmbedBuilder().setColor(0x57F287).setDescription('👋 **Valeu!** Um staff continua com você. Tamo junto! 🤙')
                ]});
                session.state = 'done';
            }
        }
    }

    static delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = TicketSuporte;
