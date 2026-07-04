const { EmbedBuilder } = require('discord.js');
const welcomeData = require('../data/welcomeData');
const { askAI } = require('../utils/ai');

// Sessões ativas de boas-vindas (userId -> estado)
const welcomeSessions = new Map();

class WelcomeManager {

    /**
     * Iniciar boas-vindas quando membro entra
     */
    static async sendWelcome(member) {
        try {
            // Enviar DM
            const dmChannel = await member.createDM();
            
            // Mensagem de boas-vindas
            const welcomeMsg = welcomeData.welcomeMessage.replace('{user}', member.user.username);
            
            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle(`🌆 Bem-vindo à ${member.guild.name}!`)
                .setDescription(welcomeMsg)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setTimestamp();

            await dmChannel.send({ embeds: [embed] });
            await this.delay(2000);

            // Pergunta sobre cargos públicos
            await dmChannel.send(welcomeData.firstQuestion);

            // Iniciar sessão de boas-vindas
            welcomeSessions.set(member.id, {
                state: 'await_job_choice',
                guildId: member.guild.id,
                startTime: Date.now()
            });

            console.log(`✅ Boas-vindas enviadas para ${member.user.tag}`);

        } catch (error) {
            console.log(`❌ Não foi possível enviar DM para ${member.user.tag}: ${error.message}`);
        }
    }

    /**
     * Processar resposta do membro na DM
     */
    static async processResponse(message) {
        // Só processa DMs
        if (message.guild) return false;

        const userId = message.author.id;
        const session = welcomeSessions.get(userId);
        
        // Se não está em sessão de boas-vindas, ignora
        if (!session) return false;

        const msg = message.content.toLowerCase().trim();

        switch (session.state) {
            case 'await_job_choice':
                await this.handleJobChoice(message, session, msg);
                break;

            case 'await_job_info':
                await this.handleJobInfo(message, session, msg);
                break;
        }

        return true;
    }

    /**
     * Lidar com escolha de cargos públicos (sim/não)
     */
    static async handleJobChoice(message, session, msg) {
        const positives = ['sim', 's', 'yes', 'y', 'claro', 'ok', 'quero'];
        const negatives = ['não', 'nao', 'n', 'no', 'nope', 'não quero', 'nao quero'];

        if (positives.includes(msg)) {
            // SIM - Manda formulário
            await message.channel.send(welcomeData.responseYes);
            welcomeSessions.delete(message.author.id);
            console.log(`✅ ${message.author.tag} escolheu cargos públicos`);

        } else if (negatives.includes(msg)) {
            // NÃO - Lista empregos
            await message.channel.send(welcomeData.responseNo);
            session.state = 'await_job_info';
            console.log(`🔄 ${message.author.tag} quer ver outros empregos`);

        } else {
            // Resposta inválida
            await message.channel.send('⚠️ Por favor, responda apenas **sim** ou **não**.\nGostaria de seguir com os cargos públicos?');
        }
    }

    /**
     * Lidar com informação de empregos (IA + dados)
     */
    static async handleJobInfo(message, session, msg) {
        // Se pediu formulário
        if (msg.includes('formulario') || msg.includes('formulário') || msg.includes('form')) {
            await message.channel.send('📝 **Link de inscrição:** https://hostville.com/inscricao\nEscolha o emprego desejado e preencha o formulário!');
            welcomeSessions.delete(message.author.id);
            return;
        }

        // Se quer sair
        if (msg === 'sair' || msg === 'encerrar' || msg === 'fechar') {
            await message.channel.send('👋 **Até mais!** Qualquer dúvida, entre no servidor e abra um ticket. Boa sorte! 🍀');
            welcomeSessions.delete(message.author.id);
            return;
        }

        // Buscar informações do emprego nos dados locais
        const jobInfo = welcomeData.jobsInfo;
        let foundJob = null;

        for (const [jobName, info] of Object.entries(jobInfo)) {
            if (msg.includes(jobName)) {
                foundJob = { name: jobName, ...info };
                break;
            }
        }

        if (foundJob) {
            // Responde com informações do emprego
            const embed = new EmbedBuilder()
                .setColor(0xFEE75C)
                .setTitle(`💼 ${foundJob.name.toUpperCase()}`)
                .setDescription(foundJob.description)
                .addFields(
                    { name: '📋 Requisitos', value: foundJob.requisitos, inline: true },
                    { name: '💰 Salário', value: foundJob.salario, inline: true },
                    { name: '📝 Formulário', value: foundJob.formulario, inline: false }
                )
                .setFooter({ text: 'Digite "formulário" para o link direto ou "sair" para encerrar' })
                .setTimestamp();

            await message.channel.send({ embeds: [embed] });
            await message.channel.send('❓ **Deseja saber sobre outro emprego?** Digite o nome ou **"sair"** para encerrar.');

        } else {
            // Tentar responder com IA
            try {
                await message.channel.sendTyping();
                
                // Montar contexto com todos os empregos
                let jobsContext = 'EMPREGOS DISPONÍVEIS:\n';
                for (const [name, info] of Object.entries(jobInfo)) {
                    jobsContext += `- ${name}: ${info.description}\n`;
                }

                const aiResponse = await askAI(
                    msg,
                    'empregos',
                    [{ question: msg }],
                    session.guildId
                );

                if (aiResponse) {
                    await message.channel.send(`🤖 ${aiResponse}`);
                    await message.channel.send('❓ **Mais alguma dúvida sobre empregos?** Digite o nome do emprego ou **"sair"**.');
                } else {
                    await message.channel.send('🤔 Não encontrei informações sobre isso. Tente digitar o nome de um emprego da lista ou **"sair"** para encerrar.');
                }
            } catch (error) {
                await message.channel.send('🤔 Digite o nome de um emprego da lista ou **"sair"** para encerrar.');
            }
        }
    }

    static delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = WelcomeManager;
