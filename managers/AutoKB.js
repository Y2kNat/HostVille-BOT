/**
 * Auto-KB: o bot propõe documentos novos para a KB e a staff aprova.
 *
 * Fluxo: minerar conversas → agrupar perguntas repetidas que a KB não cobre
 * → mandar embed no canal de revisão com ✅ Aprovar / ✏️ Editar / ❌ Ignorar
 * → só depois do ✅ o arquivo é escrito em ai/knowledge/auto-kb/ e a entrada
 * entra no index.json.
 *
 * Quem aprova: o dono (OWNER_ID) e, se APPROVE_ROLE estiver preenchido no
 * .env, os cargos listados. Com APPROVE_ROLE vazio, só o dono.
 */
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder,
    TextInputBuilder, TextInputStyle,
} = require('discord.js');

const config = require('../config');
const { minerar } = require('./AutoKBMiner');
const { addDoc, findByTitle } = require('../ai/autoKbWriter');
const { logInfo, logWarn, logError, logSuccess } = require('../utils/logger');
const { sendLog } = require('../utils/realtime');

class AutoKB {
    static timer = null;
    static proximoId = 1;

    /**
     * Propostas aguardando decisão. Chave -> { id, proposta, status, messageId }.
     *
     * Persistido em data/autoKbPending.json porque o botão precisa funcionar
     * depois de um restart: se ficasse só em memória, qualquer reinício
     * transformava os botões pendentes em erro "proposta não encontrada".
     */
    static pendentes = new Map();

    /** Propostas já decididas neste ciclo (não reperguntar). */
    static decididas = new Set();

    static PENDENTES_FILE = process.env.AUTO_KB_PENDING_FILE
        || require('path').join(__dirname, '..', 'data', 'autoKbPending.json');

    /** Descarta propostas pendentes de mais de N dias (ninguém vai clicar). */
    static DIAS_PENDENTE = 7;

    static carregarPendentes() {
        try {
            const fs = require('fs');
            const bruto = JSON.parse(fs.readFileSync(this.PENDENTES_FILE, 'utf8'));
            this.pendentes = new Map();
            let maiorId = 0;
            for (const [chave, reg] of Object.entries(bruto || {})) {
                this.pendentes.set(chave, reg);
                const n = parseInt(reg.id, 10);
                if (Number.isFinite(n) && n > maiorId) maiorId = n;
            }
            this.proximoId = maiorId + 1;
        } catch (e) {
            this.pendentes = new Map();
        }
        return this.pendentes.size;
    }

    static salvarPendentes() {
        try {
            const fs = require('fs');
            const path = require('path');
            const limite = Date.now() - this.DIAS_PENDENTE * 24 * 60 * 60 * 1000;
            const obj = {};
            for (const [chave, reg] of this.pendentes) {
                // pendente há muito tempo e sem ninguém tocando: esquece
                if (reg.status === 'pendente' && reg.criadoEm && reg.criadoEm < limite) continue;
                obj[chave] = reg;
            }
            const tmp = this.PENDENTES_FILE + '.tmp-' + process.pid;
            fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
            fs.renameSync(tmp, this.PENDENTES_FILE);
        } catch (e) {
            console.error('❌ Auto-KB: não consegui salvar pendentes:', e.message);
        }
    }

    static canal() {
        const guild = global.client && global.client.guilds.cache.get(config.AUTO_KB.GUILD);
        if (!guild) return null;
        return guild.channels.cache.get(config.AUTO_KB.CANAL) || null;
    }

    static podeAprovar(interaction) {
        if (!interaction || !interaction.user) return false;
        if (config.OWNER_ID && interaction.user.id === config.OWNER_ID) return true;
        if (!Array.isArray(config.APPROVE_ROLE) || !config.APPROVE_ROLE.length) return false;
        const cargos = interaction.member && interaction.member.roles ? interaction.member.roles.cache : null;
        if (!cargos) return false;
        return config.APPROVE_ROLE.some(id => cargos.has(id));
    }

    /** Inicia o timer. Chamar uma vez, no ready. */
    static start(client) {
        if (!config.AUTO_KB.ENABLED) {
            logInfo('Auto-KB desligado (AUTO_KB_ENABLED=false)');
            return null;
        }
        if (!config.AUTO_KB.GUILD || !config.AUTO_KB.CANAL) {
            logWarn('Auto-KB sem canal/guild configurado — não iniciado');
            return null;
        }
        if (this.timer) return this.timer;

        // botões de propostas antigas continuam valendo depois do restart
        const recuperadas = this.carregarPendentes();
        if (recuperadas) logInfo(`Auto-KB: ${recuperadas} proposta(s) pendente(s) recuperadas`);

        const minutos = Math.max(5, config.AUTO_KB.INTERVAL_MIN);
        // primeiro passo só depois do intervalo: subir o bot não deve postar
        // embed de proposta imediatamente
        this.timer = setInterval(() => {
            this.run().catch((e) => logError('Auto-KB: erro no ciclo: ' + e.message));
        }, minutos * 60 * 1000);

        if (this.timer.unref) this.timer.unref();
        logInfo(`Auto-KB ligado: verify a cada ${minutos}min, canal ${config.AUTO_KB.CANAL}`);
        return this.timer;
    }

    static stop() {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }

    /**
     * Um ciclo: minera e posta as propostas novas.
     * @returns {{propostas:number, postadas:number, descartes:object}}
     */
    static async run({ post = true } = {}) {
        const { propostas, descartes, totalPares } = minerar();

        // decisões de sessões anteriores também valem
        for (const [chave, reg] of this.pendentes) {
            if (reg.status !== 'pendente') this.decididas.add(chave);
        }

        const novas = propostas.filter(p => {
            if (this.decididas.has(p.chave)) return false;
            if (this.pendentes.has(p.chave)) return false;
            // já existe documento aprovado com esse tema?
            if (findByTitle(p.exemplos[0].pergunta)) {
                this.decididas.add(p.chave);
                return false;
            }
            return true;
        });

        logInfo(
            `Auto-KB: ${totalPares} pares analisados, ${propostas.length} lacunas agrupadas, ` +
            `${novas.length} novas para revisar`
        );

        let postadas = 0;
        for (const p of novas.slice(0, 5)) { // no máximo 5 por ciclo, para não inundar
            const id = String(this.proximoId++);
            this.pendentes.set(p.chave, { id, proposta: p, status: 'pendente', messageId: null, criadoEm: Date.now() });
            if (post) {
                const ok = await this.postarProposta(p, id);
                if (ok) postadas++;
            }
        }

        return { propostas: propostas.length, postadas, descartes };
    }

    static buildEmbed(p, id) {
        const exemplos = p.exemplos
            .map((e, i) => `**${i + 1}.** ${String(e.pergunta).slice(0, 120)}`)
            .join('\n');

        return new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📚 Sugestão de documento para a KB')
            .setDescription(
                `O bot respondeu **${p.freq}×** uma pergunta parecida que a base **não cobre**.\n` +
                `Aprovar cria um documento em \`ai/knowledge/auto-kb/\` com esses fatos.`
            )
            .addFields(
                { name: 'Perguntas que apareceram', value: exemplos.slice(0, 1024) || '—', inline: false },
                {
                    name: 'Como o bot respondeu',
                    value: p.exemplos.map((e, i) => `**${i + 1}.** ${String(e.resposta).slice(0, 220)}`).join('\n').slice(0, 1024) || '—',
                    inline: false,
                },
                { name: 'Ocorrências', value: String(p.freq), inline: true },
                { name: 'Aprovação', value: `<@${config.OWNER_ID || 'dono'}>`, inline: true },
            )
            .setFooter({ text: `proposta #${id} · learned · não entra na KB sem o ✅` })
            .setTimestamp();
    }

    /** Linha de botões de uma proposta (usada ao postar e ao reexibir após erro). */
    static linhaBotoes(id) {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`autokb_approve:${id}`).setLabel('Aprovar').setStyle(ButtonStyle.Success).setEmoji('✅'),
            new ButtonBuilder().setCustomId(`autokb_edit:${id}`).setLabel('Editar').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
            new ButtonBuilder().setCustomId(`autokb_ignore:${id}`).setLabel('Ignorar').setStyle(ButtonStyle.Secondary).setEmoji('🗑️'),
        );
    }

    /** Reconstroi o embed original de uma proposta (para devolvê-la após erro). */
    static embedOriginal(customId) {
        const achado = this.achar(customId);
        if (!achado) {
            return new EmbedBuilder()
                .setColor(0x95a5a6)
                .setTitle('⚠️ Proposta não encontrada')
                .setDescription('O bot reiniciou e esta proposta não está mais disponível.');
        }
        return this.buildEmbed(achado.reg.proposta, achado.reg.id);
    }

    static async postarProposta(p, id) {
        const canal = this.canal();
        if (!canal) {
            logWarn('Auto-KB: canal de revisão não encontrado — proposta guardada sem postar');
            return false;
        }
        try {
            const msg = await canal.send({ embeds: [this.buildEmbed(p, id)], components: [this.linhaBotoes(id)] });
            const reg = this.pendentes.get(p.chave);
            if (reg) reg.messageId = msg.id;
            this.salvarPendentes();
            return true;
        } catch (e) {
            logError('Auto-KB: não consegui postar a proposta: ' + e.message);
            return false;
        }
    }

    static achar(customId) {
        const id = String(customId).split(':')[1];
        for (const [chave, reg] of this.pendentes) {
            if (reg.id === id) return { chave, reg };
        }
        return null;
    }

    /** Aprova: escreve o documento de verdade. */
    static async aprovar(customId, interaction, fatosEditados, tituloEditado) {
        const achado = this.achar(customId);
        if (!achado) return { ok: false, msg: 'Proposta não encontrada (o bot pode ter reiniciado).' };
        const { chave, reg } = achado;

        if (reg.status !== 'pendente') return { ok: false, msg: 'Essa proposta já foi respondida.' };

        // titulo editado no modal tem prioridade sobre o sugerido
        const titulo = (tituloEditado || reg.proposta.exemplos[0].pergunta)
            .replace(/[?!.]+$/, '').trim().slice(0, 90);
        const fatos = (fatosEditados || '').trim() || reg.proposta.exemplos.map((e, i) => `- ${e.resposta}`).join('\n');

        try {
            const r = addDoc({
                titulo,
                fatos,
                origem: `Aprendizado automático · ${reg.proposta.freq} ocorrências`,
                aprovadoPor: interaction.user.id,
            });
            reg.status = 'aprovado';
            reg.decididaEm = Date.now();
            reg.decididaPor = interaction.user.id;
            this.decididas.add(chave);
            this.salvarPendentes();

            logSuccess(`Auto-KB: "${titulo}" aprovado por ${interaction.user.tag} -> ${r.path}`);
            sendLog('📚 Documento de KB criado: ' + titulo + ' | por ' + interaction.user.tag, 'success', 'knowledge');
            return { ok: true, status: 'aprovado', docId: r.id, path: r.path, msg: `Documento criado: \`${r.path}\`` };
        } catch (e) {
            logError('Auto-KB: falha ao gravar o documento: ' + e.message);
            return { ok: false, msg: '❌ Erro ao gravar: ' + e.message };
        }
    }

    static async ignorar(customId, interaction) {
        const achado = this.achar(customId);
        if (!achado) return { ok: false, msg: 'Proposta não encontrada.' };
        achado.reg.status = 'ignorado';
        achado.reg.decididaEm = Date.now();
        achado.reg.decididaPor = interaction.user.id;
        this.decididas.add(achado.chave);
        this.salvarPendentes();
        return { ok: true, status: 'ignorado', msg: 'Ignorado. Não vai ser proposto de novo.' };
    }

    /**
     * Embed final da proposta decidida.
     *
     * NÃO responde a interaction: quem responde é o interactionCreate, com um
     * único editReply. Aqui só montamos o conteúdo. (A versão anterior chamava
     * interaction.update() depois de um deferUpdate, o que estourava "reply
     * already sent" — e o .catch escondia o erro, então o embed ficava
     * congelado no botão sem o bot avisar nada.)
     */
    static embedDecidido(status, interaction, docId, path) {
        const cor = status === 'aprovado' ? 0x2ecc71 : 0x95a5a6;
        const emoji = status === 'aprovado' ? '✅' : '🗑️';
        const titulo = status === 'aprovado' ? 'Proposta aprovada' : 'Proposta ignorada';
        const extra = status === 'aprovado' && path ? `\n\nDocumento: \`${path}\`` : '';
        return new EmbedBuilder()
            .setColor(cor)
            .setTitle(`${emoji} ${titulo}`)
            .setDescription(`Decidida por <@${interaction.user.id}>.${extra}`)
            .setTimestamp();
    }

    static abrirEdicao(customId, interaction) {
        const achado = this.achar(customId);
        if (!achado) return { ok: false, msg: 'Proposta não encontrada.' };
        const { reg } = achado;
        const modal = new ModalBuilder()
            .setCustomId(`autokb_edit_modal:${reg.id}`)
            .setTitle('Editar fatos do documento');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('titulo')
                .setLabel('Título do documento')
                .setStyle(TextInputStyle.Short)
                .setDefaultValue(reg.proposta.exemplos[0].pergunta.replace(/[?!.]+$/, '').trim().slice(0, 90))
                .setRequired(true)
                .setMaxLength(90)
        ));
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('fatos')
                .setLabel('Fatos (um por linha)')
                .setStyle(TextInputStyle.Paragraph)
                .setDefaultValue(reg.proposta.exemplos.map(e => `- ${e.resposta}`).join('\n').slice(0, 900))
                .setRequired(true)
        ));
        return { ok: true, modal };
    }
}

module.exports = { AutoKB };
