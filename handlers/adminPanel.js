const {
    EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');

const config = require('../config');
const db = require('../database/db');
const Features = require('../managers/FeatureRegistry');
const StatsManager = require('../managers/StatsManager');
const ModerationLog = require('../utils/ModerationLog');
const MaintenanceManager = require('../managers/MaintenanceManager');
const { logInfo, logError } = require('../utils/logger');
const { gate } = require('../managers/RateLimiter');

/**
 * Painel administrativo — o `/adm`.
 *
 * O QUE ERA
 * Três botões decorativos (estatísticas, console, ajuda) atrás de um
 * `code !== config.ACCESS_CODE`, sem rate limit e sem checar quem clica.
 * Nenhuma feature do bot era gerenciável por ali.
 *
 * O QUE É
 * O catálogo do FeatureRegistry desenhado em 4 grupos, com o estado real de
 * cada chave lido do banco. Escolher a chave no menu É o toggle — não existe
 * par "botão + confirmar" para 19 linhas.
 *
 * SEGURANÇA (o /adm estava atrás do resto do bot nas três)
 *   1. `confereAcesso(..., 'adm')` — tempo constante e 5 tentativas/min.
 *      O caminho de slash não passa pelo anti-spam.
 *   2. Todo customId carrega o userId de quem recebeu o menu, e a chegada
 *      confere. O customId é previsível; o que não é previsível é o clique
 *      vir de um botão real de uma mensagem real. Mesmo padrão do B19 em
 *      handlers/monitoring.js.
 *   3. Chave `global` e o botão de pausa exigem OWNER_ID. O ACCESS_CODE
 *      liga o painel; o dono decide o que é da rede inteira.
 *   4. Ação destrutiva pede o nome do servidor digitado num modal. Um clique
 *      acidental em celular não desliga a moderação de ninguém.
 */

// ── AUTORIZAÇÃO ─────────────────────────────────────────────────────────────

/**
 * O clique veio de quem recebeu o menu?
 *
 * Sem isto, um customId como `adm_toggle_filtro_palavras` é adivinhável: o
 * caminho de `interactionCreate.js` só exige que a string comece com `adm:`.
 */
function autorizado(interaction, esperadoUserId) {
    if (!esperadoUserId) return false;
    return interaction.user.id === esperadoUserId;
}

/** Chave de rede: só o dono mexe. */
function podeGlobal(interaction) {
    return !!config.OWNER_ID && interaction.user.id === config.OWNER_ID;
}

// ── IDENTIFICAÇÃO DE ESCOPO ────────────────────────────────────────────────

const ESCOPO_GLOBAL = 'global';
const GLOBAL_ID = 'global';

function escopoDoCustomId(guildId) {
    return guildId === GLOBAL_ID ? ESCOPO_GLOBAL : 'guild';
}

function rotuloEscopo(guildId, client) {
    if (guildId === GLOBAL_ID) return '🌐 Rede inteira (todos os servidores)';
    const g = client?.guilds?.cache?.get(guildId);
    return `🏛️ ${g ? g.name : `servidor ${guildId}`}`;
}

/**
 * Corta para o limite do Discord preservando palavra inteira.
 *
 * `StringSelectMenuOptionBuilder.setDescription` aceita no máximo 100
 * caracteres, e `setLabel` no máximo 100 também. A tela de grupo compõe a
 * descrição como `marcador + separador + descrição da chave`, então o
 * orçamento da parte variável é 100 MENOS o tamanho do marcador — cortar a
 * parte variável em 90 e juntar o marcador estoura, e o discord.js levanta
 * `Invalid string length` no meio do update.
 */
function cabe(texto, limite) {
    const t = String(texto || '');
    if (t.length <= limite) return t;
    const cortado = t.slice(0, limite - 1);
    const ultimoEspaco = cortado.lastIndexOf(' ');
    return (ultimoEspaco > limite * 0.5 ? cortado.slice(0, ultimoEspaco) : cortado) + '…';
}

// ── CONSTRUÇÃO DAS TELAS ────────────────────────────────────────────────────

/**
 * Menu principal.
 *
 * Limites do DiscordLevados a sério: 5 botões por row, 5 rows, label 80
 * chars visíveis, customId 100. Por isso os grupos são botões e as chaves
 * são um select — 19 chaves não cabem em botão nenhum.
 */
function embedMenu(client, guildId, autor) {
    const e = new EmbedBuilder()
        .setTitle('🔐 Painel Administrativo — HostVille • BOT')
        .setColor(Colors.Blue)
        .setDescription(
            `Gerencie as funções do bot em **${rotuloEscopo(guildId, client)}**.\n` +
            'Escolha uma categoria abaixo. Toda mudança é registrada em log.'
        );

    e.addFields(
        { name: '👤 Usuário', value: `${autor.tag}\n\`${autor.id}\``, inline: true },
        { name: '🗓 Data', value: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), inline: true }
    );

    const e2 = new EmbedBuilder()
        .setColor(Colors.Blue)
        .setDescription(
            '**Categorias**\n' +
            (guildId === GLOBAL_ID
                ? 'Aqui só vale o que é da **rede inteira**. As funções de cada servidor ficam no painel dele.\n' +
                  'Para cortar tudo de uma vez em um servidor: **🛑 Pausa de emergência**.'
                : '🛡️ **Moderação** — xingamento, IA, spam, link, punição\n' +
                  '🤖 **Inteligência** — chat com IA, arrastar/responder\n' +
                  '🎫 **Tickets** — atendente, IA, transcrição\n' +
                  '⚙️ **Sistema** — monitoramento')
        );

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`adm:grupo:mod:${guildId}:${autor.id}`).setLabel('🛡️ Moderação').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`adm:grupo:ia:${guildId}:${autor.id}`).setLabel('🤖 Inteligência').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`adm:grupo:ticket:${guildId}:${autor.id}`).setLabel('🎫 Tickets').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`adm:grupo:sistema:${guildId}:${autor.id}`).setLabel('⚙️ Sistema').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`adm:status:${guildId}:${autor.id}`).setLabel('📊 Status geral').setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`adm:xingamentos:${guildId}:${autor.id}`).setLabel('🛡️ Xingamentos').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`adm:pausa:${guildId}:${autor.id}`).setLabel('🛑 Pausa de emergência').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`adm:trocarservidor:${guildId}:${autor.id}`).setLabel('🔄 Trocar servidor').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [e, e2], components: [row1, row2] };
}

/**
 * Tela de um grupo. Cada chave vira uma linha do select com o estado no
 * rótulo — o menu é a lista E o controle.
 */
async function telaGrupo(client, grupo, guildId, autor) {
    const estado = await Features.estado(guildId);
    const itens = Features.grupoDe(grupo, guildId);

    const info = Features.grupos()[grupo];
    const linhas = itens.map(it => {
        const v = estado[it.key];
        const marca = v === true ? '🟢' : (v === false ? '🔴' : '⚪');
        const escopoTag = it.scope === 'global' ? ' `global`' : '';
        const dono = it.ownerOnly ? ' 🔒' : '';
        const perig = it.danger ? ' ⚠️' : '';
        return `${marca} **${it.label}**${escopoTag}${dono}${perig}`;
    });

    const embed = new EmbedBuilder()
        .setTitle(`${info.emoji} ${info.label}`)
        .setColor(Colors.Blue)
        .setDescription(
            `Em **${rotuloEscopo(guildId, client)}**.\n` +
            (guildId === GLOBAL_ID
                ? 'Funções da **rede inteira**. As que são por servidor ficam no painel de cada servidor.\n\n'
                : '🟢 ligado · 🔴 desligado · 🔒 só o dono\n\n') +
            (linhas.length ? linhas.join('\n') : '_Nenhuma chave neste grupo para este escopo._')
        );

    if (itens.some(i => i.desc)) {
        embed.setFooter({ text: 'Escolha uma linha abaixo para ligar/desligar. O que muda é explica no rodapé.' });
    }

    // O Discord conta as opções marcadas como default contra o `max_values`
    // (que, sem setMaxValues, é 1) e recusa o UPDATE INTEIRO com
    // COMPONENT_TOO_MANY_DEFAULT_VALUES. Marcar toda função desligada
    // quebrava a tela de grupo justamente depois da pausa de emergência,
    // que desliga 4 chaves do grupo mod de uma vez. Então no máximo 1.
    let jaTemPadrao = false;
    const opcoes = itens.slice(0, 25).map(it => {
        const v = estado[it.key];
        const marca = v ? '🟢 LIGADO' : '🔴 DESLIGADO';
        const padrao = v === false && !jaTemPadrao;
        if (padrao) jaTemPadrao = true;
        return new StringSelectMenuOptionBuilder()
            .setLabel(cabe(it.label, 100))
            // 100 é o teto do Discord. A marca entra na conta.
            .setDescription(cabe(`${marca} — ${it.desc || ''}`, 100))
            .setValue(it.key)
            .setDefault(padrao)
            .setEmoji(v ? '🟢' : '🔴');
    });

    const row1 = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`adm:toggle:${guildId}:${autor.id}`)
            .setPlaceholder('Selecione a função para ligar/desligar')
            .setMaxValues(1)
            .addOptions(opcoes.length ? opcoes : [
                new StringSelectMenuOptionBuilder()
                    .setLabel('Nada para configurar aqui')
                    .setDescription('Este grupo está vazio neste escopo.')
                    .setValue('__nada__')
            ])
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`adm:voltar:${guildId}:${autor.id}`).setLabel('↩️ Voltar').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`adm:status:${guildId}:${autor.id}`).setLabel('📊 Status geral').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`adm:ajuda:${guildId}:${autor.id}`).setLabel('❓ Ajuda').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`adm:xingamentos:${guildId}:${autor.id}`).setLabel('🛡️ Xingamentos').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row1, row2] };
}

/** Status geral: as chaves do escopo, resumidas. */
async function telaStatus(client, guildId, autor) {
    const estado = await Features.estado(guildId);
    const s = StatsManager.getStats();
    const guild = client?.guilds?.cache?.get(guildId);

    const porGrupo = {};
    for (const k of Features.keys()) {
        if (!Object.prototype.hasOwnProperty.call(estado, k)) continue;
        const g = Features.grupo(k);
        porGrupo[g] = porGrupo[g] || { on: 0, off: 0 };
        if (estado[k]) porGrupo[g].on++; else porGrupo[g].off++;
    }

    const linhasGrupos = Object.entries(porGrupo).map(([g, v]) => {
        const info = Features.grupos()[g];
        const barra = v.on >= v.off ? '🟩' : '🟥';
        return `${barra} **${info.emoji} ${info.label}** — ${v.on} ligadas · ${v.off} desligadas`;
    });

    const uptime = Math.floor((client.uptime || 0) / 1000);
    const hh = String(Math.floor(uptime / 3600)).padStart(2, '0');
    const mm = String(Math.floor((uptime % 3600) / 60)).padStart(2, '0');

    const embed = new EmbedBuilder()
        .setTitle('📊 Status geral — HostVille • BOT')
        .setColor(Colors.Green)
        .setDescription(`Servidor: **${rotuloEscopo(guildId, client)}**` +
            (guild ? `\nMembros: **${guild.memberCount}** · online agora: **${guild.members.cache.filter(m => m.presence?.status !== 'offline').size}**` : ''))
        .addFields(
            { name: '⚙️ Funções por grupo', value: linhasGrupos.join('\n') || '—', inline: false },
            { name: '🛡️ Moderação acumulada', value:
                `Xingamentos: **${s.xingamentos || 0}**\n` +
                `Avisos: **${s.warnsGiven || 0}**\n` +
                `Mensagens apagadas: **${s.messagesDeleted || 0}**\n` +
                `Spam barrado: **${s.spamBloqueado || 0}** · Links barrados: **${s.linkBloqueado || 0}**\n` +
                `Casos sem decisão da IA: **${s.needsReview || 0}**`, inline: true },
            { name: '🤖 Bot', value:
                `Ping: **${client.ws?.ping ?? '?'}ms**\n` +
                `Uptime: **${hh}h ${mm}m**\n` +
                `Servidores: **${client.guilds?.cache?.size ?? 0}**\n` +
                `Manutenção: ${MaintenanceManager.isEnabled() ? '🔴 **LIGADA**' : '🟢 desligada'}`, inline: true },
            { name: '🔧 Como alterar', value:
                'Use os botões de categoria para ver e trocar cada função.\n' +
                'O botão **🛑 Pausa de emergência** desliga filtro, spam, link e IA de moderação de uma vez, sem apagar a configuração.', inline: false }
        )
        .setFooter({ text: `Consultado por ${autor.tag} · ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`adm:voltar:${guildId}:${autor.id}`).setLabel('↩️ Voltar').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`adm:pausa:${guildId}:${autor.id}`).setLabel('🛑 Pausa de emergência').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`adm:ajuda:${guildId}:${autor.id}`).setLabel('❓ Ajuda').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
}

/**
 * Tela de xingamentos — o que o bot não contava antes.
 *
 * Esta tela é a resposta a "monitorar xingamentos": antes o caso vivia num
 * bloco colorido no console e numa linha de arquivo de texto que some no dia
 * seguinte. Aqui vira número, e o número tem histórico.
 */
function telaXingamentos(guildId, autor, janela = 'tudo') {
    const JANELAS = {
        '1h': 3600000, '24h': 86400000, '7d': 604800000, 'tudo': 0
    };
    const r = ModerationLog.resumo(guildId === GLOBAL_ID ? null : guildId, JANELAS[janela] ?? 0);

    const escopoTxt = guildId === GLOBAL_ID ? 'na rede inteira' : 'neste servidor';

    const embed = new EmbedBuilder()
        .setTitle('🛡️ Monitor de xingamentos')
        .setColor(Colors.Red)
        .setDescription(
            `**${r.total}** caso(s) ${escopoTxt} no período.\n` +
            (r.bufferTotal ? `_buffer local: ${r.bufferTotal} registros (ring buffer de 3000)_` : '_sem registros ainda_')
        )
        .addFields(
            { name: '📉 Resultado', value:
                `🔴 Apagados + avisados: **${r.punidos}**\n` +
                `🟡 Staff registrou, sem punição: **${r.staff}**\n` +
                `🟠 Sem decisão da IA (nada apagado): **${r.review}**\n` +
                `🟢 Autorizado: **${Math.max(0, r.total - r.punidos - r.staff - r.review)}**`, inline: true },
            { name: '📍 Origem', value:
                (r.origem.length ? r.origem.map(o => `\`${o.chave}\` **${o.total}**`).join('\n') : '—'), inline: true }
        );

    if (r.severidade.length) {
        embed.addFields({
            name: '⚖️ Severidade',
            value: r.severidade.map(s => `\`${s.chave}\` **${s.total}**`).join(' · '),
            inline: false
        });
    }

    if (r.palavras.length) {
        embed.addFields({
            name: '🔤 Palavras mais usadas',
            value: r.palavras.slice(0, 8).map((p, i) => `${i + 1}. \`${p.chave}\` — **${p.total}**`).join('\n'),
            inline: false
        });
    }
    if (r.infratores.length) {
        embed.addFields({
            name: '👤 Quem mais repete',
            value: r.infratores.slice(0, 5).map((p, i) => `${i + 1}. ${p.chave} — **${p.total}**`).join('\n'),
            inline: false
        });
    }
    if (r.canais.length) {
        embed.addFields({
            name: '📺 Onde mais acontece',
            value: r.canais.slice(0, 5).map((p, i) => `${i + 1}. #${p.chave} — **${p.total}**`).join('\n'),
            inline: false
        });
    }

    const ultimos = ModerationLog.recentes(8, guildId === GLOBAL_ID ? null : guildId);
    if (ultimos.length) {
        embed.addFields({
            name: '🕐 Últimos casos',
            value: ultimos.map(r2 => {
                const quando = new Date(r2.ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                const icone = r2.acao === 'punido' ? '🔴' : (r2.acao === 'staff' ? '🟡' : '🟠');
                const quem = r2.userTag ? r2.userTag.split('#')[0] : r2.userId;
                return `${icone} \`${quando}\` **${quem}** em #${r2.channelName || '—'} → \`${r2.palavra}\` (${r2.severidade}${r2.confianca ? ' ' + r2.confianca : ''})`;
            }).join('\n'),
            inline: false
        });
    }

    embed.setFooter({ text: `Consultado por ${autor.tag} · período: ${janela}` }).setTimestamp();

    const palavras = ModerationLog.palavrasConhecidas(guildId === GLOBAL_ID ? null : guildId, 20);
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`adm:janela:1h:${guildId}:${autor.id}`).setLabel('1h').setStyle(janela === '1h' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`adm:janela:24h:${guildId}:${autor.id}`).setLabel('24h').setStyle(janela === '24h' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`adm:janela:7d:${guildId}:${autor.id}`).setLabel('7d').setStyle(janela === '7d' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`adm:janela:tudo:${guildId}:${autor.id}`).setLabel('Tudo').setStyle(janela === 'tudo' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`adm:voltar:${guildId}:${autor.id}`).setLabel('↩️ Voltar').setStyle(ButtonStyle.Secondary)
    );
    if (palavras.length && guildId !== GLOBAL_ID) {
        row2.addComponents(
            new ButtonBuilder().setCustomId(`adm:banir:${guildId}:${autor.id}`).setLabel('🚫 Banir do log').setStyle(ButtonStyle.Danger)
        );
    }

    return { embeds: [embed], components: [row1, row2] };
}

function telaAjuda(guildId, autor) {
    const embed = new EmbedBuilder()
        .setTitle('❓ Ajuda do painel')
        .setColor(Colors.Blue)
        .setDescription(
            '**Como usar**\n' +
            '1. `/adm SEU_CODIGO` abre o painel\n' +
            '2. Escolha uma categoria (🛡️ Moderação, 🤖 IA, 🎫 Tickets, ⚙️ Sistema)\n' +
            '3. Escolha a função na lista — escolher já liga/desliga\n\n' +
            '**Legenda**\n' +
            '🟢 ligado · 🔴 desligado · ⚪ sem configuração\n' +
            '`global` vale para todos os servidores do bot\n' +
            '🔒 só o dono do bot mexe\n' +
            '⚠️ desligar isso tem consequência séria'
        )
        .addFields(
            { name: '⚡️ O que é o botão de pausa', value:
                '**🛑 Pausa de emergência** desliga de uma vez o filtro de xingamento, o anti-spam, o anti-link e a IA de moderação — do servidor, ou da rede inteira se você for o dono.\n\n' +
                'Ela **não apaga** a configuração: cada chave volta ao valor que tinha. Serve para quando o bot começa a apagar mensagem errada em massa e alguém precisa cortar o sangue antes de entender a causa.', inline: false },
            { name: '🔎 Ajustes finos', value:
                'O painel liga a função no servidor inteiro. Para exceções por canal:\n' +
                '`/filter disable` — filtro de palavra só naquele canal\n' +
                '`/ai-ticket` — IA só naquele ticket\n' +
                '`/transcript` — transcrição no servidor\n' +
                '`/linksettings` — domínios permitidos', inline: false },
            { name: '🧾 Rastro', value:
                'Toda troca fica no arquivo de log do dia, no console e no painel em tempo real (`utils/realtime.js`), com quem, o quê, quando e o valor antes → depois.\n\n' +
                'O botão 🛡️ **Xingamentos** mostra o histórico agregado do filtro: palavra mais usada, quem mais repete, severidade e os últimos casos. Esse número não existia antes.', inline: false },
            { name: '🔐 Segurança', value:
                'Este painel abre com `ACCESS_CODE`, com no máximo 5 tentativas por minuto.\n' +
                'As funções da rede inteira pedem o ID de dono do bot por cima disso.\n' +
                'Se o código vazar, troque em `.env` e reinicie — o valor não é gravado em lugar nenhum além do arquivo.', inline: false }
        )
        .setFooter({ text: `Painel de ${autor.tag}` });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`adm:voltar:${guildId}:${autor.id}`).setLabel('↩️ Voltar').setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [row] };
}

/** Seletor de servidor. O bot roda em N servidores e as funções são por-guild. */
function telaTrocarServidor(client, guildIdAtual, autor) {
    const guilds = [...(client.guilds?.cache?.values() || [])].slice(0, 24);
    const embed = new EmbedBuilder()
        .setTitle('🔄 Trocar de servidor')
        .setColor(Colors.Blue)
        .setDescription('As funções são configuradas por servidor. Escolha qual você quer managear.' +
            (client.guilds?.cache?.size > 24 ? '\n_(mostrando os 24 primeiros)_' : ''));

    // Aqui no máximo 1 default por construção (o servidor atual ou a rede
    // inteira, nunca os dois). Mesma regra do select de grupo: default é
    // contado contra max_values.
    const opcoes = [
        new StringSelectMenuOptionBuilder()
            .setLabel('🌐 Rede inteira')
            .setDescription('Funções que valem para todos os servidores (só o dono)')
            .setValue(GLOBAL_ID)
            .setDefault(guildIdAtual === GLOBAL_ID)
    ];
    for (const g of guilds) {
        opcoes.push(new StringSelectMenuOptionBuilder()
            .setLabel(cabe(g.name, 100))
            .setDescription(cabe(`${g.memberCount} membros${g.id === guildIdAtual ? ' · atual' : ''}`, 100))
            .setValue(g.id)
            .setEmoji('🏛️')
            .setDefault(g.id === guildIdAtual));
    }

    const row1 = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`adm:escopo:${autor.id}`)
            .setPlaceholder('Escolha o servidor')
            .addOptions(opcoes)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`adm:voltar:${guildIdAtual}:${autor.id}`).setLabel('↩️ Voltar').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row1, row2] };
}

// ── MENSAGENS DE CONFIRMAÇÃO ────────────────────────────────────────────────

/**
 * Aplica o que o modal confirmou e monta a resposta.
 *
 * `__pausa__` não é uma chave do catálogo: é a transição de emergência, que
 * escreve várias chaves de uma vez. A lista é explícita (PAUSA_GUILD /
 * PAUSA_GLOBAL) em vez de varrer o catálogo, porque uma varredura passaria
 * por `manutencao` e `canal_estudo`, que não é o que "pausar moderação"
 * quer dizer.
 */
async function aplicarConfirmacao(interaction, guildId, key, alvo) {
    const client = interaction.client;
    const autor = `${interaction.user.tag} (${interaction.user.id})`;

    const espera = gate('admwrite', `${interaction.user.id}:${key}`);
    if (espera) {
        await interaction.reply({ content: `⏳ Calma! Tente de novo ${espera}.`, flags: 64 });
        return true;
    }

    if (key === '__pausa__') {
        const lista = guildId === GLOBAL_ID
            ? Features.PAUSA_GLOBAL
            : Features.PAUSA_GUILD;
        const resultados = [];
        for (const k of lista) {
            const r = await Features.set(k, guildId, alvo, autor);
            if (r.ok) resultados.push(`${r.valor ? '🟢' : '🔴'} ${Features.labelDe(k)}`);
        }
        const manutencao = await Features.ligado('manutencao', GLOBAL_ID);
        if (manutencao) {
            MaintenanceManager.setData({ enabled: false });
            resultados.push('🔴 Manutenção (destravada)');
        }
        await Features.auditar('__pausa__', guildId, !alvo, alvo, autor);

        const embed = new EmbedBuilder()
            .setTitle(alvo ? '🟢 Pausa desfeita' : '🛑 Pausa de emergência ativada')
            .setColor(alvo ? Colors.Green : Colors.Red)
            .setDescription(
                (alvo
                    ? 'A moderação voltou. Vale o que estava configurado antes da pausa.'
                    : 'A moderação foi cortada. O aviso ao usuário continua funcionando; o filtro não.') +
                `\n\nAlvo: **${rotuloEscopo(guildId, client)}**`
            )
            .addFields({ name: 'Funções alteradas', value: resultados.join('\n') || 'nenhuma' })
            .setFooter({ text: `Por ${interaction.user.tag} · confira o log de mudanças` })
            .setTimestamp();

        await interaction.update({
            embeds: [embed],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`adm:status:${guildId}:${interaction.user.id}`).setLabel('📊 Ver status').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`adm:voltar:${guildId}:${interaction.user.id}`).setLabel('↩️ Voltar').setStyle(ButtonStyle.Secondary)
            )]
        });
        logInfo(`[adm] ${autor} ${alvo ? 'desfez' : 'acionou'} a pausa de emergência em ${rotuloEscopo(guildId, client)}`);
        return true;
    }

    const def = Features.get(key);
    if (!def) {
        await interaction.reply({ content: '❌ Função desconhecida.', flags: 64 });
        return true;
    }

    const r = await Features.set(key, guildId, alvo, autor);
    if (!r.ok) {
        await interaction.reply({ content: `❌ ${r.erro}`, flags: 64 });
        return true;
    }
    await interaction.update(confirmacaoEmbed(def, r, guildId, client, interaction.user));
    return true;
}

function confirmacaoEmbed(def, r, guildId, client, user) {
    return {
        embeds: [new EmbedBuilder()
            .setTitle(r.valor ? '🟢 Confirmado: ligada' : '🔴 Confirmado: desligada')
            .setColor(r.valor ? Colors.Green : Colors.Red)
            .setDescription(`**${def.label}** — ${rotuloEscopo(guildId, client)}`)
            .addFields(
                { name: 'Antes → depois', value: `${r.antes ? '🟢 ligado' : '🔴 desligado'} → ${r.valor ? '🟢 ligado' : '🔴 desligado'}`, inline: false },
                { name: 'O que ela controla', value: cabe(def.desc || '—', 1024), inline: false }
            )
            .setFooter({ text: `Alterado por ${user.tag}` })
            .setTimestamp()],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`adm:grupo:${def.group}:${guildId}:${user.id}`).setLabel('↩️ Voltar ao grupo').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`adm:status:${guildId}:${user.id}`).setLabel('📊 Status').setStyle(ButtonStyle.Secondary)
        )]
    };
}

// ── ROTEAMENTO ──────────────────────────────────────────────────────────────

/**
 * Ponto de entrada único. Tudo que começa com `adm:` chega aqui.
 *
 * Formato do customId: `adm:<acao>[:<arg>]:<guildId>:<userId>`
 * As duas últimas posições são o escopo e o dono do menu. A autorização é
 * conferida em TODA entrada, antes de qualquer efeito.
 */
async function handleAdmInteraction(interaction) {
    const partes = String(interaction.customId || '').split(':');
    if (partes[0] !== 'adm') return false;

    const acao = partes[1];
    // guildId e userId são as DUAS últimas posições. Parsing por cauda porque
    // `arg` pode ou não existir, depending da ação.
    const userId = partes[partes.length - 1];
    const guildId = partes[partes.length - 2];

    if (!autorizado(interaction, userId)) {
        logError(`[adm] clique recusado: user=${interaction.user.id} tentou "${acao}" de menu de user=${userId || '?'}`);
        try { await interaction.reply({ content: '❌ Este menu não é seu. Use `/adm SEU_CÓDIGO` para abrir o seu.', flags: 64 }); } catch (e) {}
        return true;
    }

    // Chave de rede = só o dono. Chave de servidor = quem tem o ACCESS_CODE,
    // que é o que o `/adm` sempre exigiu.
    //
    // Isto foi escrito como `guildId === 'global' || podeGlobal(...)`, que é
    // o oposto do pretendido: recusava também o painel de SERVIDOR para
    // qualquer um que não fosse o dono do bot.
    if (guildId === GLOBAL_ID && !podeGlobal(interaction)) {
        const msg = '🔒 Essa é uma função da rede inteira. Só o dono do bot mexe nela.';
        try { await interaction.reply({ content: msg, flags: 64 }); } catch (e) {}
        return true;
    }

    const client = interaction.client;

    try {
        switch (acao) {
            // ── MENU ──────────────────────────────────────────────────────
            case 'menu': {
                // Gerado pela tela de troca de servidor. Sem este caso, cairia
                // no default com "botão desconhecido" logo depois de a tela
                // prometer que o painel ia abrir.
                await interaction.reply({
                    content: 'Painel Administrativo:',
                    ...embedMenu(client, guildId, interaction.user),
                    flags: 64
                });
                return true;
            }

            case 'voltar': {
                await interaction.update(embedMenu(client, guildId, interaction.user));
                return true;
            }

            case 'grupo': {
                const grupo = partes[2];
                const tela = await telaGrupo(client, grupo, guildId, interaction.user);
                await interaction.update(tela);
                return true;
            }

            case 'status': {
                const tela = await telaStatus(client, guildId, interaction.user);
                await interaction.update(tela);
                return true;
            }

            case 'ajuda': {
                await interaction.update(telaAjuda(guildId, interaction.user));
                return true;
            }

            case 'xingamentos': {
                await interaction.update(telaXingamentos(guildId, interaction.user, 'tudo'));
                return true;
            }

            case 'janela': {
                const janela = partes[2] || 'tudo';
                await interaction.update(telaXingamentos(guildId, interaction.user, janela));
                return true;
            }

            case 'trocarservidor': {
                await interaction.update(telaTrocarServidor(client, guildId, interaction.user));
                return true;
            }

            case 'escopo': {
                const escolhido = interaction.values[0];
                if (!client.guilds?.cache?.get(escolhido) && escolhido !== GLOBAL_ID) {
                    await interaction.reply({
                        content: '❌ Esse servidor não está mais com o bot.',
                        flags: 64
                    });
                    return true;
                }
                const estado = await Features.estado(escolhido);
                const linhas = Object.entries(estado).slice(0, 20)
                    .map(([k, v]) => `${v ? '🟢' : '🔴'} **${Features.labelDe(k)}** — ${v ? 'ligado' : 'desligado'}`);
                const info = new EmbedBuilder()
                    .setTitle(rotuloEscopo(escolhido, client))
                    .setColor(Colors.Blue)
                    .setDescription(`Funções ligadas agora neste escopo:\n${linhas.join('\n') || '—'}`);
                await interaction.reply({
                    embeds: [info],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`adm:menu:${escolhido}:${interaction.user.id}`)
                            .setLabel('🔐 Abrir painel deste servidor')
                            .setStyle(ButtonStyle.Primary)
                    )],
                    flags: 64
                });
                return true;
            }

            // ── TOGGLE ────────────────────────────────────────────────────
            case 'toggle': {
                const key = interaction.values[0];
                const def = Features.get(key);
                if (!def || key === '__nada__') {
                    await interaction.reply({ content: '❌ Função desconhecida.', flags: 64 });
                    return true;
                }

                // Anti-duplo-clique: dois cliques rápidos são dois writes, e o
                // segundo "toggle" desfaz o primeiro.
                const espera = gate('admwrite', `${interaction.user.id}:${key}`);
                if (espera) {
                    await interaction.reply({ content: `⏳ Calma! Tente de novo ${espera}.`, flags: 64 });
                    return true;
                }

                const atual = await Features.ligado(key, guildId);
                const alvo = !atual;

                // Chave de rede, chave perigosa, ou QUALQUER desligamento
                // pedem confirmação. Ligar uma chave comum é reversível e o
                // estado está na tela; desligar é o que dói.
                if (def.danger || def.scope === 'global' || alvo === false) {
                    const texto =
                        `Você vai **${alvo ? 'LIGAR' : 'DESLIGAR'}** \`${def.label}\`` +
                        `${def.scope === 'global' ? ' na **rede inteira**' : ` em **${rotuloEscopo(guildId, client)}**`}. ` +
                        `${cabe(def.desc || '', 300)}` +
                        `${alvo === false && def.motivo ? `\n⚠️ **${def.motivo}**` : ''}`;
                    await interaction.showModal(modalConfirmar(guildId, interaction.user, key, alvo, texto));
                    return true;
                }

                const r = await Features.set(key, guildId, alvo, `${interaction.user.tag} (${interaction.user.id})`);
                if (!r.ok) {
                    await interaction.reply({ content: `❌ ${r.erro}`, flags: 64 });
                    return true;
                }
                await interaction.update(confirmacaoEmbed(def, r, guildId, client, interaction.user));
                return true;
            }

            case 'confirmar': {
                const key = partes[2];
                const alvo = partes[3] === 'on';
                const r = await aplicarConfirmacao(interaction, guildId, key, alvo);
                return r;
            }

            // ── PAUSA DE EMERGÊNCIA ───────────────────────────────────────
            case 'pausa': {
                const pausado = await Features.ligado('monitoramento', guildId) &&
                    (await Features.ligado('filtro_palavras', guildId)) &&
                    !(await Features.ligado('manutencao', GLOBAL_ID));
                const acaoPausa = pausado ? 'desligar' : 'religar';
                await interaction.showModal(modalConfirmar(
                    guildId, interaction.user, '__pausa__', !pausado,
                    `**Pausa de emergência: ${acaoPausa} a moderação**\n\n` +
                    `Alvo: **${rotuloEscopo(guildId, client)}**\n\n` +
                    (pausado
                        ? 'Vai desligar: filtro de xingamento, anti-spam, anti-link e IA de moderação.\n\n⚠️ **O servidor fica sem moderação até alguém religar.** O aviso ao usuário continua funcionando.'
                        : 'Vai religar: filtro de xingamento, anti-spam, anti-link e IA de moderação.\n\nCada chave volta ao valor que tinha antes da pausa.')
                ));
                return true;
            }

            case 'banir': {
                const palavras = ModerationLog.palavrasConhecidas(guildId, 20);
                if (!palavras.length) {
                    await interaction.reply({ content: '❌ Nenhuma palavra no log para banir.', flags: 64 });
                    return true;
                }
                await interaction.showModal(modalBanir(guildId, interaction.user, palavras));
                return true;
            }

            case 'banirconfirm': {
                const digitada = String(interaction.fields.getTextInputValue('palavra') || '').trim().toLowerCase();
                if (!digitada) {
                    await interaction.reply({ content: '❌ Nenhuma palavra digitada.', flags: 64 });
                    return true;
                }
                const FilterManager = require('../managers/FilterManager');
                await FilterManager.addWord(guildId, digitada);
                logInfo(`[adm] ${interaction.user.tag} baniu a palavra "${digitada}" em ${rotuloEscopo(guildId, client)}`);
                await interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setTitle('🚫 Palavra banida')
                        .setColor(Colors.Red)
                        .setDescription(`\`${digitada}\` foi adicionada à lista de palavras deste servidor.\n\nAgora ela é bloqueada em **todos** os canais, com punição imediata — não passa por contexto nem por IA.`)
                        .setFooter({ text: `Por ${interaction.user.tag}` })],
                    flags: 64
                });
                return true;
            }

            default:
                await interaction.reply({ content: '❌ Botão desconhecido.', flags: 64 }).catch(() => {});
                return true;
        }
    } catch (e) {
        logError(`[adm] erro em "${acao}": ${e.message}`);
        const msg = '❌ Erro ao processar. Nada foi alterado.';
        try {
            if (interaction.isRepliable()) await interaction.reply({ content: msg, flags: 64 });
        } catch (e2) {}
        return true;
    }
}

/**
 * Modal de confirmação.
 *
 * A ação fica no customId (não em campo oculto): quem abrir o modal já
 * passou pela autorização do botão, e o customId é conferido de novo na
 * chegada. Digitou o nome → aplica.
 */
function modalConfirmar(guildId, user, key, alvo, texto) {
    return new ModalBuilder()
        .setCustomId(`adm:confirmar:${key}:${alvo ? 'on' : 'off'}:${guildId}:${user.id}`)
        .setTitle(alvo ? 'Confirmar ligação' : 'Confirmar desligamento')
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('confirmacao')
                .setLabel(texto.slice(0, 45))
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(alvo ? 'LIGAR' : 'DESLIGAR')
                .setRequired(true)
        ));
}

function modalBanir(guildId, user, palavras) {
    return new ModalBuilder()
        .setCustomId(`adm:banirconfirm:${guildId}:${user.id}`)
        .setTitle('Banir palavra do log')
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('palavra')
                .setLabel(`Do log: ${palavras.slice(0, 3).join(', ').slice(0, 45)}`)
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(palavras[0] || 'palavra')
                .setRequired(true)
        ));
}

/** Tela inicial. Montada aqui para o `/adm` e para o botão de retorno. */
function menuInicial(client, guildId, user) {
    return embedMenu(client, guildId, user);
}

module.exports = {
    handleAdmInteraction,
    autorizado,
    podeGlobal,
    menuInicial,
    telaXingamentos,
    telaStatus,
    embedMenu
};
