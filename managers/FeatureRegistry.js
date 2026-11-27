const config = require('../config');
const db = require('../database/db');
const { logInfo, logError } = require('../utils/logger');
const { sendLog } = require('../utils/realtime');

/**
 * FeatureRegistry — o catálogo único de chaves ligáveis.
 *
 * O problema que ele resolve: cada feature do bot tinha seu próprio jeito de
 * ser desligada, espalhado por 4 comandos em 6 lugares. Anti-spam não tinha
 * jeito nenhum. A IA de moderação e o Auto-KB eram `.env`, ou seja, mudar
 * exigia restart. E nada disso aparecia junto, então "o que está ligado agora?"
 * não tinha resposta.
 *
 * Aqui toda feature é UMA linha. O `messageCreate` pergunta
 * `FeatureRegistry.ligado('anti_spam', guildId)` no ponto de corte, e o `/adm`
 * desenha a mesma lista. Uma lista só, uma fonte só.
 *
 * ESCOPO
 *   guild  — um servidor (doc `FEATURES` com guildId = id do servidor)
 *   global — a rede inteira (doc `FEATURES` com guildId = 'global')
 *
 * HERANÇA DO .env
 *   O `default` de cada chave vem de config.js, que ainda lê o `.env`.
 *   Gravar no painel NÃO apaga o `.env`: ele passa a ser o default e o doc do
 *   banco é o override. Sem essa separação, o primeiro `/adm` a tocar numa
 *   chave passaria a depender do banco — e o `.env` é o que sobrevive a rede.
 */

const GROUPS = {
    mod:     { label: '🛡️ Moderação', emoji: '🛡️' },
    ia:      { label: '🤖 Inteligência', emoji: '🤖' },
    ticket:  { label: '🎫 Tickets', emoji: '🎫' },
    sistema: { label: '⚙️ Sistema', emoji: '⚙️' }
};

function boolEnv(nome, padrao) {
    const v = process.env[nome];
    if (v === undefined || v === null || String(v).trim() === '') return padrao;
    return String(v).trim().toLowerCase() !== 'false';
}

/**
 * O catálogo. `default` é o estado ligado; `canal` explica o que a chave
 * controla, porque o painel mostra a lista sem ninguém escrevendo legenda.
 */
const FEATURES = {
    // ─── MODERAÇÃO ────────────────────────────────────────────────────────
    filtro_palavras: {
        label: 'Filtro de xingamento', group: 'mod', scope: 'guild', default: true,
        desc: 'Motor de palavras ofensivas. Por canal é ajuste fino no /filter.',
        motivo: 'Desligar aqui zera o filtro em TODOS os canais do servidor.'
    },
    ia_moderacao: {
        label: 'IA de moderação', group: 'mod', scope: 'guild', default: config.MODERATION_ENABLED,
        desc: 'Chave-mestra da moderação por IA. Ligada: toda mensagem suspeita passa pela IA; desligada: o filtro determinístico volta a punir.',
        motivo: 'Sem a IA, o filtro só acerta o obvious e o ambíguo passa.'
    },
    anti_spam: {
        label: 'Anti-spam', group: 'mod', scope: 'guild', default: true,
        desc: 'Rajada e repetição. Silencia por 60s ao estourar o limite.'
    },
    anti_link: {
        label: 'Anti-link / convites', group: 'mod', scope: 'guild', default: true,
        desc: 'Bloqueia convite de Discord. Domínios permitidos ficam no /linksettings.'
    },
    punicao_auto: {
        label: 'Punição automática', group: 'mod', scope: 'guild', default: true,
        desc: 'Escada de avisos: 10 → timeout 1h, 15 → 6h, 20 → 24h, 25 → 7 dias, 30 → 28 dias. Sem kick nem ban.',
        motivo: 'Desligar só a ESCADA. O aviso continua sendo registrado e mostrado no /warnings.'
    },
    anti_raid: {
        label: 'Anti-Raid', group: 'mod', scope: 'guild', default: config.ANTI_RAID.ENABLED,
        desc: 'Detecta e bane executor de raid: 3+ canais apagados, 3+ bans ou 3+ @everyone em 3 min.',
        motivo: 'Desligar deixa o servidor vulnerável a raids coordenados (delete/ban em massa, @everyone spam).'
    },
    honeypot: {
        label: 'Honeypot (canal-armadilha)', group: 'mod', scope: 'guild', default: config.HONEYPOT.ENABLED,
        desc: 'Canal-armadilha: quem manda mensagem nele é banido automaticamente.',
        motivo: 'Desligar desativa a armadilha anti-raid (o canal vira um canal comum).'
    },

    // ─── INTELIGÊNCIA ─────────────────────────────────────────────────────
    chat_ia: {
        label: 'Chat com IA', group: 'ia', scope: 'guild', default: true,
        desc: 'Responder quando chamam por "hvbot", apelido ou menção.',
        motivo: 'O bot vira mudo nos servidores: ticket, /private e comandos chat param de responder.'
    },
    auto_interacao: {
        label: 'Arrastar/responder o bot', group: 'ia', scope: 'guild', default: true,
        desc: 'Responder à mensagem arrastada para o lado.'
    },
    guard: {
        label: 'Guard de injeção', group: 'ia', scope: 'global', default: config.GUARD_ENABLED,
        ownerOnly: true,
        desc: 'Modelo dedicado que detecta "ignore suas instruções" na entrada do usuário.'
    },
    roast: {
        label: 'Resposta fixa ao xingamento', group: 'ia', scope: 'global',
        default: boolEnv('PROFANITY_AI_ROAST', false), ownerOnly: true,
        desc: 'Ligado: não apaga, não warna, só responde "Tô suave" quando chamado. Desligado: apaga + warn e o bot não responde o xingamento.',
        motivo: 'Antes era o contrário: ligado gerava roast por IA (custo por xingamento) e desligado dava a resposta fixa. Agora ligado = resposta fixa, desligado = moderação séria.'
    },
    autokb: {
        label: 'Auto-KB', group: 'ia', scope: 'global', default: config.AUTO_KB.ENABLED,
        ownerOnly: true,
        desc: 'Minera conversa e propõe documento novo para a base de conhecimento.'
    },

    image_analyzer: {
        label: 'Análise de imagem',
        group: 'ia',
        scope: 'guild',
        default: config.IMAGE_ANALYZER.ENABLED,
        desc: 'Lê imagem no canal configurado e responde à menção. Tradução e descrição.',
        motivo: 'Desligar aqui mantém o canal livre de resposta automática a anexo.'
    },

    // ─── TICKETS ──────────────────────────────────────────────────────────
    atendente_auto: {
        label: 'Atendente automático', group: 'ticket', scope: 'guild', default: true,
        desc: 'Responde e classifica ticket novo antes de a staff ver.'
    },
    ia_ticket: {
        label: 'IA dentro do ticket', group: 'ticket', scope: 'guild', default: true,
        desc: 'Por canal é ajuste fino no /ai-ticket.'
    },
    transcript: {
        label: 'Transcrição em PDF', group: 'ticket', scope: 'guild', default: true,
        desc: 'Gera o PDF ao fechar/deletar ticket.'
    },
    transcript_ia: {
        label: 'Resumo por IA', group: 'ticket', scope: 'guild', default: true,
        desc: 'Sumariza a transcrição. Custa uma chamada de IA por ticket fechado.'
    },
    comandos_ticket: {
        label: 'Comandos de ticket', group: 'ticket', scope: 'guild', default: true,
        desc: '/ticket, /close e /adicionar. Desligar trava quem já tem ticket aberto.'
    },

    // ─── SISTEMA ──────────────────────────────────────────────────────────
    monitoramento: {
        label: 'Monitoramento', group: 'sistema', scope: 'guild', default: true,
        desc: 'Chave-mestra do servidor. Fora dela, anti-spam e anti-link não rodam.',
        motivo: 'Desligar o monitoramento DESLIGA spam e link ao mesmo tempo, mesmo que os dois estejam marcados como ligados aqui.'
    },
    canal_estudo: {
        label: 'Canal de aprendizado', group: 'sistema', scope: 'global', default: true,
        ownerOnly: true,
        desc: 'Canal onde a staff ensina o bot por texto em linguagem natural.'
    },
    manutencao: {
        label: 'Manutenção', group: 'sistema', scope: 'global', default: false,
        ownerOnly: true, danger: true,
        desc: 'Todo canal vira um embed de aviso. Só /maintenance passa.',
        motivo: 'O bot para de atender em todos os servidores até alguém ligar de volta.'
    }
};

const KEYS = Object.keys(FEATURES);

/** Cache por escopo. `null` = ainda não lido do banco. */
const cache = new Map();
/** Domínios que dependem do cache já carregado (chamar após um set). */
const invalidators = new Map();

function escopoDe(key) {
    return FEATURES[key]?.scope === 'global' ? 'global' : 'guild';
}

/**
 * O default da chave, ou seja, o que o config.js/.env diz.
 * Sem doc no banco que contradiga, é isto que vale.
 */
function defDe(key) {
    return !!(FEATURES[key] && FEATURES[key].default);
}

class FeatureRegistry {

    /** Todas as chaves, na ordem do catálogo. */
    static keys() {
        return KEYS.slice();
    }

    static get(key) {
        return FEATURES[key] || null;
    }

    static grupo(key) {
        return FEATURES[key]?.group || 'sistema';
    }

    static labelDe(key) {
        return FEATURES[key]?.label || key;
    }

    static scopeDe(key) {
        return escopoDe(key);
    }

    static ehGlobal(key) {
        return escopoDe(key) === 'global';
    }

    /**
     * As chaves de um grupo que se aplicam a um escopo.
     *
     * `guildId === 'global'` devolve SÓ as chaves de rede. A versão anterior
     * devolvia todas, e o painel global mostrava `filtro_palavras` — que ao
     * ser alternada gravava no doc `global` enquanto o `messageCreate` lê o
     * doc do SERVIDOR. Ou seja: um botão que desenhava e não fazia nada.
     *
     * Quem quer "fazer isso em todo mundo de uma vez" tem o botão de pausa
     * de emergência, que é explícito e mostra o que vai mexer. Uma chave de
     * servidorshowndo no painel da rede seria amplitude escondida.
     *
     * @param {string} group
     * @param {string} guildId  'global' para o escopo da rede
     */
    static grupoDe(group, guildId) {
        const naRede = String(guildId) === 'global';
        return KEYS
            .filter(k => FEATURES[k].group === group)
            .filter(k => (escopoDe(k) === 'global') === naRede)
            .map(k => ({ key: k, ...FEATURES[k] }));
    }

    /** Todas as chaves visíveis num escopo. */
    static visiveis(guildId, { podeGlobal = false } = {}) {
        return KEYS
            .filter(k => escopoDe(k) !== 'global' || guildId === 'global' || podeGlobal)
            .map(k => ({ key: k, ...FEATURES[k] }));
    }

    // ── LEITURA ──────────────────────────────────────────────────────────

    /**
     * O valor efetivo de uma chave.
     *
     * Assíncrono porque o mapa vem do banco, mas com cache: o caminho quente
     * (messageCreate, a cada mensagem) não paga I/O depois do primeiro acesso.
     *
     * @param {string} key
     * @param {string} guildId  'global' lê o escopo da rede
     * @returns {Promise<boolean>}
     */
    static async ligado(key, guildId) {
        if (!FEATURES[key]) return false;
        const escopo = this.ehGlobal(key) ? 'global' : String(guildId || 'global');
        if (!cache.has(escopo)) {
            cache.set(escopo, await db.getFeatures(escopo).catch(() => ({})));
        }
        const mapa = cache.get(escopo) || {};
        return Object.prototype.hasOwnProperty.call(mapa, key) ? !!mapa[key] : defDe(key);
    }

    /**
     * Versão síncrona. Só é válida DEPOIS de `aquecer()`: sem o mapa no cache
     * devolve o default, que é o estado de quem nunca mexeu. É o que permite
     * checar no ponto de corte sem `await` em caminho quente.
     *
     * @returns {boolean}
     */
    static ligadoSync(key, guildId) {
        if (!FEATURES[key]) return false;
        const escopo = this.ehGlobal(key) ? 'global' : String(guildId || 'global');
        if (!cache.has(escopo)) return defDe(key);
        const mapa = cache.get(escopo) || {};
        return Object.prototype.hasOwnProperty.call(mapa, key) ? !!mapa[key] : defDe(key);
    }

    /** Snapshot de todas as chaves de um escopo, já resolvidas. */
    static async estado(guildId) {
        const escopo = String(guildId || 'global');
        if (!cache.has(escopo)) {
            cache.set(escopo, await db.getFeatures(escopo).catch(() => ({})));
        }
        const mapa = cache.get(escopo) || {};
        const saida = {};
        for (const k of KEYS) {
            if (this.ehGlobal(k) && escopo !== 'global') continue;
            saida[k] = Object.prototype.hasOwnProperty.call(mapa, k) ? !!mapa[k] : defDe(k);
        }
        return saida;
    }

    // ── ESCRITA ──────────────────────────────────────────────────────────

    /**
     * Liga/desliga uma chave.
     *
     * O cache é atualizado ANTES do banco. Se a gravação falhar, o valor
     * volta: é preferível o painel mostrar o estado antigo por dois segundos
     * do que mostrar "ligado" para um filtro que está desligado no disco.
     *
     * @returns {Promise<{ok:boolean, valor:boolean, erro?:string}>}
     */
    static async set(key, guildId, valor, autor) {
        const def = FEATURES[key];
        if (!def) return { ok: false, valor: false, erro: `chave desconhecida: ${key}` };

        const escopo = this.ehGlobal(key) ? 'global' : String(guildId || 'global');
        const alvo = !!valor;

        if (!cache.has(escopo)) {
            cache.set(escopo, await db.getFeatures(escopo).catch(() => ({})));
        }
        const antes = this.ligadoSync(key, escopo);
        const mapa = { ...(cache.get(escopo) || {}) };
        mapa[key] = alvo;

        const anteriorCache = cache.get(escopo);
        cache.set(escopo, mapa);
        try {
            await db.setFeatures(escopo, mapa);
        } catch (e) {
            cache.set(escopo, anteriorCache);
            logError(`[Features] falha ao gravar ${key}=${alvo} (escopo ${escopo}): ${e.message}`);
            return { ok: false, valor: antes, erro: 'banco indisponível, nada foi alterado' };
        }

        this.aplicarEfeitos(key, alvo);
        await this.auditar(key, escopo, antes, alvo, autor);
        return { ok: true, valor: alvo, antes };
    }

    /** Restaura a chave para o default do config/.env. */
    static async reset(key, guildId, autor) {
        const escopo = this.ehGlobal(key) ? 'global' : String(guildId || 'global');
        if (!cache.has(escopo)) {
            cache.set(escopo, await db.getFeatures(escopo).catch(() => ({})));
        }
        const mapa = { ...(cache.get(escopo) || {}) };
        delete mapa[key];
        const anteriorCache = cache.get(escopo);
        cache.set(escopo, mapa);
        try {
            await db.setFeatures(escopo, mapa);
        } catch (e) {
            cache.set(escopo, anteriorCache);
            return { ok: false, erro: 'banco indisponível, nada foi alterado' };
        }
        const valor = defDe(key);
        this.aplicarEfeitos(key, valor);
        await this.auditar(key, escopo, this.ligadoSync(key, escopo), valor, autor, 'reset');
        return { ok: true, valor };
    }

    /**
     * Invalida caches de fora. Registrado por chave porque cada subsistema
     * tem o seu (`FilterManager`, `TicketManager`) e acertar o momento é a
     * parte que faz a troca ser visível na hora, não em 2 minutos.
     */
    static aoMudar(key, fn) {
        const lista = invalidators.get(key) || [];
        lista.push(fn);
        invalidators.set(key, lista);
    }

    static aplicarEfeitos(key, valor) {
        for (const fn of (invalidators.get(key) || [])) {
            try { fn(valor); } catch (e) { logError(`[Features] efeito de ${key} falhou: ${e.message}`); }
        }
    }

    // ── PAUSA DE EMERGÊNCIA ──────────────────────────────────────────────

    /**
     * O que o botão "🛑 PAUSA TUDO" desliga. Lista explícita de propósito:
     * uma varredura automática sobre o catálogo cairia em manutenção e em
     * canal_estudo, que não é o que "pausar moderação" quer dizer.
     */
    static PAUSA_GUILD = ['filtro_palavras', 'anti_spam', 'anti_link', 'ia_moderacao'];
    static PAUSA_GLOBAL = ['ia_moderacao', 'autokb', 'atendente_auto'];

    // ── AQUECIMENTO ──────────────────────────────────────────────────────

    /**
     * Carrega os mapas de todos os servidores do bot. Roda no ready: sem isto
     * `ligadoSync` cai no default até a primeira escrita, e o painel mostra
     * "tudo ligado" num servidor que a staff já tinha desligado a IA.
     */
    static async aquecer() {
        try {
            cache.set('global', await db.getFeatures('global').catch(() => ({})));
            const client = global.client;
            if (client?.guilds?.cache) {
                for (const [guildId] of client.guilds.cache) {
                    cache.set(String(guildId), await db.getFeatures(String(guildId)).catch(() => ({})));
                }
            }
            logInfo(`[Features] cache aquecido: global + ${Math.max(0, cache.size - 1)} servidor(es), ${KEYS.length} chaves`);
            return true;
        } catch (e) {
            logError(`[Features] falha ao aquecer cache: ${e.message}`);
            return false;
        }
    }

    /** Recarrega um escopo do disco. Usado depois de migrate manual. */
    static async recarregar(guildId) {
        const escopo = String(guildId || 'global');
        cache.set(escopo, await db.getFeatures(escopo).catch(() => ({})));
        return cache.get(escopo);
    }

    // ── AUDITORIA ─────────────────────────────────────────────────────────

    /**
     * Toda mudança de chave fica registrada. Sem isto não existe como saber
     * quem desligou a moderação de um servidor às 3h da manhã — e o botão de
     * pausa existe justamente para ser usado em desespero.
     */
    static async auditar(key, escopo, antes, depois, autor, tipo = 'toggle') {
        const linha = `[Features] ${tipo} ${key} | escopo=${escopo} | ${antes} -> ${depois} | por ${autor || 'desconhecido'}`;
        logInfo(linha);
        const def = FEATURES[key];
        sendLog(
            `⚙️ **${def?.label || key}** ${tipo === 'reset' ? 'restaurado' : (depois ? 'LIGADO' : 'DESLIGADO')}` +
            `${escopo === 'global' ? ' (rede inteira)' : ''}\n` +
            `${antes ? '🟢 ligado' : '🔴 desligado'} → ${depois ? '🟢 ligado' : '🔴 desligado'} · por ${autor || '?'}`,
            depois ? 'success' : 'error',
            'features'
        );
        return linha;
    }

    static grupos() {
        return GROUPS;
    }
}

/**
 * Fechamento do circuito: cada chave avisa o seu dono.
 *
 * `ligadoSync` já resolve o caminho quente sozinho; o que precisa disto é
 * CACHE DE TERCEIRO. O caso real é o filtro por canal: `FilterManager`
 * guarda o mapa de canais desligados em memória, e gravar a chave sem
 * invalidar é o painel dissendo "desligado" enquanto o filtro continua
 * rodando.
 */
function registrarEfeitos() {
    const FM = require('./FilterManager');
    FeatureRegistry.aoMudar('filtro_palavras', (v) => {
        FM.refreshChannelModeration(true);
        FM.refreshCustomWords(true);
        logInfo(`[Features] filtro_palavras = ${v}; cache do FilterManager invalidado`);
    });
    FeatureRegistry.aoMudar('ia_ticket', () => {
        try { require('./TicketManager').invalidateTicketAi?.(); } catch (e) { /* módulo opcional */ }
    });
}
registrarEfeitos();

module.exports = FeatureRegistry;
