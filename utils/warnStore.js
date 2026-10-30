/**
 * Store de AVISOS (warnings) — arquivo local, data/warnings.json
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POR QUE ARQUIVO E NÃO MONGODB
 * ═══════════════════════════════════════════════════════════════════════
 * Decisão do dono: o histórico de avisos vem do Termux.
 *
 * O argumento prático, medido nesta máquina:
 *
 *   1. O MONGODB ESTÁ LONGE E FALHA. A URI é de cluster remoto e a rede do
 *      Termux já provou instabilidade — a auditoria registrou AbortError e
 *      falha de DNS duas vezes seguidas, e o teste `npm test` loga
 *      "rota alternativa do gateway também falhou (fetch failed)"
 *      rotineiramente. Se a escrita do aviso depende de rede, o aviso se
 *      perde na hora em que mais importa: quando o filtro pegou alguém.
 *
 *   2. O QUE SE PERDE É A ESCADA. Perder um aviso não é perder comforto do
 *      usuário, é perder a capacidade de.take conta: a escada de mute →
 *      expulsão → banimento zera, e quem já estava com 19 avisos volta a
 *      zero. Gravação em arquivo é síncrona e não depende de rede.
 *
 *   3. O PROCESSO PODE MORRER, O ARQUIVO NÃO. O RestartManager chama
 *      process.exit(0) e o tmux relança; o watchdog e o low-memory killer
 *      do Android matam o processo à vontade. Arquivo em disco atravessa
 *      tudo isso — é o que o próprio projeto já faz com a fila de
 *      respostas, os cooldowns de tier e o histórico de chat.
 *
 * O QUE O ARQUIVO NÃO PROTEGE
 * Desinstalar o Termux ou limpar o armazenamento do app. Para isso só o
 * Mongo (ou outro backup) serviria. O arquivo cobre o modo de falha
 * frequente — processo e rede — que é o que atingia este bot.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ESCOPO
 * ═══════════════════════════════════════════════════════════════════════
 * Aviso é escopado por guild: chave "<guildId>:<userId>". A escada de
 * punição conta aviso do servidor onde a infração aconteceu. Antes não
 * havia escopo (tudo 'unknown'), e um usuário com 19 avisos no servidor A
 * era banido no B por infrações que não houve lá. Mesma família do B23
 * (ContextMemory cruzando servidores).
 *
 * Aviso LEGADO (sem guild, vindo do Mongo antigo) vive na chave
 * "unknown:<userId>" e continua contável em qualquer servidor: são
 * infrações reais de origem irrecuperável, e descartá-las daria reset
 * grátis de punição.
 *
 * FORMATO
 *   { "<guildId>:<userId>": [ { reason, moderator, auto, timestamp, guildId } ] }
 *
 * O `guildId` é gravado DENTRO do aviso E na chave. Dentro, para o arquivo
 * ser autodescritivo (o /warnings mostra a origem sem precisar deduzir
 * pela chave); na chave, para a leitura ser O(1).
 *
 * ESCRITA
 * Atômica (tmp + rename) com .bak espelhando o último estado bom, como
 * ChatMemory. O rename é atômico: o arquivo fica no estado antigo ou no
 * novo, nunca truncado no meio. O .bak existe para o caso de ALGUÉM
 * apagar ou corromper o arquivo — nesse caso a leitura cai nele e o
 * histórico volta inteiro.
 *
 * O .bak espelha o estado BOM (é escrito depois do rename), não o
 * anterior: um .bak "uma versão atrás" perderia o último aviso gravado
 * justamente no cenário que ele existe para proteger.
 *
 * GUARDA DE PERDA SILENCIOSA
 * Aviso é punição. A forma mais fácil de perder o histórico inteiro era
 * uma escrita com estado velho (cache desatualizado, processo que subiu
 * antes de outro gravar) sobrescrever o arquivo com MENOS avisos, sem
 * aviso nenhum. Por isso o `gravar()` compara o total novo com o total
 * REALMENTE no disco: se for menor e a operação não for uma limpeza
 * explícita, os avisos que sumiram voltam (união) e o erro é logado alto.
 * Só o `clear()` pode reduzir — e ele declara que pode.
 *
 * O que motivou isso de verdade: a migração do Mongo para o arquivo (30/09)
 * NUNCA rodou — o script morria com "buffering timed out" de 10s do
 * mongoose, e o arquivo nasceu vazio. Os 56 avisos ficaram no Mongo, que
 * ninguém lê para contar punição, e a escada de punição reiniciava sozinha
 * para 5 usuários. Corrigido em 20/10: o script passou a esperar a
 * conexão de verdade, a migração rodou, e a guarda ficou no store para
 * que o mesmo silêncio não se repita.
 *
 * NÃO HÁ DEBOUNCE AQUI, ao contrário do ChatMemory. Aviso é evento raro e
 * cada um é uma punição que conta; perder um por debounce de 2s seria
 * perder a punição. Grava na hora.
 */
const fs = require('fs');
const path = require('path');
const { logError } = require('./logger');

// Mesmo padrao de override que o ChatMemory usa, para o teste poder apontar
// para um arquivo temporario em vez do arquivo real.
const FILE = process.env.WARNINGS_FILE
    ? path.resolve(process.env.WARNINGS_FILE)
    : path.join(__dirname, '..', 'data', 'warnings.json');

const LEGACY_GUILD = 'unknown';

/**
 * mtime sozinho não identifica versão: duas escritas no mesmo tick recebem
 * mtimeMs idêntico neste filesystem. O tamanho entra como segundo critério.
 * (Mesma razão e mesma correção do ChatMemory.)
 */
function assinaturaAtual() {
    try {
        const st = fs.statSync(FILE);
        return `${st.mtimeMs}:${st.size}`;
    } catch (e) { return null; }
}

function atomicWrite(file, conteudo) {
    const tmp = file + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, conteudo);
    fs.renameSync(tmp, file);
}

let cache = null;
let cacheMtime = null;

function carregar() {
    if (cache && assinaturaAtual() === cacheMtime) return cache;
    try {
        cache = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
        if (typeof cache !== 'object' || Array.isArray(cache)) cache = {};
    } catch (e) {
        try {
            cache = JSON.parse(fs.readFileSync(FILE + '.bak', 'utf8')) || {};
            console.error('⚠️ warnings.json estava corrompido — recuperei do .bak');
        } catch (e2) {
            cache = {};
            if (e && e.code !== 'ENOENT') {
                console.error('❌ warnings.json ilegível e sem .bak: ' + e.message);
            }
        }
    }
    cacheMtime = assinaturaAtual();
    return cache;
}

/**
 * Grava o estado de avisos em disco.
 *
 * GUARDA DE PERDA SILENCIOSA
 *
 * Aviso é punição: perder um é dar reset grátis de punição. O jeito mais
 * fácil de perder todos era uma escrita com estado velho — um `cache`
 * desatualizado, um processo que subiu antes de outro gravar, ou uma
 * chamada que montou o objeto do zero. Nesses casos o arquivo era
 * sobrescrito com MENOS avisos, sem aviso nenhum, e a escada de punição
 * reiniciava sozinha.
 *
 * Por isso, ANTES de gravar, esta função compara o total novo com o total
 * que está REALMENTE no disco. Se o novo for MENOR e a operação não foi uma
 * limpeza explícita, os avisos que sumiram voltam (união) e o erro é
 * logado alto. Só o `clear()` pode reduzir — e ele diz que pode.
 *
 * @param {object} dados
 * @param {{permitirReduzir?:boolean}} [opcoes]
 * @returns {boolean} gravou?
 */
function gravar(dados, opcoes = {}) {
    const permitirReduzir = opcoes.permitirReduzir === true;
    try {
        if (!fs.existsSync(path.dirname(FILE))) {
            fs.mkdirSync(path.dirname(FILE), { recursive: true });
        }

        let aGravar = dados;
        if (!permitirReduzir) {
            // A referência é o estado com MAIS avisos entre o arquivo e o
            // .bak. Um dos dois sempre está íntegro: o rename é atômico
            // (o arquivo fica no estado antigo ou no novo, nunca
            // truncado), e o .bak espelha o último estado bom.
            //
            // Sem esta regra, apagar o arquivo principal deixava o bot
            // escrever só o que tinha no .bak — e o .bak, sendo cópia do
            // estado ANTERIOR, perdia o último aviso gravado.
            const noDisco = lerDoDisco();
            const noBak = lerDoDisco(FILE + '.bak');
            const referencia = (noDisco && noBak)
                ? (contar(noBak) > contar(noDisco) ? noBak : noDisco)
                : (noDisco || noBak);
            if (referencia) {
                const antes = contar(referencia);
                const depois = contar(aGravar);
                if (depois < antes) {
                    const recuperado = fundir(referencia, aGravar);
                    const devolvidos = contar(recuperado) - depois;
                    const msg = `⚠️ warnings.json: escrita tentou REDUZIR o histórico `
                        + `(${antes} → ${depois} avisos). ${devolvidos} aviso(s) foram `
                        + `recuperados. A escada de punição não pode perder registro.`;
                    console.error(msg);
                    logError(msg);
                    aGravar = recuperado;
                }
            }
        }

        const texto = JSON.stringify(aGravar, null, 2);
        // Rename atômico: o arquivo fica no estado antigo ou no novo, nunca
        // truncado no meio.
        atomicWrite(FILE, texto);
        // O .bak espelha o ÚLTIMO ESTADO BOM — escrito DEPOIS do rename,
        // não antes.
        //
        // Antes era cópia do estado ANTERIOR ("se o rename falhar, ainda há
        // cópia boa"), mas o rename atômico JÁ garante isso: se ele falhar,
        // o arquivo continua com o estado velho, intacto. E o .bak antigo
        // tinha uma falha real: sendo uma versão atrás, apagar o arquivo
        // principal fazia o bot recuperar só o histórico MENOS o último
        // aviso gravado. Espelhar o estado bom resolve os dois.
        try { fs.copyFileSync(FILE, FILE + '.bak'); } catch (e) {}
        cache = aGravar;
        cacheMtime = assinaturaAtual();
        return true;
    } catch (e) {
        console.error('❌ Erro ao salvar warnings.json:', e.message);
        return false;
    }
}

function chaveDe(userId, guildId) {
    return `${guildId || LEGACY_GUILD}:${userId}`;
}

/**
 * Quantos avisos há no objeto (soma o tamanho de todas as listas).
 */
function contar(dados) {
    if (!dados || typeof dados !== 'object') return 0;
    return Object.values(dados).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);
}

/**
 * Identidade de um aviso: timestamp + motivo. Dois registros com o mesmo par
 * são o MESMO aviso (o mesmo evento gravado duas vezes), não dois avisos.
 */
function idDe(w) {
    return `${w && w.timestamp}|${w && w.reason}`;
}

/**
 * Une dois estados de avisos sem perder nenhum.
 *
 * O que está em `base` (o que está no disco) e não está em `novo` volta
 * para o resultado. Serve para o guard de escrita: quando uma escrita
 * tentaria REDUZIR o histórico, os avisos que faltam são devolvidos.
 */
function fundir(base, novo) {
    const saida = {};
    for (const [k, l] of Object.entries(novo || {})) {
        saida[k] = Array.isArray(l) ? l.slice() : l;
    }
    for (const [k, l] of Object.entries(base || {})) {
        if (!Array.isArray(l)) continue;
        const atual = Array.isArray(saida[k]) ? saida[k] : [];
        const vistos = new Set(atual.map(idDe));
        for (const a of l) {
            if (!vistos.has(idDe(a))) atual.push(a);
        }
        saida[k] = atual;
    }
    return saida;
}

/**
 * Lê um arquivo do disco, SEM passar pelo cache.
 *
 * O guard de escrita precisa do estado REAL em disco: o `cache` é o mesmo
 * objeto que o `add()` acabou de mutar, então comparar com ele seria
 * comparar o novo com ele mesmo.
 *
 * @param {string} [arquivo] padrão: o arquivo principal
 * @returns {object|null} null = não existe ou está ilegível
 */
function lerDoDisco(arquivo) {
    try {
        const d = JSON.parse(fs.readFileSync(arquivo || FILE, 'utf8'));
        if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
        return d;
    } catch (e) {
        return null;
    }
}

const WarnStore = {

    FILE,
    LEGACY_GUILD,

    /**
     * @param {string} userId
     * @param {{reason:string, moderator?:string, guildId?:string, auto?:boolean, timestamp?:number}} warnData
     * @returns {boolean} gravou?
     */
    add(userId, warnData) {
        const dados = carregar();
        const guildId = warnData.guildId || LEGACY_GUILD;
        const chave = chaveDe(userId, guildId);
        if (!Array.isArray(dados[chave])) dados[chave] = [];
        dados[chave].push({
            reason: warnData.reason || 'Não informado',
            moderator: warnData.moderator || null,
            auto: warnData.auto === true,
            timestamp: warnData.timestamp || Date.now(),
            // O `guildId` é gravado DENTRO do aviso, não só na chave.
            //
            // Antes ele vivia só na chave ("<guildId>:<userId>"), e o
            // `get()` reconstituía o campo na leitura. Funcionava para
            // contar, mas o objeto gravado ficava incompleto: foi o que
            // obrigou um backfill em 04/10 e o que fazia o /warnings
            // mostrar origem errada. Gravar o campo é o que torna o
            // arquivo autodescritivo.
            guildId
        });
        return gravar(dados);
    },

    /**
     * @param {string} userId
     * @param {string} [guildId] sem argumento, conta todos os servidores
     * @returns {Array} mais recente primeiro
     */
    get(userId, guildId) {
        const dados = carregar();
        const u = String(userId);
        const out = [];
        const g = guildId ? String(guildId) : null;

        if (g) {
            // Avisos deste servidor MAIS os legados de origem desconhecida:
            // são infrações reais e descartá-las daria reset de punição.
            const alvo = dados[chaveDe(userId, g)];
            if (Array.isArray(alvo)) {
                for (const w of alvo) out.push({ ...w, guildId: g, legacy: false });
            }
            const legado = dados[chaveDe(userId, LEGACY_GUILD)];
            if (Array.isArray(legado)) {
                for (const w of legado) out.push({ ...w, guildId: LEGACY_GUILD, legacy: true });
            }
        } else {
            for (const [chave, lista] of Object.entries(dados)) {
                if (!Array.isArray(lista)) continue;
                const sep = chave.indexOf(':');
                const uChave = sep >= 0 ? chave.slice(sep + 1) : chave;
                if (uChave !== u) continue;
                const gChave = sep >= 0 ? chave.slice(0, sep) : LEGACY_GUILD;
                for (const w of lista) {
                    out.push({ ...w, guildId: gChave, legacy: gChave === LEGACY_GUILD });
                }
            }
        }

        out.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return out;
    },

    /**
     * @param {string} userId
     * @param {string} [guildId] limpa só deste servidor; sem argumento, limpa tudo
     */
    clear(userId, guildId) {
        const dados = carregar();
        if (guildId) {
            delete dados[chaveDe(userId, guildId)];
        } else {
            for (const chave of Object.keys(dados)) {
                const sep = chave.indexOf(':');
                const uChave = sep >= 0 ? chave.slice(sep + 1) : chave;
                if (uChave === String(userId)) delete dados[chave];
            }
        }
        // `permitirReduzir`: esta é a ÚNICA operação que pode DIMINUIR o
        // histórico, e ela é explícita (a staff mandou limpar). Toda
        // outra escrita passa pelo guard que impede a perda silenciosa.
        return gravar(dados, { permitirReduzir: true });
    },

    /** Só para teste/diagnóstico. */
    size() { return Object.keys(carregar()).length; },

    reset() { cache = null; cacheMtime = null; },

    /** Usado pela migração do Mongo e pelos testes. */
    _carregar: carregar,
    _gravar: gravar,
    /** Utilitários expostos para teste do guard de escrita. */
    _contar: contar,
    _fundir: fundir,
    _lerDoDisco: lerDoDisco,
    _chaveDe: chaveDe,
};

module.exports = WarnStore;