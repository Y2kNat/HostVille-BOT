/**
 * Gera a transcricao do ticket em HTML, usando exatamente o CSS do
 * prototipo (assets/transcricao.css).
 *
 * Vantagem sobre o PDF: avatares e imagens de embed entram pelo CDN do
 * Discord, entao aparecem de verdade. O arquivo e autocontido (CSS inline).
 */
const fs = require('fs');
const path = require('path');

const CSS_PATH = path.join(__dirname, '..', 'assets', 'transcricao.css');
let _css = null;
function css() {
    if (_css === null) _css = fs.readFileSync(CSS_PATH, 'utf8');
    return _css;
}

/** Escapa texto para HTML. O conte vem de usuarios: nao pode entrar cru. */
function esc(t) {
    return String(t ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Mapas id -> nome, preenchidos pelo gerador. */
let MAPA_MENCAO = null;
let CARGOS = null;

/** Preenche os mapas a partir do client (nomes de usuario e de cargo). */
function setClient(client) {
    MAPA_MENCAO = {};
    CARGOS = {};
    if (!client) return;
    for (const u of client.users?.cache?.values?.() || []) {
        if (u.username) MAPA_MENCAO[u.id] = u.username;
    }
    for (const g of client.guilds?.cache?.values?.() || []) {
        for (const r of g.roles?.cache?.values?.() || []) {
            if (r.name) CARGOS[r.id] = r.name;
        }
    }
}

/** Escapa e transforma mencoes, @aqui e `codigo` em elementos do Discord. */
function rich(t) {
    let s = esc(t);
    // <@123>, <@&123>, @everyone, @here
    // mencoes por id viram @everyone; com mapa, viram o nome real
    s = s.replace(/&lt;@!?(\d+)&gt;/g, (_, id) => {
        const nome = MAPA_MENCAO && MAPA_MENCAO[id];
        return `<span class="mention">@${esc(nome || 'usuário')}</span>`;
    });
    s = s.replace(/&lt;@&amp;(\d+)&gt;/g, (_, id) => {
        const nome = CARGOS && CARGOS[id];
        return `<span class="mention">@${esc(nome || 'cargo')}</span>`;
    });
    s = s.replace(/@(everyone|here)/g, '<span class="mention">@$1</span>');
    // mencao por nome: @palavra (nao pode ser dentro de codigo)
    s = s.replace(/(^|[\s(])@([A-Za-z0-9_.\-[\]]{2,32})/g, '$1<span class="mention">@$2</span>');
    // codigo inline
    s = s.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);
    return s;
}

const EMOJI_TICKET = {
    denuncias: '🚨', denuncia: '🚨', suporte: '🛠️', duvidas: '❓',
    duvida: '❓', atendimento: '🎧', registro: '📝',
};

const AVATAR_CORES = [
    '#5865F2', '#3BA55C', '#FAA81A', '#EB459E', '#9B59B6',
    '#1ABC9C', '#E67E22', '#3498DB', '#E74C3C', '#16A085',
];

function corAvatar(seed) {
    const s = String(seed || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AVATAR_CORES[h % AVATAR_CORES.length];
}

function iniciais(nome) {
    const limpo = String(nome || '').replace(/^[^a-zA-Z0-9À-￿]+/, '').slice(0, 2);
    return (limpo || '?').toUpperCase();
}

const fmtData = d => new Date(d).toLocaleString('pt-BR', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/** Bloco de um embed, no formato do prototipo. */
function renderEmbed(e) {
    const accent = e.cor ? '#' + (e.cor & 0xFFFFFF).toString(16).padStart(6, '0') : '#5865F2';
    const partes = [];

    if (e.autor) {
        partes.push(`<div class="embed__author"><span class="dot" style="background:${esc(accent)}"></span>`
            + `<span class="nm">${esc(e.autor)}</span></div>`);
    }
    if (e.titulo) partes.push(`<div class="embed__title">${rich(e.titulo)}</div>`);
    if (e.descricao) partes.push(`<div class="embed__desc">${rich(e.descricao)}</div>`);

    if (e.campos && e.campos.length) {
        const campos = e.campos
            .map(f => `<div class="embed__field"><div class="k">${rich(f.k)}</div>`
                + `<div class="v">${rich(f.v)}</div></div>`)
            .join('');
        partes.push(`<div class="embed__fields">${campos}</div>`);
    }

    if (e.rodape) partes.push(`<div class="embed__footer">${esc(e.rodape)}</div>`);

    // embed so com imagem: variante .embed--image do prototipo
    if (e.imagem && !e.titulo && !e.descricao && !(e.campos && e.campos.length)) {
        const nome = String(e.imagem).split('/').pop().split('?')[0];
        return `<div class="embed embed--image" style="--embed-accent:${esc(accent)}">`
            + `<img class="embed__img" src="${esc(e.imagem)}" alt="${esc(nome)}" loading="lazy">`
            + `<div class="embed__cap">${esc(nome)}</div></div>`;
    }

    return `<div class="embed" style="--embed-accent:${esc(accent)}">${partes.join('')}</div>`;
}

function renderAnexo(nome) {
    return `<a class="attachment" href="#"><span class="ico">📄</span><span>${esc(nome)}</span></a>`;
}

/**
 * @param {Array}  msgs     mensagens ja normalizadas
 * @param {object} ticket   { number, category, userTag, userId, channelName, channelId, guildId }
 * @param {object} opts     { motivo, closedBy, closedById, openedAt, endedAt, servidor, resumo }
 * @returns {string} HTML completo
 */
/** Placeholder de "pensando" que o bot manda e deveria editar depois. */
const PENSANDO = /^\s*-?#?\s*pensando\b/i;

function buildHtml(msgs, ticket = {}, opts = {}) {
    // Se o bot mandou "Pensando..." e a resposta veio numa mensagem separada
    // (a edicao falhou), o placeholder so polui a transcricao. Ele fica
    // de fora quando existe resposta logo em seguida do mesmo bot.
    const limpo = [];
    for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        const ePlaceholder = m.bot && PENSANDO.test(m.content || '');
        if (ePlaceholder) {
            const proximo = msgs[i + 1];
            if (proximo && proximo.bot && proximo.authorId === m.authorId) {
                const idxProx = limpo.findIndex(x => x.messageId === proximo.messageId);
                if (idxProx >= 0) limpio.splice(idxProx, 1);
            } else if (!proximo || proximo.authorId !== m.authorId) {
                // placeholder sem resposta nenhuma: descarta
                continue;
            }
        }
        limpo.push(m);
    }
    msgs = limpo;

    const num = String(ticket.number ?? 0).padStart(4, '0');
    // nomes reais de usuario e cargo, para as mencoes sairem legiveis
    setClient(opts.client);
    MAPA_MENCAO = { ...MAPA_MENCAO, ...(ticket.mencoes || {}) };
    const canal = ticket.channelName || `ticket-${num}`;
    const aberto = opts.openedAt ? new Date(opts.openedAt) : new Date(msgs[0]?.t || Date.now());
    const fechado = opts.endedAt ? new Date(opts.endedAt) : new Date(msgs[msgs.length - 1]?.t || Date.now());
    const emoji = EMOJI_TICKET[String(ticket.category || '').toLowerCase()] || '🎫';

    // agrupa mensagens consecutivas do mesmo autor
    const grupos = [];
    for (const m of msgs) {
        const ultimo = grupos[grupos.length - 1];
        if (ultimo && ultimo.authorId === m.authorId) ultimo.msgs.push(m);
        else grupos.push({ autor: m.author, authorId: m.authorId, bot: m.bot, avatarUrl: m.avatarUrl, msgs: [m] });
    }

    const corpo = [];
    let ultimoDia = null;

    for (const g of grupos) {
        const data0 = new Date(g.msgs[0].t);
        const dia = data0.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        if (dia !== ultimoDia) {
            corpo.push(`<div class="day-divider"><span>${esc(dia)}</span></div>`);
            ultimoDia = dia;
        }

        const nome = String(g.autor).replace(/#\d{4}$/, '');
        const cor = corAvatar(g.authorId || g.autor);
        const ini = iniciais(nome);
        // avatar real pelo CDN; fallback em iniciais
        const avatar = g.avatarUrl
            ? `<img alt="" src="${esc(g.avatarUrl)}" loading="lazy">`
            : esc(ini);

        // a primeira mensagem do grupo mostra o cabecalho
        const hora0 = data0.toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
        });

        const partes = [];
        partes.push(
            `<div class="msg msg--first">`
            + `<div class="msg__avatar" style="background:${esc(cor)}">${avatar}</div>`
            + `<div class="msg__body">`
            + `<div class="msg__head">`
            + `<span class="msg__name">${esc(nome)}</span>`
            + (g.bot ? `<span class="msg__bot">BOT</span>` : '')
            + `<span class="msg__time">${esc(hora0)}</span>`
            + `</div>`
        );

        g.msgs.forEach((m, i) => {
            if (i > 0) {
                partes.push(
                    `<div class="msg">`
                    + `<div class="msg__avatar">${esc(ini)}</div>`
                    + `<div class="msg__body">`
                );
            }

            if (m.content) partes.push(`<div class="msg__text">${rich(m.content)}</div>`);

            if (m.attachments && m.attachments.length) {
                partes.push(`<div class="attachments">${m.attachments.map(renderAnexo).join('')}</div>`);
            }

            for (const e of m.embedsRaw || []) partes.push(renderEmbed(e));

            partes.push(`</div></div>`);
        });

        corpo.push(partes.join(''));
    }

    const link = ticket.guildId && ticket.channelId
        ? `<a href="https://discord.com/channels/${esc(ticket.guildId)}/${esc(ticket.channelId)}">${esc(canal)}</a>`
        : esc(canal);

    const resumoHtml = opts.resumo ? (
        `<div class="summary">`
        + `<h4>Resumo do Atendimento</h4>`
        + `<p><b>Problema relatado:</b> ${rich(opts.resumo.problema || 'Não registrado na transcrição')}</p>`
        + `<p><b>Solução aplicada:</b> ${rich(opts.resumo.solucao || 'Não registrado na transcrição')}</p>`
        + `</div>`
    ) : '';

    const meta = [
        ['Nome do Ticket', link],
        ['Criado Por', ticket.userTag || (ticket.userId ? `@user` : '—')],
        ['Data de Abertura', fmtData(aberto)],
        ['Tipo de Ticket', `${emoji} ${ticket.category || 'suporte'}`],
        ['Fechado Por', opts.closedById ? `@user` : (opts.closedBy || '—')],
        ['Data de Encerramento', fmtData(fechado)],
    ];

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Transcrição — ${esc(canal)}</title>
<style>
${css()}
/* ajustes que so fazem sentido no arquivo gerado */
@media print {
  .msg:hover { background: none; }
  .app { box-shadow: none; }
  body { background: var(--chat-bg); }
}
</style>
</head>
<body>
<div class="app">

  <div class="channel-head">
    <span class="hash">#</span>
    <span class="name">${esc(canal)}</span>
    <span class="spacer"></span>
    <span class="pill">Transcrição</span>
  </div>

  <div class="ticket-pin">
    <div class="ticket-pin__title">
      <span class="ico">🎫</span>
      <span>Transcrição do Ticket</span>
      <span class="num">#${esc(num)}</span>
    </div>
    <div class="meta-grid">
${meta.map(([k, v]) => `      <div class="meta"><span class="meta__k">${esc(k)}</span>\n        <span class="meta__v">${v}</span></div>`).join('\n')}
    </div>
    ${resumoHtml}
  </div>

  <div class="chat">
${corpo.join('\n')}
  </div>

  <div class="foot">
    <span>Documento gerado automaticamente pelo HostVille • BOT</span>
  </div>

</div>
</body>
</html>
`;
}

module.exports = { buildHtml, setClient, esc, rich, renderEmbed, corAvatar, iniciais };
