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

        // Depois de concluído, não aceita mais nada (fica no ticket)
        if (session.state === 'done') {
            await message.channel.send('Sua denúncia já foi registrada e enviada à equipe. Se precisar de algo, abra um novo ticket. 😉');
            return;
        }

        switch (session.step) {
            case 0:
                if (!this.valid(msg, 2)) {
                    await message.channel.send('❌ Informe um nome ou ID válido do jogador que deseja denunciar.');
                    return;
                }
                session.accused = this.short(msg, 256);
                session.step = 1;
                await message.channel.send('📝 **Registrado.**\n\n**2️⃣ Qual o motivo da denúncia?** (Descreva o que aconteceu)');
                break;

            case 1:
                if (!this.valid(msg, 10)) {
                    await message.channel.send('❌ Descreva o motivo com mais detalhes (pelo menos 10 caracteres).');
                    return;
                }
                session.reason = this.short(msg, 1024);
                session.step = 2;
                await message.channel.send('📝 **Registrado.**\n\n**3️⃣ Você tem provas?** (prints, vídeos, testemunhas)\nEnvie os links/descrições ou anexe as imagens aqui.');
                break;

            case 2:
                session.proofs = this.buildProofs(message, msg);
                session.step = 3;

                const ok = await this.sendToStaff(message.channel, session);
                if (!ok) {
                    // Não conseguiu entregar: mantém a sessão aberta pra tentar de novo
                    session.step = 2;
                    session.proofs = undefined;
                    await message.channel.send('❌ Não consegui enviar sua denúncia ao staff agora. Envie de novo daqui a pouco.');
                    return;
                }

                await message.channel.send({ embeds: [
                    new EmbedBuilder()
                        .setColor(0x57F287)
                        .setTitle('✅ Denúncia Registrada')
                        .setDescription('Sua denúncia foi enviada para a equipe.\nUm staff irá analisar e tomar as providências necessárias.')
                        .addFields(
                            { name: '👤 Denunciado', value: session.accused || 'Não informado', inline: true },
                            { name: '📋 Motivo', value: session.reason || 'Não informado', inline: true },
                            { name: '📎 Provas', value: session.proofs || 'Não informado', inline: false }
                        )
                        .setFooter({ text: 'Agradecemos pela colaboração!' })
                ]});

                session.state = 'done';
                break;
        }
    }

    static valid(value, min) {
        return typeof value === 'string' && value.trim().length >= min;
    }

    static short(value, max) {
        const t = value.trim();
        return t.length > max ? t.slice(0, max - 3) + '...' : t;
    }

    static buildProofs(message, text) {
        const attachments = [...(message.attachments?.values?.() || [])].map(a => a.url);
        const parts = [text?.trim() || null, ...attachments].filter(Boolean);
        return this.short(parts.join('\n') || 'Sem provas descritas', 1024);
    }

    static async sendToStaff(channel, session) {
        const conn = await db.getConnection(session.guildId);
        if (!conn?.staffGuildId || !conn?.staffChannelId) {
            console.log('❌ Sem conexão com staff');
            return false;
        }

        try {
            const staffGuild = channel.client.guilds.cache.get(conn.staffGuildId);
            if (!staffGuild) return false;
            const staffChannel = staffGuild.channels.cache.get(conn.staffChannelId);
            if (!staffChannel) return false;

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
                    { name: '🕐 Quando', value: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), inline: true },
                    { name: '🚫 Denunciado', value: session.accused || 'Não informado', inline: false },
                    { name: '📋 Motivo', value: session.reason || 'Não informado', inline: false },
                    { name: '📎 Provas', value: session.proofs || 'Não informado', inline: false }
                )
                .setTimestamp();

            const ping = conn.staffRoleId ? `<@&${conn.staffRoleId}>` : '';
            await staffChannel.send({ content: ping || undefined, embeds: [embed] });
            console.log('✅ Denúncia enviada ao staff');
            return true;
        } catch (e) {
            console.error('Erro enviar denúncia:', e.message);
            return false;
        }
    }

    static delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = TicketDenuncias;