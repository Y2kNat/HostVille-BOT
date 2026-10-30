const config = require('../config');
const TierCooldown = require('../utils/TierCooldown');
const { logInfo, logWarn, logError } = require('../utils/logger');

/**
 * Seletor de tier de geração, em DOIS estágios.
 *
 * POR QUE NÃO É SO UM EMBED EPHEMERAL
 *
 * `flags: 64` (ephemeral) só vale em interaction.reply(). O pedido chega por
 * messageCreate — uma Message comum, sem interaction — e não existe como
 * aplicar ephemeral num channel.send(): o Discord recusa.
 *
 * Um CLIQUE em botão, ao contrário, É uma interação. Então:
 *
 *   1. mensagem PÚBLICA no canal, mínima, com UM botão "🎛️ Escolher"
 *   2. no clique: interaction.reply({ flags: 64 }) — aí sim ephemeral,
 *      e o seletor completo dos 4 tiers com os tokens só aparece pra quem pediu
 *
 * A mensagem pública não mostra custo nem cooldown de propósito: a escolha de
 * orçamento é privada, e o canal só registra que existe um seletor.
 *
 * Botões bloqueados por cooldown entram setDisabled(true) — o Discord não
 * entrega o clique, então nem precisa de validação no collector.
 */

const EMBLEMA = { MIN: '🟢', MED: '🔵', HIGH: '🟠', MAX: '🟣' };
const ESTILO = { MIN: 'Success', MED: 'Primary', HIGH: 'Primary', MAX: 'Danger' };

const PRECO_TOKENS = (t) => `${(t / 1000).toFixed(0)}k tokens/arquivo`;

/**
 * Estado de cooldown de um tier para um usuário.
 * @returns {{bloqueado:boolean, restanteMs:number, texto:string}}
 */
function cooldownDe(userId, tier) {
    const cfg = config.GEN_TIERS[tier];
    if (!cfg || !cfg.cooldownH) return { bloqueado: false, restanteMs: 0, texto: '' };
    const g = TierCooldown.get(userId, tier);
    return {
        bloqueado: g.bloqueado,
        restanteMs: g.restanteMs,
        texto: g.bloqueado ? `volta em ${TierCooldown.formatar(g.restanteMs)}` : '',
    };
}

/**
/**
 * Estágio 1: o embed PÚBLICO do canal.
 *
 * Não mostra custo, cooldown nem os 4 tiers. A escolha de orçamento é
 * privada — quem vê o canal precisa saber que existe seletor, não quanto
 * cada um custa nem o que já usou hoje.
 *
 * @param {string} pedido
 * @returns {import('discord.js').EmbedBuilder}
 */
function embedPublico(pedido) {
    const { EmbedBuilder } = require('discord.js');
    return new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🎛️ Escolher qualidade de geração')
        .setDescription(
            'Seu pedido parece um **projeto com vários arquivos**, e aí o bot gera\n' +
            'arquivo por arquivo para cada um sair completo em vez de cortado no meio.\n\n' +
            'Clique abaixo para escolher o **teto de tokens por arquivo**.'
        )
        .addFields({
            name: '🔒 As opções são privadas',
            value: 'O seletor abre só para você, com os 4 níveis, o custo de cada um e o seu cooldown.',
            inline: false,
        })
        .setFooter({ text: `Pedido: ${String(pedido).substring(0, 150)}` })
        .setTimestamp();
}

/** Botão único do estágio 1. */
function linhaBotaoAbrir() {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('gen:abrir')
            .setLabel('🎛️ Escolher qualidade')
            .setStyle(ButtonStyle.Primary)
    );
}

/**
 * Monta o embed do seletor.
 * @param {string} userId
 * @param {string} pedido
 * @returns {import('discord.js').EmbedBuilder}
 */
function embed(userId, pedido) {
    const { EmbedBuilder } = require('discord.js');
    const e = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('⚙️ Quanto de qualidade você quer nesta geração?')
        .setDescription(
            `Pedido: \`\`\`${String(pedido).substring(0, 240)}\`\`\`\n\n` +
            '**Quanto maior o tier, mais caro e mais demorado.** O bot gera arquivo por arquivo, ' +
            'então cada um sai completo em vez de um projeto cortado no meio.'
        )
        .setFooter({ text: 'Você tem 60 segundos para escolher' })
        .setTimestamp();

    for (const tier of config.GEN_TIER_ORDEM) {
        const cfg = config.GEN_TIERS[tier];
        const cd = cooldownDe(userId, tier);
        const valor = `${EMBLEMA[tier]} **${cfg.label.toUpperCase()}** — ${PRECO_TOKENS(cfg.tokens)} · ${cfg.descricao}`;
        e.addFields({
            name: cd.bloqueado ? `${valor} ⏳` : valor,
            value: cd.bloqueado ? `🔒 Em cooldown, ${cd.texto}. Use um tier menor.` : `\u200b`,
            inline: true,
        });
    }
    return e;
}

/**
 * Monta a linha de botões, desabilitando o que está em cooldown.
 * @param {string} userId
 * @returns {import('discord.js').ActionRowBuilder}
 */
function linhaBotoes(userId) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const botoes = config.GEN_TIER_ORDEM.map((tier) => {
        const cfg = config.GEN_TIERS[tier];
        const cd = cooldownDe(userId, tier);
        return new ButtonBuilder()
            .setCustomId(`gen:${tier}`)
            .setLabel(`${EMBLEMA[tier]} ${cfg.label}`)
            .setStyle(ESTILO[tier])
            .setDisabled(cd.bloqueado);
    });
    return new ActionRowBuilder().addComponents(botoes);
}

/**
 * Estágio 1 -> Estágio 2: abre o botão público e, no clique, o seletor ephemeral.
 *
 * @param {object} opts
 * @param {import('discord.js').Message} opts.alvo a mensagem "pensando..." ou um canal
 * @param {string} opts.userId quem pode clicar
 * @param {string} opts.pedido texto do pedido
 * @param {number} [opts.timeoutMs] tempo de cada estágio
 * @returns {Promise<{tier:string|null, expirou:boolean}>}
 */
async function perguntar({ alvo, userId, pedido, timeoutMs = config.GEN_TIER_TIMEOUT_MS }) {
    // ---------- resolve a mensagem do estágio 1 ----------
    const publico = { embeds: [embedPublico(pedido)], components: [linhaBotaoAbrir()] };
    const podeEditar = Boolean(alvo && alvo.id && typeof alvo.edit === 'function');
    let alvoReal = null;
    if (podeEditar) {
        const editado = await alvo.edit(publico).catch(() => null);
        // A edicao precisa devolver a propria Message: e dela que sai o
        // collector. Sem este teste, um .edit que resolve vazio deixaria
        // alvoReal sem .createMessageComponentCollector.
        alvoReal = editado && typeof editado.createMessageComponentCollector === 'function' ? editado : null;
    }
    if (!alvoReal) {
        const enviar = alvo && (alvo.send || alvo.reply);
        if (typeof enviar !== 'function') {
            logWarn('TierJudge: alvo sem .edit nem .send — nao consegui abrir o seletor');
            return { tier: null, expirou: true };
        }
        const enviado = await enviar.call(alvo, publico);
        if (!enviado || typeof enviado.createMessageComponentCollector !== 'function') {
            logWarn('TierJudge: o envio nao devolveu Message com collector');
            return { tier: null, expirou: true };
        }
        alvoReal = enviado;
    }

    const fecharPublico = async (payload) => {
        try {
            if (typeof alvoReal.edit === 'function') await alvoReal.edit(payload);
        } catch { /* cosmético: a geração não depende disso */ }
    };

    return new Promise((resolve) => {
        let resolvido = false;
        // Com max:1 o discord.js emite 'end' assim que despacha o 'collect',
        // SEM esperar o handler assíncrono terminar. Sem esta flag o 'end'
        // achava que o usuário não tinha clicado, resolvia o fluxo como
        // cancelado e matava a geração — enquanto o seletor ephemeral ainda
        // abria normalmente depois. Sintoma real em produção: os 4 botões
        // apareciam e o clique num deles não fazia nada.
        let emAndamento = false;

        const finalizar = (r) => {
            if (resolvido) return;
            resolvido = true;
            collector.stop('resolvido');
            resolve(r);
        };

        // ---------- ESTÁGIO 1: o botão público ----------
        const collector = alvoReal.createMessageComponentCollector({
            filter: (i) => i.user.id === String(userId) && i.customId === 'gen:abrir',
            time: timeoutMs,
            max: 1,
        });

        collector.on('collect', (clickAbrir) => {
            // Marca de forma SÍNCRONA, antes de qualquer await. Se a flag
            // fosse setada depois do primeiro await, o 'end' do discord.js
            // já teria passado e o fluxo morria aqui.
            emAndamento = true;
            // Sem await de propósito: este handler tem vida própria e dura
            // até o usuário escolher o tier no ephemeral, muito depois do
            // 'end' do collector público.
            abrirSeletorPrivado(clickAbrir).catch((e) => {
                logError(`TierJudge: falhou ao abrir o seletor: ${e.message}`);
                fecharPublico({ content: '❌ Erro ao abrir o seletor.', embeds: [], components: [] });
                finalizar({ tier: null, expirou: false });
            });
        });

        collector.on('end', (collected, reason) => {
            // emAndamento: o usuário já abriu o seletor e o resto acontece no
            // ephemeral. Este 'end' é só o max:1 encerrando o collector.
            if (resolvido || emAndamento) return;
            resolvido = true;
            if (reason === 'time') {
                // O .edit precisa de guarda propria: um .edit que resolver
                // rejeitado deixaria a excecao escapar e o chamador ver um
                // crash em vez de "o usuario nao escolheu".
                fecharPublico({
                    content: '⏰ Tempo esgotado — nada foi gerado. Pede de novo se quiser.',
                    embeds: [],
                    components: [],
                });
                logWarn(`TierJudge: ${userId} nao abriu o seletor em ${timeoutMs}ms`);
            }
            resolve({ tier: null, expirou: true });
        });

        /**
         * Estágio 2, disparado pelo clique em `gen:abrir`.
         *
         * Vive FORA do handler do collector de propósito: precisa sobreviver
         * ao 'end' do max:1 e durar até o clique no tier, no ephemeral.
         */
        async function abrirSeletorPrivado(clickAbrir) {
            // O clique num botão É uma interação: é aqui que flags:64 vale.
            // O seletor completo dos 4 tiers, com custo e cooldown, sai só
            // para quem pediu.
            const eph = await clickAbrir.reply({
                embeds: [embed(userId, pedido)],
                components: [linhaBotoes(userId)],
                flags: 64,
            }).catch(() => null);

            if (!eph) {
                await fecharPublico({ content: '❌ Não consegui abrir o seletor privado.', embeds: [], components: [] });
                return finalizar({ tier: null, expirou: false });
            }

            // ---------- ESTÁGIO 2: escolher o tier, no ephemeral ----------
            //
            // NENHUM atalho da biblioteca serve aqui, e os dois já falharam em
            // produção:
            //
            // 1. `interaction.awaitReplyComponent()` NÃO EXISTE no discord.js
            //    14.26.4. Chamar lançava TypeError na hora.
            // 2. `InteractionResponse.awaitMessageComponent()` existe, mas
            //   Internamente filtra por `messageId`, que reply() define como o id da
            //    mensagem interaction-metadata da PÚBLICA (reply() devolve
            //    `new InteractionResponse(this)`, sem id próprio). O clique no
            //    ephemeral traz `message.id` diferente, então o filtro interno
            //    rejeita e o collector expira sem nunca ver o clique.
            //
            // Por isso a espera é feita no evento interactionCreate do client,
            // com filtro próprio. O ephemeral é privado do usuário, então
            // filtrar por user.id + prefixo do customId já é a amarração
            // correta: mais ninguém consegue clicar nele.
            const client = clickAbrir.client;
            if (!client || typeof client.on !== 'function') {
                logError('TierJudge: sem client na interação, não dá para esperar o tier');
                await fecharPublico({ content: '❌ Não consegui abrir a espera do seletor.', embeds: [], components: [] });
                return finalizar({ tier: null, expirou: false });
            }

            let escolha;
            try {
                escolha = await new Promise((resolve, reject) => {
                    const onInteracao = (i) => {
                        if (!i.isButton || !i.isButton()) return;
                        if (i.user.id !== String(userId)) return;
                        if (!i.customId.startsWith('gen:')) return;
                        clearTimeout(timer);
                        client.off('interactionCreate', onInteracao);
                        resolve(i);
                    };
                    const timer = setTimeout(() => {
                        client.off('interactionCreate', onInteracao);
                        reject(new Error('tempo esgotado esperando o tier'));
                    }, timeoutMs);
                    client.on('interactionCreate', onInteracao);
                });
            } catch (e) {
                const esgotou = e && /tempo esgotado/i.test(e.message || '');
                logWarn(`TierJudge: espera do tier encerrada (${e && e.message})`);
                await fecharPublico(esgotou
                    ? { content: '⏰ Tempo esgotado no seletor — nada foi gerado.', embeds: [], components: [] }
                    : { content: '❌ Erro ao receber a escolha do tier. Pede de novo.', embeds: [], components: [] });
                return finalizar({ tier: null, expirou: esgotou });
            }

            const tier = escolha.customId.split(':')[1];
            const cfg = config.GEN_TIERS[tier];
            if (!cfg) {
                await escolha.reply({ content: '❌ Tier desconhecido.', flags: 64 }).catch(() => {});
                return finalizar({ tier: null, expirou: false });
            }

            // Defense in depth: o botão já vem desabilitado, mas um clique
            // pode ter sido enfileirado antes da edição do embed.
            const cd = cooldownDe(userId, tier);
            if (cd.bloqueado) {
                await escolha.reply({
                    content: `⏳ O tier **${cfg.label}** ainda está em cooldown: ${cd.texto}.`,
                    flags: 64,
                }).catch(() => {});
                return finalizar({ tier: null, expirou: false });
            }

            // A JANELA curta e o COOLDOWN longo sao camadas separadas: o
            // RateLimiter segura rajada em memoria, o TierCooldown persiste
            // o 12h/24h. Registrar so aqui, no clique, e nao antes.
            const { gate } = require('./RateLimiter');
            const espera = gate(`gen:${tier}`, userId);
            if (espera) {
                await escolha.reply({
                    content: `⏳ Calma! Espera ${espera} antes de gerar de novo.`,
                    flags: 64,
                }).catch(() => {});
                return finalizar({ tier: null, expirou: false });
            }

            if (cfg.cooldownH) {
                TierCooldown.set(userId, tier, cfg.cooldownH);
                logInfo(`TierJudge: ${userId} usou ${cfg.label} (cooldown de ${cfg.cooldownH}h aplicado)`);
            }

            // A confirmação é best-effort: o events/interactionCreate.js do
            // projeto roda no mesmo clique e, se ele já tiver respondido,
            // reply() estoura "already replied". followUp() cobre esse caso
            // para o usuário não ficar sem retorno.
            const aviso = `✅ Gerando no tier **${cfg.label}** — ${PRECO_TOKENS(cfg.tokens)} por arquivo.\nAviso aqui quando terminar.`;
            const respondeu = await escolha.reply({ content: aviso, flags: 64 })
                .then(() => true)
                .catch(() => escolha.followUp({ content: aviso, flags: 64 }).then(() => true).catch(() => false));
            if (!respondeu) {
                logWarn(`TierJudge: nao consegui responder a confirmacao do tier ${cfg.label} (o gerador segue)`);
            }

            // O canal fica so com o registro do tier escolhido. O custo fica
            // no ephemeral, que é onde o usuario escolheu ver.
            await fecharPublico({
                embeds: [
                    new (require('discord.js').EmbedBuilder)()
                        .setColor(0x57F287)
                        .setTitle('🎛️ Geração iniciada')
                        .addFields({ name: 'Tier', value: `${EMBLEMA[tier]} **${cfg.label}**`, inline: true })
                        .setTimestamp(),
                ],
                components: [],
            });

            finalizar({ tier, expirou: false });
        }
    });
}

module.exports = {
    perguntar, embed, embedPublico, linhaBotoes, linhaBotaoAbrir,
    cooldownDe, PRECO_TOKENS, EMBLEMA,
};
