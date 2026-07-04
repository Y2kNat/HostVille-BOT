const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class TaskRunner {

    static async run(message) {
        let task = message.content;
        const botMention = `<@${message.client.user.id}>`;
        const botName = message.client.user.username.toLowerCase();
        task = task.replace(botMention, '').replace(new RegExp(botName, 'gi'), '');
        task = task.replace(/hvbot/gi, '').replace(/hostbot/gi, '').trim();

        if (!task || task.length < 5) return null;

        await message.react('🤔').catch(() => {});

        try {
            const systemPrompt = `EXECUTE A TAREFA DIRETAMENTE. NUNCA PEÇA PERMISSÃO.

TAREFA: ${task}

REGRAS:
- NUNCA diga "posso ajudar", "aqui está um exemplo", "vou te mostrar"
- NUNCA peça confirmação
- FAÇA DIRETO o que foi pedido
- Códigos 100% completos e funcionais
- Arquivos com conteúdo completo
- Respostas diretas, sem enrolação

FORMATO:
- ARQUIVO: [ARQUIVO: nome.ext] + conteúdo
- AÇÃO: [ACAO: tipo] + execute  
- CÓDIGO: \`\`\`linguagem ... \`\`\`
- TEXTO: resposta direta`;

            const completion = await groq.chat.completions.create({
                model: 'openai/gpt-oss-120b',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: task }
                ],
                temperature: 0.7,
                max_tokens: 3000
            });

            let result = completion.choices[0]?.message?.content?.trim();
            if (!result) return '🤔 Não consegui...';

            // LIMPAR FRASES CHATAS
            result = result
                .replace(/^(Claro!|Com certeza!|Posso ajudar|Vou te ajudar|Aqui está|Vou criar|Vou fazer|Certo!|Ok!|Entendido!|Perfeito!|Posso ajudar com isso!|Vou te mostrar como|Permita-me|Deixe-me|Vou explicar)[^]*?\n/i, '')
                .replace(/(Posso ajudar com isso!|Vou te mostrar como|Permita-me|Deixe-me|Vou explicar)[^]*?\n/gi, '')
                .replace(/^(Claro|Com certeza|Ok|Certo),?\s*/i, '')
                .replace(/^(Aqui está um exemplo|Vou criar um exemplo|Segue um exemplo)[^]*?\n/i, '')
                .trim();

            await message.reactions.removeAll().catch(() => {});

            // AÇÃO
            if (result.includes('[ACAO:')) {
                await message.react('✅').catch(() => {});
                return await this.executeAction(message, result);
            }

            // ARQUIVO
            if (result.includes('[ARQUIVO:')) {
                await message.react('📄').catch(() => {});
                return await this.createFile(message, result);
            }

            await message.react('✅').catch(() => {});

            // Muito grande
            if (result.length > 1900) {
                return await this.sendAsFile(message, result, `resposta-${Date.now()}.txt`);
            }

            return result;

        } catch (error) {
            console.error('TaskRunner:', error.message);
            await message.reactions.removeAll().catch(() => {});
            return '❌ Erro ao executar. Tenta de novo!';
        }
    }

    static async createFile(message, result) {
        const fileMatch = result.match(/\[ARQUIVO:\s*(.+?)\]/i);
        const fileName = fileMatch ? fileMatch[1].trim() : `arquivo-${Date.now()}.txt`;
        const fileContent = result.replace(/\[ARQUIVO:\s*.+?\]/i, '').trim();

        const dir = path.join(__dirname, '..', 'temp');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        const filePath = path.join(dir, fileName);
        fs.writeFileSync(filePath, fileContent, 'utf8');

        const ext = path.extname(fileName).toLowerCase();
        const emojiMap = { '.js': '💛', '.py': '🐍', '.html': '🌐', '.css': '🎨', '.json': '📋', '.csv': '📊', '.md': '📝', '.bat': '⚙️', '.sh': '🐧', '.java': '☕', '.cpp': '🔧', '.c': '⚡', '.php': '🐘', '.sql': '🗄️', '.txt': '📄' };
        const emoji = emojiMap[ext] || '📄';

        const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle(`${emoji} Arquivo Criado!`)
            .setDescription(`**${fileName}**`)
            .addFields(
                { name: '📏 Tamanho', value: `${(fileContent.length / 1024).toFixed(1)} KB`, inline: true },
                { name: '📝 Linhas', value: `${fileContent.split('\n').length}`, inline: true },
                { name: '🏷️ Tipo', value: ext.replace('.', '').toUpperCase(), inline: true }
            )
            .setFooter({ text: `Criado por ${message.author.username}` })
            .setTimestamp();

        await message.reply({ embeds: [embed], files: [{ attachment: filePath, name: fileName }] });

        setTimeout(() => { try { fs.unlinkSync(filePath); } catch (e) {} }, 120000);
        return null;
    }

    static async sendAsFile(message, content, fileName) {
        const dir = path.join(__dirname, '..', 'temp');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        const filePath = path.join(dir, fileName);
        fs.writeFileSync(filePath, content, 'utf8');

        await message.reply({ content: '📄 Conteúdo grande, mandei como arquivo!', files: [{ attachment: filePath, name: fileName }] });

        setTimeout(() => { try { fs.unlinkSync(filePath); } catch (e) {} }, 120000);
        return null;
    }

    static async executeAction(message, result) {
        const actionMatch = result.match(/\[ACAO:\s*(.+?)\]/i);
        const actionType = actionMatch ? actionMatch[1].trim().toLowerCase() : '';
        const mentionMatch = message.content.match(/<@!?(\d+)>/);
        const targetId = mentionMatch ? mentionMatch[1] : null;
        const targetUser = targetId ? await message.guild.members.fetch(targetId).catch(() => null) : null;

        if (!targetUser && ['mutar', 'mute', 'silenciar', 'expulsar', 'kick', 'banir', 'ban'].includes(actionType)) {
            await message.reply({ content: '❌ Mencione o usuário!' });
            return null;
        }

        switch (actionType) {
            case 'mutar': case 'mute': case 'silenciar':
                try {
                    const duration = this.extractDuration(message.content);
                    await targetUser.timeout(duration, `Silenciado por ${message.author.username}`);
                    
                    const muteEmbed = new EmbedBuilder()
                        .setColor(0xFFA500)
                        .setTitle('🔇 Silenciado')
                        .setDescription(`${targetUser.user.username} foi silenciado!`)
                        .addFields(
                            { name: '⏱️ Duração', value: this.formatDuration(duration), inline: true },
                            { name: '👮 Por', value: message.author.username, inline: true }
                        ).setTimestamp();

                    await message.reply({ embeds: [muteEmbed] });
                } catch (e) {
                    await message.reply({ content: '❌ Sem permissão para silenciar.' });
                }
                break;

            case 'expulsar': case 'kick':
                try {
                    await targetUser.kick('Expulso pelo HostBot');
                    await message.reply({ content: `👢 ${targetUser.user.username} foi expulso!` });
                } catch (e) {
                    await message.reply({ content: '❌ Sem permissão para expulsar.' });
                }
                break;

            case 'banir': case 'ban':
                try {
                    await targetUser.ban({ reason: 'Banido pelo HostBot' });
                    await message.reply({ content: `🔨 ${targetUser.user.username} foi banido!` });
                } catch (e) {
                    await message.reply({ content: '❌ Sem permissão para banir.' });
                }
                break;

            case 'anunciar': case 'anuncio':
                const announceText = result.replace(/\[ACAO:\s*.+?\]/i, '').trim();
                if (announceText) {
                    await message.channel.send({ 
                        embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📢 Anúncio').setDescription(announceText).setFooter({ text: `Por ${message.author.username}` }).setTimestamp()]
                    });
                }
                break;

            default:
                await message.reply({ content: result.replace(/\[ACAO:\s*.+?\]/i, '').trim() || `✅ Ação executada!` });
        }

        return null;
    }

    static extractDuration(text) {
        const patterns = [
            { regex: /(\d+)\s*(minutos?|mins?|m)\b/i, ms: 60000 },
            { regex: /(\d+)\s*(horas?|hrs?|h)\b/i, ms: 3600000 },
            { regex: /(\d+)\s*(segundos?|segs?|s)\b/i, ms: 1000 },
            { regex: /(\d+)\s*(dias?|d)\b/i, ms: 86400000 }
        ];
        for (const p of patterns) {
            const match = text.match(p.regex);
            if (match) return parseInt(match[1]) * p.ms;
        }
        return 600000;
    }

    static formatDuration(ms) {
        const minutes = Math.floor(ms / 60000);
        const hours = Math.floor(minutes / 60);
        if (hours > 0) return `${hours}h ${minutes % 60}min`;
        return `${minutes} minutos`;
    }
}

module.exports = TaskRunner;