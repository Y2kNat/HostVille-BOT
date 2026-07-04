const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const db = require('../database/db');
const fs = require('fs');
const path = require('path');
const TicketDenuncias = require('./TicketDenuncias');
const TicketSuporte = require('./TicketSuporte');
const TicketDuvidas = require('./TicketDuvidas');

const activeSessions = new Map();

class TicketManager {

    static async createTicket(interaction, category) {
        const guild = interaction.guild;
        const user = interaction.user;
        const connection = await db.getConnection(guild.id);
        if (!connection) {
            if (interaction.deferred) return interaction.editReply({ content: '❌ Sistema não configurado.' });
            return interaction.reply({ content: '❌ Sistema não configurado.', flags: 64 });
        }

        const ticketNumber = await db.incrementTicketCounter();
        const categoryNames = { denuncias: 'denuncia', suporte: 'suporte', duvidas: 'duvida' };
        const shortName = categoryNames[category] || category;
        const channelName = `🎫・${shortName}-${ticketNumber.toString().padStart(4, '0')}`;

        try {
            const ticketChannel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: '1466936076366118912',
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                ]
            });

            await db.addTicket(ticketChannel.id, {
                guildId: guild.id, channelId: ticketChannel.id, userId: user.id,
                category, number: ticketNumber, createdAt: Date.now(), status: 'open', claimedBy: null
            });

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('ticket_close').setLabel('Fechar Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
                new ButtonBuilder().setCustomId('ticket_claim').setLabel('Assumir').setStyle(ButtonStyle.Primary).setEmoji('🙋')
            );

            const roleMention = connection?.staffRoleId ? `<@&${connection.staffRoleId}>` : '';
            await ticketChannel.send({ content: `${user} ${roleMention}`, components: [buttons] });
            await this.startAutoAttendant(ticketChannel, user, guild.id);
            
            const msg = { content: `✅ Ticket criado: ${ticketChannel}` };
            if (interaction.deferred) return interaction.editReply(msg);
            return interaction.reply({ ...msg, flags: 64 });
        } catch (error) {
            console.error('❌ ERRO TICKET:', error.message);
            const msg = { content: '❌ Erro ao criar ticket.' };
            if (interaction.deferred) return interaction.editReply(msg);
            return interaction.reply({ ...msg, flags: 64 });
        }
    }

    static async startAutoAttendant(channel, user, guildId) {
        const ticket = await db.getTicket(channel.id);
        const category = ticket?.category || 'suporte';

        if (category === 'denuncias') {
            await TicketDenuncias.start(channel, user, guildId);
            activeSessions.set(channel.id, { state: 'active', step: 0, userId: user.id, guildId, category: 'denuncias' });
        } else if (category === 'suporte') {
            await TicketSuporte.start(channel, user, guildId);
            activeSessions.set(channel.id, { state: 'active', step: 0, userId: user.id, guildId, category: 'suporte' });
        } else if (category === 'duvidas') {
            await TicketDuvidas.start(channel, user, guildId);
            activeSessions.set(channel.id, { state: 'active', step: 0, userId: user.id, guildId, category: 'duvidas' });
        }
    }

    static async processAutoAttendant(message) {
        const session = activeSessions.get(message.channel.id);
        if (!session || message.author.id !== session.userId || session.claimedBy || session.state === 'done') return false;

        if (session.category === 'denuncias') {
            await TicketDenuncias.process(message, session);
        } else if (session.category === 'suporte') {
            await TicketSuporte.process(message, session);
        } else if (session.category === 'duvidas') {
            await TicketDuvidas.process(message, session);
        }
        return true;
    }

    static async saveTranscript(channel) {
        try {
            const ticket = await db.getTicket(channel.id);
            if (!ticket) return null;
            let transcript = `=== Ticket #${String(ticket.number).padStart(4, '0')} ===\n`;
            transcript += `Categoria: ${ticket.category}\nUsuário: ${ticket.userId}\n`;
            transcript += `Aberto: ${new Date(ticket.createdAt).toLocaleString('pt-BR')}\n${'='.repeat(40)}\n\n`;
            try {
                const messages = await channel.messages.fetch({ limit: 100 });
                Array.from(messages.values()).reverse().forEach(msg => {
                    transcript += `[${msg.createdAt.toLocaleString('pt-BR')}] ${msg.author.tag}: ${msg.content || '[Mídia]'}\n`;
                });
            } catch (e) {}
            const dir = path.join(__dirname, '..', 'transcripts');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const filename = `ticket-${ticket.number}-${Date.now()}.txt`;
            const filepath = path.join(dir, filename);
            fs.writeFileSync(filepath, transcript);
            return { path: filepath, content: transcript, filename };
        } catch (e) {
            return null;
        }
    }

    static async closeTicket(channel, closer) {
        try {
            const ticket = await db.getTicket(channel.id);
            if (!ticket) return;
            
            activeSessions.delete(channel.id);
            
            const transcript = await this.saveTranscript(channel);
            await db.closeTicket(channel.id);
            
            const conn = await db.getConnection(channel.guild.id);
            if (conn?.logChannelId && transcript) {
                try {
                    const logChannel = channel.guild.channels.cache.get(conn.logChannelId);
                    if (logChannel) {
                        await logChannel.send({ 
                            embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('🔒 Ticket Fechado')
                                .addFields({ name: '🎫', value: `#${String(ticket.number).padStart(4, '0')}`, inline: true }, { name: '👤', value: `<@${ticket.userId}>`, inline: true }, { name: '📋', value: ticket.category, inline: true }, { name: '🔒', value: closer.tag, inline: true }).setTimestamp()],
                            files: [{ attachment: transcript.path, name: transcript.filename }]
                        });
                    }
                } catch (e) {}
            }
            
            try {
                await channel.send('🔒 Ticket fechado. Canal será deletado em 5 segundos...');
                setTimeout(() => channel.delete().catch(() => {}), 5000);
            } catch (e) {}
        } catch (e) {
            console.error('Erro ao fechar:', e.message);
        }
    }

    static async claimTicket(channel, staff) {
        const ticket = await db.getTicket(channel.id);
        if (!ticket || ticket.claimedBy) { await channel.send('❌ Já assumido.'); return false; }
        await db.claimTicket(channel.id, staff.id);
        activeSessions.delete(channel.id);
        await channel.send({ embeds: [new EmbedBuilder().setColor(0x5865F2).setDescription(`🙋 ${staff} assumiu o atendimento.`)] });
        return true;
    }

    static delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = TicketManager;