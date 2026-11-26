/**
 * Arquivamento de tickets em PDF.
 *
 * Guarda as mensagens em disco (JSONL) no momento em que chegam, porque o
 * evento channelDelete dispara DEPOIS da exclusao do canal: quando ele chega,
 * ja nao e mais possivel ler o historico pelo Discord.
 */
const fs = require('fs');
const path = require('path');
const { PdfBuilder, CORES, decodePng } = require('./PdfBuilder');
const { MessageFlags } = require('discord.js');

const DATA_DIR = path.join(__dirname, '..', 'data', 'transcripts');
const OUT_DIR = path.join(__dirname, '..', 'transcripts');

/** channelId -> [{ t, author, authorId, bot, content, embeds, attachments }] */
const buffers = new Map();
/** channelId -> Map(messageId -> indice no buffer), para editar mensagens */
const indice = new Map();
const MAX_MESSAGES = 3000;
const PENSANDO = /^\s*-?#?\s*pensando\b/i;

function ensure(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function jsonlPath(channelId) {
    return path.join(DATA_DIR, `${channelId}.jsonl`);
}

/** Extrai o conteudo textual dos embeds, para o PDF. */
function embedsToText(embeds) {
    const out = [];
    // aceita array puro, Collection do discord.js ou indefinido
    let lista = embeds;
    if (lista && typeof lista.values === 'function' && typeof lista !== 'string') {
        lista = Array.from(lista.values());
    }
    if (!Array.isArray(lista)) lista = lista ? [lista] : [];

    for (const e of lista) {
        if (!e) continue;
        // separador: permite reconstruir um cartao por embed
        const partes = [{ tipo: 'sep' }];
        if (e.title) partes.push({ tipo: 'titulo', texto: String(e.title), cor: e.color });
        if (e.author?.name) partes.push({ tipo: 'autor', texto: String(e.author.name) });
        if (e.description) partes.push({ tipo: 'descricao', texto: String(e.description) });
        for (const f of e.fields || []) {
            partes.push({ tipo: 'campo', texto: `${f.name}\n${f.value}` });
        }
        if (e.footer?.text) partes.push({ tipo: 'rodape', texto: String(e.footer.text) });
        out.push(...partes);
    }
    return out;
}

/** Paleta de avatares: cor estavel por autor, derivada do id. */
const AVATAR_CORES = [
    '#5865F2', '#3BA55C', '#FAA81A', '#EB459E', '#9B59B6',
    '#1ABC9C', '#E67E22', '#3498DB', '#E74C3C', '#16A085',
    '#8E44AD', '#D35400', '#2980B9', '#27AE60', '#C0392B',
];

function corAvatar(seed) {
    const s = String(seed || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AVATAR_CORES[h % AVATAR_CORES.length];
}

/** Remove caracteres decorativos (emoji, simbolos matematicos) do nome. */
function limparNome(tag) {
    const base = String(tag)
        .replace(/#\d{4}$/, '')                 // remove o discriminador do Discord
        .normalize('NFKC')                        // Ｍｏｎ -> Mon
        .replace(/[\u3010-\u3011\u300C-\u300F]/g, '')
        .replace(SEM_GLYFO, '')
        .replace(/\s+/g, ' ')
        .trim();
    return base || String(tag).replace(/#\d{4}$/, '').trim();
}

/**
 * Remove caracteres que a fonte do PDF nao possui (emoji, simbolos matematicos
 * e pictograficos), evitando os "?" e o espacamento irregular.
 */
/** Converte a cor numerica do embed (int) em hex, com fallback blurple. */
function corEmbed(valor) {
    if (typeof valor !== 'number' || !valor) return '#5865F2';
    return '#' + (valor & 0xFFFFFF).toString(16).padStart(6, '0').toUpperCase();
}

/**
 * Caracteres que a DejaVu Sans nao possui. Sem este filtro eles viram
 * quadradinhos vazios no PDF.
 */
const SEM_GLYFO = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{20E3}\u{E0020}-\u{E007F}\u{1D000}-\u{1DFFF}\u{2E80}-\u{9FFF}\u{AC00}-\u{D7AF}\u{FFFD}\u{2000}-\u{206F}\u{2E00}-\u{2E7F}\u{0300}-\u{036F}\u{FEFF}]/gu;

/** Remove espacos decorativos e normaliza fullwidth -> ASCII. */
function limparParaPdf(texto) {
    let t = String(texto)
        .normalize('NFKC')                 // Ｍｏｎ -> Mon
        .replace(/[\u3010-\u3011\u300C-\u300F\uFF08-\uFF0F]/g, '')  // parenteses CJK
        .replace(SEM_GLYFO, '')            // emoji, matematicos, CJK
        .replace(/\s+/g, ' ')
        .trim();
    return t;
}

/** Baixa uma imagem e devolve o Buffer, ou null em caso de falha. */
async function baixa(url) {
    if (!url) return null;
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(url, { signal: ctrl.signal });
        clearTimeout(t);
        if (!r.ok) return null;
        const buf = Buffer.from(await r.arrayBuffer());
        return buf.length > 0 && buf.length < 6 * 1024 * 1024 ? buf : null;
    } catch (e) {
        return null;
    }
}

/** Normaliza a lista de embeds da mensagem em objetos simples. */
function montarListaEmbeds(embeds) {
    let lista = embeds;
    if (lista && typeof lista.values === 'function') lista = Array.from(lista.values());
    if (!Array.isArray(lista)) lista = lista ? [lista] : [];
    return lista.filter(Boolean).map(e => ({
        titulo: e.title ? String(e.title) : null,
        cor: e.color || null,
        autor: e.author?.name ? String(e.author.name) : null,
        descricao: e.description ? String(e.description) : null,
        campos: (e.fields || []).map(f => ({ k: String(f.name), v: String(f.value) })),
        rodape: e.footer?.text ? String(e.footer.text) : null,
        imagem: /^https?:\/\//.test(e.image?.url || '') ? e.image.url
            : (/^https?:\/\//.test(e.thumbnail?.url || '') ? e.thumbnail.url : null),
    }));
}

/**
 * Converte a lista estruturada de embeds da mensagem em cartoes do
 * protótipo. Cada embed vira um cartao independente.
 */
function cartoesDeEmbed(lista) {
    if (!Array.isArray(lista) || !lista.length) return [];
    const saida = [];

    for (const e of lista) {
        const cartao = {
            accent: corEmbed(e.cor) || undefined,
            autor: e.autor ? limparParaPdf(e.autor) : null,
            titulo: e.titulo ? limparParaPdf(e.titulo) : null,
            descricao: e.descricao ? limparParaPdf(e.descricao) : null,
            campos: (e.campos || []).map(f => ({ k: limparParaPdf(f.k), v: limparParaPdf(f.v) })),
            rodape: e.rodape ? limparParaPdf(e.rodape) : null,
        };
        // so vale se tiver conteudo
        if (cartao.titulo || cartao.descricao || cartao.campos.length || cartao.rodape) {
            saida.push(cartao);
        }
    }
    return saida;
}

class TranscriptArchive {
    /** guildId -> boolean (cache em memoria, evita ir ao banco a cada mensagem) */
    static _enabled = new Map();

    /** Consulta (e cache) se as transcricoes estao ligadas no servidor. */
    static async isEnabled(guildId) {
        if (!guildId) return true;
        // Chave `transcript` do /adm. Vem ANTES do cache: o toggle precisa
        // valer na hora, e o cache desta função só expira depois de um TTL.
        try {
            const Features = require('../managers/FeatureRegistry');
            if (!Features.ligadoSync('transcript', guildId)) return false;
        } catch (e) { /* registry indisponível: mantém o comportamento */ }
        if (this._enabled.has(String(guildId))) return this._enabled.get(String(guildId));
        try {
            const db = require('../database/db');
            const cfg = await db.getTranscriptSettings(guildId);
            const on = cfg.enabled !== false;
            this._enabled.set(String(guildId), on);
            return on;
        } catch (e) {
            return true; // falha de banco nunca deve impedir a gravacao
        }
    }

    /** Invalida o cache (usado pelo /transcript). */
    static invalidate(guildId) {
        if (guildId === undefined) this._enabled.clear();
        else this._enabled.delete(String(guildId));
    }

    /**
     * Checagem sincrona usada no record().
     * Se ainda nao ha cache, assume ligado (gravar e o comportamento seguro:
     * perder a transcricao e pior que gravar a mais).
     */
    static _enabledNow(message) {
        const gid = message.guildId || message.guild?.id;
        if (!gid) return true;
        const cached = this._enabled.get(String(gid));
        if (cached !== undefined) return cached;
        // dispara a carga assincrona; enquanto isso, grava
        this.isEnabled(gid).catch(() => {});
        return true;
    }

    /**
     * Registra uma mensagem do canal de ticket.
     * @param {object} message  Message do discord.js
     * @param {object} [opcoes] { forcar: true } ignora a config do servidor
     */
    static record(message, { forcar = false } = {}) {
        if (!message || !message.channelId) return;
        try {
            const ephemeral = message.flags && typeof message.flags.has === 'function'
                ? message.flags.has(MessageFlags.Ephemeral)
                : ((message.flags || 0) & MessageFlags.Ephemeral) === MessageFlags.Ephemeral;
            if (ephemeral) return;
        } catch (e) {}
        const id = message.channelId;

        // respeita a config do servidor (evita gravar quando esta desligado)
        if (!forcar && !this._enabledNow(message)) return;

        if (!buffers.has(id)) {
            buffers.set(id, []);
            // recupera o que ja estava salvo antes (ex.: reinicio do bot)
            try {
                if (fs.existsSync(jsonlPath(id))) {
                    const lines = fs.readFileSync(jsonlPath(id), 'utf8').split('\n').filter(Boolean);
                    for (const l of lines) {
                        try { buffers.get(id).push(JSON.parse(l)); } catch (e) {}
                    }
                }
            } catch (e) {}
        }

        const list = buffers.get(id);
        if (list.length >= MAX_MESSAGES) return;

        let anexos = [];
        if (message.attachments) {
            if (typeof message.attachments.values === 'function') {
                anexos = Array.from(message.attachments.values());
            } else if (Array.isArray(message.attachments)) {
                anexos = message.attachments;
            } else {
                anexos = [message.attachments];
            }
        }

        // avatar real (PNG) e midia dos embeds, para o PDF
        let avatarUrl = null;
        try {
            avatarUrl = message.author?.displayAvatarURL
                ? message.author.displayAvatarURL({ extension: 'png', size: 128 })
                : null;
        } catch (e) {}

        let embedsImgs = [];
        try {
            for (const e of (Array.isArray(message.embeds) ? message.embeds : Array.from((message.embeds?.values?.() || [])))) {
                const u = e.image?.url || e.thumbnail?.url || null;
                if (u && /^https?:\/\//.test(u)) embedsImgs.push(u);
            }
        } catch (e) {}
        embedsImgs = embedsImgs.slice(0, 3);

        const entry = {
            t: message.createdTimestamp,
            author: message.author?.tag || message.author?.username || 'desconhecido',
            authorId: message.author?.id || '',
            bot: !!message.author?.bot,
            content: message.content || '',
            embeds: embedsToText(message.embeds),
            embedsRaw: montarListaEmbeds(message.embeds),
            attachments: anexos.map(a => a?.name).filter(Boolean).slice(0, 5),
            avatarUrl,
            embedsImgs,
            messageId: message.id || null,
        };

        // evita duplicar a mesma mensagem
        if (list.length && list[list.length - 1].t === entry.t && list[list.length - 1].content === entry.content) return;

        if (entry.messageId) {
            if (!indice.has(id)) indice.set(id, new Map());
            indice.get(id).set(entry.messageId, list.length);
        }

        list.push(entry);
        this._append(id, entry);
    }

    /**
     * Substitui uma mensagem ja arquivada (quando o bot EDITA a mensagem
     * "Pensando..." com a resposta final).
     * Sem isso a transcricao ficava so com o placeholder.
     */
    static update(message, { forcar = false } = {}) {
        if (!message || !message.channelId || !message.id) return false;
        try {
            const ephemeral = message.flags && typeof message.flags.has === 'function'
                ? message.flags.has(MessageFlags.Ephemeral)
                : ((message.flags || 0) & MessageFlags.Ephemeral) === MessageFlags.Ephemeral;
            if (ephemeral) return false;
        } catch (e) {}
        const id = message.channelId;

        if (!forcar && !this._enabledNow(message)) return false;

        const lista = buffers.get(id);
        if (!lista || !lista.length) return false;

        const pos = indice.get(id)?.get(message.id);
        const alvo = pos !== undefined ? lista[pos] : null;
        if (!alvo) return false;

        const novoConteudo = message.content || '';
        const novosEmbeds = montarListaEmbeds(message.embeds);
        let mudou = false;

        // o placeholder "Pensando..." nao deve sobrar no arquivo; permite limpar
        // conteudo (inclusive deixar vazio) quando a mensagem foi editada
        if (novoConteudo !== alvo.content) {
            alvo.content = novoConteudo;
            mudou = true;
        }
        if (novosEmbeds.length && !alvo.embedsRaw?.length) {
            alvo.embedsRaw = novosEmbeds;
            mudou = true;
        }
        if (!alvo.avatarUrl) {
            try {
                alvo.avatarUrl = message.author?.displayAvatarURL
                    ? message.author.displayAvatarURL({ extension: 'png', size: 128 })
                    : null;
                if (alvo.avatarUrl) mudou = true;
            } catch (e) {}
        }

        if (!mudou) return false;

        // reescreve o jsonl inteiro: o arquivo e pequeno e fica consistente
        this._rewrite(id, lista);
        return true;
    }

    /** Reescreve o arquivo de uma canal com o conteudo atual do buffer. */
    static _rewrite(channelId, lista) {
        try {
            ensure(DATA_DIR);
            const linhas = lista.map(m => JSON.stringify(m)).join('\n');
            fs.writeFileSync(jsonlPath(channelId), linhas + (linhas ? '\n' : ''));
        } catch (e) {}
    }

    static _append(channelId, entry) {
        try {
            ensure(DATA_DIR);
            fs.appendFileSync(jsonlPath(channelId), JSON.stringify(entry) + '\n');
        } catch (e) {}
    }

    /**
     * Gera o resumo do atendimento (problema + solução) usando a IA.
     * Em caso de falha, devolve um resumo determinístico a partir das mensagens.
     */
    /**
     * Gera o resumo do atendimento.
     * Usa o modelo do gateway Kilo; se falhar, cai no heuristico.
     */
    static async resumir(channelId, { maxChars = 8000, guildId = null } = {}) {
        const msgs = this.get(channelId);
        if (!msgs.length) return null;

        // Chave `transcript_ia` do /adm. Desligada, o PDF sai sem resumo de
        // IA — que é o que se quer em servidor grande: o resumo custa uma
        // chamada de modelo por ticket fechado.
        if (guildId) {
            try {
                const Features = require('../managers/FeatureRegistry');
                if (!Features.ligadoSync('transcript_ia', guildId)) {
                    return this.resumoHeuristico(msgs);
                }
            } catch (e) { /* registry indisponível: mantém o comportamento */ }
        }

        // monta a transcricao em texto, como o modelo vai ler
        const linhas = [];
        for (const m of msgs) {
            // ignora placeholder "Pensando..." no texto, mas mantem embeds/anexos
            let conteudoMsg = m.content || '';
            if (m.bot && PENSANDO.test(conteudoMsg)) conteudoMsg = '';
            if (!conteudoMsg && !(m.embedsRaw || []).length && !(m.attachments || []).length) continue;

            const quando = new Date(m.t).toLocaleString('pt-BR', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            });
            const quem = limparNome(m.author) + (m.bot ? ' (bot)' : '');
            const partes = [`[${quando}] ${quem}:`];

            if (conteudoMsg) partes.push(conteudoMsg);

            for (const e of m.embedsRaw || []) {
                const pedacos = [];
                if (e.titulo) pedacos.push(e.titulo);
                if (e.descricao) pedacos.push(e.descricao);
                for (const f of e.campos || []) pedacos.push(`${f.k}: ${String(f.v).replace(/\n/g, ' ')}`);
                if (e.rodape) pedacos.push(e.rodape);
                if (pedacos.length) partes.push(`[EMBED] ${pedacos.join(' | ')}`);
            }

            for (const a of m.attachments || []) partes.push(`[ANEXO] ${a}`);

            linhas.push(partes.join(' ').slice(0, 500));
            if (linhas.join('\n').length > maxChars) break;
        }

        const transcricao = linhas.join('\n').slice(0, maxChars);
        if (!transcricao.trim()) return this.resumoHeuristico(msgs);

        try {
            const { ResumoIA } = require('./ResumoIA');
            const r = await ResumoIA.gerar(transcricao);
            if (r && r.problema) {
                return {
                    problema: limparParaPdf(r.problema).slice(0, 400),
                    solucao: limparParaPdf(r.solucao).slice(0, 400),
                };
            }
        } catch (e) {
            console.error('Resumo IA falhou:', e.message);
        }

        return this.resumoHeuristico(msgs);
    }

    static resumoHeuristico(msgs) {
        const comTexto = msgs.filter(m => {
            const c = (m.bot && PENSANDO.test(m.content || '')) ? '' : (m.content || '');
            return c.trim().length > 3;
        });
        const primeira = comTexto[0];
        const ultima = comTexto[comTexto.length - 1];
        const corta = (s, n) => {
            const t = limparParaPdf(s);
            return t.length > n ? t.slice(0, n - 1).trim() + '…' : t;
        };
        return {
            problema: primeira ? corta(primeira.content, 160) : 'Não registrado na transcrição',
            solucao: ultima ? corta(ultima.content, 160) : 'Não registrado na transcrição',
        };
    }

    static get(channelId) {
        if (buffers.has(channelId)) return buffers.get(channelId);
        // carrega do disco se o buffer não estiver em memória (ex.: bot reiniciado)
        try {
            if (fs.existsSync(jsonlPath(channelId))) {
                const list = [];
                const lines = fs.readFileSync(jsonlPath(channelId), 'utf8').split('\n').filter(Boolean);
                for (const l of lines) {
                    try { list.push(JSON.parse(l)); } catch (e) {}
                }
                buffers.set(channelId, list);
                return list;
            }
        } catch (e) {}
        return [];
    }

    static count(channelId) {
        return this.get(channelId).length;
    }

    /**
     * Gera o PDF. Retorna { path, filename, buffer, stats } ou null.
     * @param {object} ticket  { number, category, userId, userTag, channelName }
     * @param {string} motivo
     * @param {string} closedBy
     */
    /**
     * Gera a transcricao em HTML: visual identico ao prototipo e com
     * avatores/imagens reais pelo CDN do Discord (o PDF nao consegue).
     */
    static buildHtml(channelId, ticket, opts = {}) {
        const msgs = this.get(channelId);
        if (!msgs.length) return null;

        const { buildHtml: gerar } = require('./TranscriptHtml');
        const num = String(ticket?.number ?? 0).padStart(4, '0');

        // mapa id -> nome, para as mencoes <@id> mostrarem quem e quem
        const mencoes = {};
        for (const m of msgs) {
            if (m.authorId && m.author) {
                mencoes[m.authorId] = String(m.author).replace(/#\d{4}$/, '');
            }
        }
        const html = gerar(msgs, {
            number: ticket?.number,
            category: ticket?.category,
            userId: ticket?.userId,
            userTag: ticket?.userTag,
            channelName: ticket?.channelName,
            channelId: ticket?.channelId,
            guildId: ticket?.guildId,
            mencoes,
        }, { ...opts, client: global.client });

        const filename = `ticket-${num}-${Date.now()}.html`;
        ensure(OUT_DIR);
        const filepath = path.join(OUT_DIR, filename);
        fs.writeFileSync(filepath, html, 'utf8');

        // a contagem e destaff: mensagens do bot nao contam
        const porAutor = new Map();
        for (const m of msgs) {
            if (m.bot) continue;
            const chave = m.authorId || m.author;
            const atual = porAutor.get(chave) || { count: 0, tag: m.author, authorId: m.authorId, bot: false };
            atual.count++;
            porAutor.set(chave, atual);
        }

        this.cleanup(channelId);
        return { path: filepath, filename, content: html, stats: { total: msgs.length, porAutor } };
    }

    static async buildPdf(channelId, ticket, { motivo = 'Não informado', closedBy = '—', closedById = null, openedAt = null, servidor = null, resumo = null } = {}) {
        const msgs = this.get(channelId);
        if (!msgs.length) return null;

        const num = String(ticket?.number ?? 0).padStart(4, '0');
        const dataAbertura = openedAt ? new Date(openedAt) : new Date(msgs[0].t);
        const dataEncerramento = new Date(msgs[msgs.length - 1].t);
        const fmt = d => d.toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        });

        const b = new PdfBuilder();

        /* ---------- cabecalho do canal ---------- */
        b.channelHead(ticket?.channelName || `ticket-${num}`, 'Transcrição');

        /* ---------- cabecalho do ticket ---------- */
        b.ticketPin({
            titulo: 'Ticket Aberto',
            numero: `#${num}`,
            meta: [
                { k: 'Nome do Ticket', v: ticket?.channelName || `ticket-${num}`, link: !!ticket?.channelId },
                { k: 'Criado Por', v: ticket?.userTag || ticket?.userId || '—' },
                { k: 'Data de Abertura', v: fmt(dataAbertura) },
                { k: 'Categoria', v: ticket?.category || '—' },
                { k: 'Fechado Por', v: closedBy },
                { k: 'Data de Encerramento', v: fmt(dataEncerramento) },
            ],
            resumo: resumo ? {
                problema: resumo.problema || 'Não registrado na transcrição',
                solucao: resumo.solucao || 'Não registrado na transcrição',
            } : null,
        });

        /* ---------- mensagens ---------- */
        // agrupa mensagens consecutivas do mesmo autor, como no Discord
        const grupos = [];
        for (const m of msgs) {
            const ultimo = grupos[grupos.length - 1];
            if (ultimo && ultimo.authorId === m.authorId) {
                ultimo.msgs.push(m);
            } else {
                grupos.push({
                    autor: m.author, authorId: m.authorId, bot: m.bot,
                    avatarUrl: m.avatarUrl, msgs: [m],
                });
            }
        }

        let ultimoDia = null;
        for (const g of grupos) {
            const dia = new Date(g.msgs[0].t)
                .toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

            if (dia !== ultimoDia) {
                b.dayDivider(dia);
                ultimoDia = dia;
            }

            if (g.avatarUrl && !g.avatarPng) g.avatarPng = await baixa(g.avatarUrl);

            const children = [];
            for (const m of g.msgs) {
                const conteudo = limparParaPdf(m.content);
                if (conteudo) children.push({ tipo: 'texto', texto: conteudo });

                // imagem do embed: bloco proprio (embed--image do prototipo)
                for (const url of (m.embedsImgs || [])) {
                    const png = await baixa(url);
                    if (!png) continue;
                    let ratio = 0.5625;
                    try { const d = decodePng(png); ratio = d.height / d.width; } catch (e) {}
                    children.push({
                        tipo: 'embedImagem', png, ratio,
                        legenda: url.split('/').pop().split('?')[0],
                        accent: CORES.green,
                    });
                }

                for (const a of m.attachments) {
                    children.push({ tipo: 'anexo', nome: a, tamanho: '' });
                }

                // um cartao por embed desta mensagem
                for (const c of cartoesDeEmbed(m.embedsRaw || [])) {
                    children.push({ tipo: 'embed', ...c });
                }
            }

            b.messageGroup({
                autor: limparNome(g.autor),
                hora: new Date(g.msgs[0].t).toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit', year: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                }),
                avatarColor: corAvatar(g.authorId || g.autor),
                avatarPng: g.avatarPng || null,
                bot: g.bot,
                children,
            });
        }

        const filename = `ticket-${num}-${Date.now()}.pdf`;
        ensure(OUT_DIR);
        const filepath = path.join(OUT_DIR, filename);
        b.foot('Documento gerado automaticamente pelo HostVille • BOT');

        const buffer = b.build({
            title: `Transcrição do Ticket #${num}`,
            subject: `Ticket #${num} — ${ticket?.category || ''}`,
        });
        fs.writeFileSync(filepath, buffer);

        // contagem por autor (staff x usuario)
        // a contagem e destaff: mensagens do bot nao contam
        const porAutor = new Map();
        for (const m of msgs) {
            if (m.bot) continue;
            const chave = m.authorId || m.author;
            const atual = porAutor.get(chave) || { count: 0, tag: m.author, authorId: m.authorId, bot: false };
            atual.count++;
            porAutor.set(chave, atual);
        }

        this.cleanup(channelId);

        return {
            path: filepath,
            filename,
            buffer,
            stats: { total: msgs.length, porAutor, pdfPaginas: b.pageCount },
        };
    }

    /** Remove o buffer e o jsonl apos gerar o PDF. */
    static cleanup(channelId) {
        buffers.delete(channelId);
        indice.delete(channelId);
        try { fs.unlinkSync(jsonlPath(channelId)); } catch (e) {}
    }

    static has(channelId) {
        return (buffers.get(channelId)?.length || 0) > 0;
    }
}

module.exports = { TranscriptArchive, DATA_DIR, OUT_DIR };
