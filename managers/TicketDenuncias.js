const { EmbedBuilder } = require('discord.js');
const db = require('../database/db');

class TicketDenuncias {

    static async start(channel, user, guildId) {
        const embed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('🚨 Ticket de Denúncia')
            .setDescription(`Olá ${user.username}, você abriu um ticket de **denúncia**.\n\nVamos seguir alguns passos para registrar sua denúncia corretamente.`)
            .setFooter({ text: 'Todas as informações são confidenciais' });

        await channel.send({ embeds: [embed] });
        await this.delay(1500);
        await channel.send('**1️⃣ Quem você deseja denunciar?** (Nome ou ID do jogador)');
    }

    static async process(message, session) {
        const msg = message.content;

        switch (session.step) {
            case 0:
                const staffChannel = staffGuild.channels.cache.get('1521666605887656148');session.accused = msg;
                session.step = 1;
                await message.channel.send('📝 **Registrado.**\n\n**2️⃣ Qual o motivo da denúncia?** (Descreva o que aconteceu)');
                break;

            case 1:
                session.reason = msg;
                session.step = 2;
                await message.channel.send('📝 **Registrado.**\n\n**3️⃣ Você tem provas?** (prints, vídeos, testemunhas)\nSe sim, envie os links ou descreva.');
                break;

            case 2:
                session.proofs = msg;
                session.step = 3;
                await this.sendToStaff(message.channel, session);

                await message.channel.send({ embeds: [
                    new EmbedBuilder()
                        .setColor(0x57F287)
                        .setTitle('✅ Denúncia Registrada')
                        .setDescription('Sua denúncia foi enviada para a equipe.\nUm staff irá analisar e tomar as providências necessárias.')
                        .addFields(
                            { name: '👤 Denunciado', value: session.accused, inline: true },
                            { name: '📋 Motivo', value: session.reason, inline: true }
                        )
                        .setFooter({ text: 'Agradecemos pela colaboração!' })
                ]});

                session.state = 'done';
                break;
        }
    }

    static async sendToStaff(channel, session) {
        const conn = await db.getConnection(session.guildId);
        if (!conn?.staffGuildId || !conn?.staffChannelId) {
            console.log('❌ Sem conexão com staff');
            return;
        }

        try {
            const staffGuild = channel.client.guilds.cache.get(conn.staffGuildId);
            if (!staffGuild) return;
            const staffChannel = staffGuild.channels.cache.get(conn.staffChannelId);
            if (!staffChannel) return;

            const ticket = await db.getTicket(channel.id);
            const user = await channel.guild.members.fetch(session.userId).catch(() => null);
            const ticketNumber = ticket?.number || '?';

            const embed = new EmbedBuilder()
                .setColor(0xe74c3c)
                .setTitle('🚨 Nova Denúncia')
                .addFields(
                    { name: '👤 Denunciante', value: user?.user.tag || session.userId, inline: true },
                    { name: '🎫 Ticket', value: `#${String(ticketNumber).padStart(4, '0')}`, inline: true },
                    { name: '🏠 Servidor', value: channel.guild.name, inline: true },
                    { name: '🚫 Denunciado', value: session.accused || 'Não informado', inline: false },
                    { name: '📋 Motivo', value: session.reason || 'Não informado', inline: false },
                    { name: '📎 Provas', value: session.proofs || 'Não informado', inline: false }
                )
                .setTimestamp();

            await staffChannel.send({ embeds: [embed] });
            console.log('✅ Denúncia enviada ao staff');
        } catch (e) {
            console.error('Erro enviar denúncia:', e.message);
        }
    }

    static delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = TicketDenuncias;