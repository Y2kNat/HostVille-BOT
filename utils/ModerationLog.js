const fs = require('fs');
const path = require('path');

/**
 * ModerationLog — o histórico de xingamento.
 *
 * POR QUE ISTO EXISTE
 * Antes o bot não contava xingamento nenhum. `logModeration` (utils/logger.js)
 * escrevia um bloco colorido no console e UMA linha no arquivo de texto do dia.
 * Consequências:
 *   - Não dava para dizer qual palavra mais aparece, nem quem mais repete.
 *   - O caso `needs_review` (a IA caiu e o motor decidiu não punir) ficava só
 *     no console: some no próximo restart e nunca chega a ninguém.
 *   - O painel `/adm` só tinha `messagesDeleted`, que mistura xingamento com
 *     spam com link.
 *
 * POR QUE ARQUIVO E NÃO MONGO
 * O db.js faz deleteMany + create em toda escrita. Um log de moderação é a
 * escrita mais frequente do bot; nesse padrão cada mensagem moderate vira uma
 * operação de rede, e uma queda de rede vira perda do registro. O mesmo motivo
 * que tirou os avisos do banco — ver o comentário no topo do database/db.js e
 * o teste "[WARN] o store é um arquivo local, não o Mongo".
 *
 * O formato é o do utils/warnStore.js: escrita atômica (tmp + rename) com .bak
 * antes, ring buffer para não crescer sem fim, e nenhuma dependência de rede.
 */

const DIR = path.join(__dirname, '..', 'data');

function caminhoArquivo() {
    // Mesma convenção do warnStore: quem não for o bot grava separado.
    const custom = String(process.env.MODERATION_LOG_FILE || '').trim();
    if (custom) {
        return path.isAbsolute(custom) ? custom : path.join(DIR, custom);
    }
    return path.join(DIR, 'moderacao.json');
}

/** Tamanho do ring buffer. */
const MAX = 3000;

const DEFAULT = { registros: [] };

let cache = null;
let cacheMtime = 0;
let cacheSize = -1;
let sujo = false;
let gravando = false;
let timer = null;

function lerDisco() {
    const arquivo = caminhoArquivo();
    let st = null;
    try {
        st = fs.statSync(arquivo);
    } catch (e) {
        st = null;
    }

    // Reusa a leitura enquanto o arquivo não mudou: o log é consultado a
    // cada mensagem moderada e o disco é mais lento que a memória.
    if (cache && st && st.mtimeMs === cacheMtime && st.size === cacheSize) return cache;

    if (st) {
        try {
            const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
            cache = bruto && Array.isArray(bruto.registros) ? bruto : { ...DEFAULT, registros: [] };
            cacheMtime = st.mtimeMs;
            cacheSize = st.size;
            return cache;
        } catch (e) {
            // JSON truncado por um kill no meio do write: tenta o .bak.
            try {
                const bruto = JSON.parse(fs.readFileSync(arquivo + '.bak', 'utf8'));
                if (bruto && Array.isArray(bruto.registros)) {
                    cache = bruto;
                    cacheMtime = st.mtimeMs;
                    cacheSize = st.size;
                    return cache;
                }
            } catch (e2) { /* sem backup utilizável */ }
        }
    }

    // Sem arquivo ainda, ou sem backup: começa vazio em vez de derrubar o
    // fluxo de moderação.
    if (!cache) cache = { registros: [] };
    if (st) { cacheMtime = st.mtimeMs; cacheSize = st.size; }
    return cache;
}

/**
 * Escrita atômica, com debounce.
 *
 * Debounce porque a rajada que gera spam é a mesma que gera log: cinco
 * mensagens em um segundo seriam cinco writes de 300 KB cada. O timer é
 * `unref()` para não segurar o processo vivo.
 */
function agendar() {
    sujo = true;
    if (timer) return;
    timer = setTimeout(() => {
        timer = null;
        gravando = true;
        try {
            const arquivo = caminhoArquivo();
            const dados = { registros: cache.registros.slice(-MAX) };
            const tmp = `${arquivo}.tmp-${process.pid}`;
            fs.writeFileSync(tmp, JSON.stringify(dados));
            // .bak ANTES do rename: se o processo morrer entre os dois, o
            // .bak é o arquivo bom.
            try { fs.copyFileSync(arquivo, arquivo + '.bak'); } catch (e) { /* primeiro write */ }
            fs.renameSync(tmp, arquivo);
            try {
                const st = fs.statSync(arquivo);
                cacheMtime = st.mtimeMs;
                cacheSize = st.size;
            } catch (e) { /* ignora */ }
            sujo = false;
        } catch (e) {
            // Falha de escrita no log NÃO pode derrubar a moderação. Perder
            // registro é ruim; perder o filtro é pior.
            console.error('[ModerationLog] falha ao gravar:', e.message);
        } finally {
            gravando = false;
        }
    }, 1500);
    if (timer.unref) timer.unref();
}

/** Grava na hora. Usado no shutdown e nos testes. */
function gravarAgora() {
    if (timer) { clearTimeout(timer); timer = null; }
    sujo = false;
    try {
        const arquivo = caminhoArquivo();
        const dados = { registros: cache.registros.slice(-MAX) };
        const tmp = `${arquivo}.tmp-${process.pid}`;
        fs.writeFileSync(tmp, JSON.stringify(dados));
        try { fs.copyFileSync(arquivo, arquivo + '.bak'); } catch (e) { /* primeiro write */ }
        fs.renameSync(tmp, arquivo);
        return true;
    } catch (e) {
        console.error('[ModerationLog] falha ao gravar:', e.message);
        return false;
    }
}

class ModerationLog {

    /**
     * Registra um caso.
     *
     * @param {object} e
     * @param {string} e.guildId
     * @param {string} e.channelId
     * @param {string} e.channelName
     * @param {string} e.userId
     * @param {string} e.userTag
     * @param {string} e.palavra       termo que disparou (ou '—')
     * @param {string} e.categoria     category do motor
     * @param {string} e.severidade    critical/high/medium/low
     * @param {number} e.confianca
     * @param {string} e.via           aiStatus: quem decidiu
     * @param {string} e.acao          'punido' | 'staff' | 'review' | 'limpo'
     * @param {string} e.origem        'palavra' | 'spam' | 'link'
     */
    static registrar(e) {
        if (!e || !e.userId) return null;
        try {
            const dados = lerDisco();
            const reg = {
                ts: Date.now(),
                guildId: String(e.guildId || ''),
                channelId: String(e.channelId || ''),
                channelName: String(e.channelName || '').slice(0, 60),
                userId: String(e.userId),
                userTag: String(e.userTag || '').slice(0, 80),
                palavra: String(e.palavra || '—').slice(0, 60),
                categoria: String(e.categoria || '—').slice(0, 30),
                severidade: String(e.severidade || '—').slice(0, 12),
                confianca: typeof e.confianca === 'number' ? Math.round(e.confianca * 100) / 100 : null,
                via: String(e.via || '—').slice(0, 30),
                acao: String(e.acao || 'punido').slice(0, 12),
                origem: String(e.origem || 'palavra').slice(0, 12)
            };
            dados.registros.push(reg);
            if (dados.registros.length > MAX + 500) {
                dados.registros = dados.registros.slice(-MAX);
            }
            agendar();
            return reg;
        } catch (err) {
            console.error('[ModerationLog] falha ao registrar:', err.message);
            return null;
        }
    }

    /** Últimos N registros de um servidor (ou da rede, com guildId null). */
    static recentes(n = 20, guildId = null) {
        try {
            const dados = lerDisco();
            let lista = dados.registros;
            if (guildId) lista = lista.filter(r => r.guildId === String(guildId));
            return lista.slice(-Math.max(1, Math.min(100, n))).reverse();
        } catch (e) {
            return [];
        }
    }

    /**
     * Agregado para o embed do painel.
     * @param {string} guildId  null = rede inteira
     * @param {number} janelaMs 0 = tudo que está no buffer
     */
    static resumo(guildId = null, janelaMs = 0) {
        try {
            const dados = lerDisco();
            const desde = janelaMs > 0 ? Date.now() - janelaMs : 0;
            const base = dados.registros.filter(r =>
                r.ts >= desde && (!guildId || r.guildId === String(guildId)));

            const palavras = new Map();
            const infratores = new Map();
            const severidade = new Map();
            const origem = new Map();
            const canais = new Map();

            let punidos = 0, staff = 0, review = 0, deletes = 0;

            for (const r of base) {
                const chavePalavra = (r.palavra || '—').toLowerCase();
                palavras.set(chavePalavra, (palavras.get(chavePalavra) || 0) + 1);
                infratores.set(r.userTag || r.userId, (infratores.get(r.userTag || r.userId) || 0) + 1);
                severidade.set(r.severidade, (severidade.get(r.severidade) || 0) + 1);
                origem.set(r.origem, (origem.get(r.origem) || 0) + 1);
                const chaveCanal = r.channelName || r.channelId || '—';
                canais.set(chaveCanal, (canais.get(chaveCanal) || 0) + 1);

                if (r.acao === 'punido') { punidos++; deletes++; }
                else if (r.acao === 'staff') staff++;
                else if (r.acao === 'review') review++;
            }

            const topo = (m, n) => [...m.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, n || 5)
                .map(([k, v]) => ({ chave: k, total: v }));

            return {
                total: base.length,
                punidos,
                staff,
                review,
                deletes,
                palavras: topo(palavras, 8),
                infratores: topo(infratores, 5),
                severidade: topo(severidade, 5),
                origem: topo(origem, 5),
                canais: topo(canais, 5),
                bufferTotal: dados.registros.length,
                janelaMs
            };
        } catch (e) {
            return {
                total: 0, punidos: 0, staff: 0, review: 0, deletes: 0,
                palavras: [], infratores: [], severidade: [], origem: [], canais: [],
                bufferTotal: 0, janelaMs
            };
        }
    }

    /** Só as palavras, para o toggle "banir palavra direto da tela". */
    static palavrasConhecidas(guildId = null, limite = 100) {
        const s = this.resumo(guildId, 0);
        return s.palavras
            .filter(p => p.chave && p.chave !== '—')
            .slice(0, limite)
            .map(p => p.chave);
    }

    static zerar() {
        cache = { registros: [] };
        cacheMtime = 0;
        cacheSize = -1;
        gravarAgora();
        return true;
    }

    /** Estado interno, para o smoke test do ready. */
    static diagnostico() {
        try {
            const dados = lerDisco();
            return { arquivo: caminhoArquivo(), registros: dados.registros.length, gravando, sujo };
        } catch (e) {
            return { arquivo: caminhoArquivo(), registros: 0, erro: e.message };
        }
    }

    static gravarAgora() {
        return gravarAgora();
    }
}

module.exports = ModerationLog;
