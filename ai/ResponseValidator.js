const kb = require('./knowledge-loader');
const { logInfo, logWarn } = require('../utils/logger');

// Validador determinístico da resposta da IA (seção 14 do plano).
// NÃO substitui a resposta por texto fixo: apenas decide se a geração é aceitável.
// Se inválida, o chamador pode re-gerar (retry) ou cair no fallback de staff existente.

const GIVE_UP_PATTERNS = [
    /\bn[ãa]o tenho essa informa[çc][ãa]o/i,
    /\bn[ãa]o (sei|posso|consigo|haveria) (responder|ajudar|informa)/i,
    /\b(vou|vamos|irei|vou chamar)\s+(chamar|encaminhar|avisar|chamar)\b/i,
    /\b(vou|vamos|irei)\s+chamar\b/i,
    /\bchamar\s+(um\s+|o\s+|nosso\s+|algum\s+)?(staff|suporte|equipe|atendente|algu[ée]m)\b/i,
    /\b(um|o|nosso)\s+(staff|atendente|suporte)\s+(vai|ir[áa]|deve|pode)\b/i,
    /\binforma[çc][ãa]o no momento/i,
    /\bpreciso (de|que) (um\s+)?(staff|suporte|atendente)\b/i
];

// Resposta que "desiste" de responder (qualquer variação) — usada para decidir
// se a resposta do modelo é válida e se o caso deve cair no staff.
function isGiveUp(text) {
    const t = (text || '').trim();
    if (!t) return false;
    return GIVE_UP_PATTERNS.some(re => re.test(t));
}

// Afirmações que a base não sustenta (ex.: dizer que é gratuito sem estar no conhecimento)
const UNSUPPORTED_CLAIMS = [
    { out: /\bgr[aá]tuit|\bgr[aá]tis|\bfree\b/i, src: /\bgr[aá]tuit|\bgr[aá]tis|\bfree\b/i, what: 'gratuidade' },
    { out: /\bcusta(m|r|ndo)?\b|\btem que pagar\b|\bpode pagar\b|\bprecisa pagar\b/i, src: /\bcust|\bpag|\bpre[çc]o\b|\btaxa\b/i, what: 'custo/pagamento' }
];

const BANNED_PHRASES = [
    'de acordo com o conhecimento',
    'de acordo com o contexto',
    'de acordo com a base',
    'conforme o conhecimento',
    'conforme o contexto',
    'segundo o conhecimento',
    'segundo o contexto',
    'espero ter ajudado',
    'sou uma ia',
    'sou um bot'
];

const EN_STOPWORDS = new Set(('the a an and or but is are was were to of in for on with you your we our they them this that it its not no yes can could would should be been have has had do does did what why how who which when where me my because as at so if then than are you').split(' '));
const PT_STOPWORDS = new Set(('o a os as e ou mas que com para em por de do da dos das no na nos nas num numa nao sim voce vc seu sua meus minha nosso sua este esta esse essa isto isso aquilo ele ela eles elas eu nos eu quiem onde como porque por que precisa pode poderia ser ter esta so vai foi era estou na verdade ja mais menos ja disponivel certo erro ajuda pergunta resposta informacao').toLowerCase().split(' '));

const MENTION_RE = /<(?:[#@]|@&)(\d{16,20})>/g;

function extractMentions(text) {
    const ids = [];
    if (!text) return ids;
    let m;
    while ((m = MENTION_RE.exec(text)) !== null) ids.push(m[1]);
    return ids;
}

function extractAllowedIds(sourceText) {
    const ids = new Set(extractMentions(sourceText || ''));
    return ids;
}

/** Palavras uteis (sem stopword) de um texto, normalizadas. */
function groundingTokens(text) {
    const out = [];
    const re = /\b([a-zçãõáéíóúâêô]{4,24})\b/gi;
    let m;
    while ((m = re.exec(String(text || '')))) {
        const w = m[1].toLowerCase();
        if (PT_STOPWORDS.has(w) || EN_STOPWORDS.has(w)) continue;
        out.push(w);
    }
    return out;
}

/**
 * Quanto da resposta esta de fato no CONHECIMENTO.
 *
 * A regra de "passos" nao pode contar numeros: a KB documenta fluxo com
 * seta ("escolher tipo -> escolher veiculo -> confirmar", 0 itens numerados)
 * e a IA reescreve os mesmos passos numerados. Contar dava 5 > 0 e matava
 * uma resposta perfeita. O que separa invencao de reorganizacao e o
 *foundland: passo inventado traz palavra que nao existe no texto base.
 */
function groundingRatio(text, source) {
    const base = normText(source || '');
    const baseTokens = groundingTokens(base);
    if (!baseTokens.length) return 1;
    const alvo = groundingTokens(text);
    if (!alvo.length) return 1;

    let ancoradas = 0;
    for (const t of alvo) {
        // a palavra precisa existir no contexto, nao so ter raiz parecida
        if (baseTokens.some((b) => b === t || sharesStem(b, t))) { ancoradas++; continue; }
        // sinonimo declarado (apagar/deletar, ver/consultar...)
        const s = SYNONYM[t];
        if (s && baseTokens.some((b) => b === s || sharesStem(b, s))) { ancoradas++; }
    }
    return ancoradas / alvo.length;
}

/**
 * Vira "#1234567890123456789" em "<#1234567890123456789>".
 *
 * A IA escreve o ID do canal sem os sinais e ele nao vira link no Discord.
 * Antes isso reprovava a resposta inteira e escalava o ticket para a staff
 * por um detalhe de formatacao. Corrigir aqui e deterministico e nao custa
 * request: se o ID for inventado, a regra de mencao sem base ainda barra.
 */
function fixBareChannelIds(text) {
    return String(text || '').replace(/(^|[^<#])#(\d{15,22})(?!\d)/g, (m, antes, id) => {
        return antes + '<#' + id + '>';
    });
}

function countOrderedItems(text) {
    const numbered = (text.match(/^\s*\d{1,2}[.)]\s/gm) || []).length;
    const passos = (text.match(/\bpasso\s+\d/gi) || []).length;
    return numbered + passos;
}

/**
 * Marcadores de "sequencia" no texto: numeração, "passo N" e as setas que a
 * KB usa para documentar fluxo ("escolher tipo -> escolher veiculo -> confirmar").
 */
function countFlowMarkers(text) {
    const setas = (String(text || '').match(/→|->|=>|»/g) || []).length;
    return countOrderedItems(text) + setas;
}

function stripListMarkers(text) {
    return String(text || '')
        .split('\n')
        .map(l => l.replace(/^\s*\d{1,2}[.)]\s+/, '').replace(/\s+$/, ''))
        .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
        .join('\n');
}

// ---------------------------------------------------------------------------
// PROTEÇÃO NUMÉRICA (§13, §14, §49, §61)
// O modelo pequeno erra a COLUNA da tabela e a conta. Aqui os números da
// resposta são conferidos contra os números do contexto recuperado.
// Não escreve a resposta: apenas decide se ela pode passar.
// ---------------------------------------------------------------------------

// Números redondos de uso comum em texto não são fiscalizados.
const IGNORED_NUMBERS = new Set([1, 2, 3, 4, 5, 6, 7, 10, 12, 24, 30, 60, 100]);

function extractNumbers(text) {
    const out = new Set();
    // Menções são IDs (snowflake do Discord), não conteúdo: sem esta remoção
    // o <#1553042999720542218> virava "números inventados" 155304299972 e
    // 155304300, e uma resposta perfeitamente correta era reprovada.
    const t = String(text || '')
        .replace(/<(?:@[!&]?|#)\d{15,22}>/g, ' ')
        .replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2');
    for (const m of t.matchAll(/\d+/g)) {
        const n = parseInt(m[0], 10);
        if (Number.isNaN(n)) continue;
        out.add(n);
        if (n >= 1000) out.add(Math.round(n / 1000)); // 350.000 também conta como 350
    }
    return out;
}

// Extrai as colunas de dados das tabelas markdown do contexto.
// Ignora colunas de ID (snowflake do Discord tem 17-19 dígitos).
function findDataColumns(context) {
    const cols = [];
    const lines = String(context || '').split('\n');
    let i = 0;
    while (i < lines.length) {
        if (!/^\s*\|/.test(lines[i])) { i++; continue; }
        let j = i;
        while (j < lines.length && /^\s*\|/.test(lines[j])) j++;
        const rows = lines.slice(i, j);
        const body = rows.slice(2);
        const width = (rows[0].match(/\|/g) || []).length - 1;
        if (width >= 2 && body.length >= 2) {
            for (let c = 0; c < width; c++) {
                const cells = body.map(l => (l.split('|')[c + 1] || '').trim()).filter(v => /\d/.test(v));
                if (cells.length < body.length) continue;            // coluna tem texto/misto
                const vals = cells.map(v => parseInt(v.replace(/[^\d]/g, ''), 10)).filter(n => !Number.isNaN(n));
                if (vals.some(n => String(n).length > 7)) continue; // coluna de ID
                const uniq = [...new Set(vals)];
                if (uniq.length >= 3) cols.push(uniq);
            }
        }
        i = j;
    }
    return cols;
}

const COLUMN_QUESTION = /(quantos|quantas|quantidade|todos|todas|cada|limite|limites|lista|listar)/i;
// "no tier 4" pede UMA linha, não a coluna. Nesse caso a checagem de coluna
// inteira não se aplica — a resposta correta tem um único número.
const SPECIFIC_ROW = /\b(tier|n[ií]vel|level|painel)\s*(?:n[ºo]?\s*)?\d{1,2}\b/i;
// Valor documentado sem número: "ilimitado". Não há coluna numérica a conferir.
const NON_NUMERIC = /ilimitad|sem limite|sem restric|sem teto/i;

function checkNumbers(r, question, context, extraSource) {
    if (!context) return null;

    // Números citados pelo próprio usuário (ex.: "um carro de 90 mil") são legítimos.
    const ctxNums = extractNumbers(context + ' ' + (extraSource || '') + ' ' + question);
    const ansNums = extractNumbers(r);

    // 1) Número que não existe no conhecimento nem na pergunta = invenção.
    const inventados = [...ansNums].filter(n => !IGNORED_NUMBERS.has(n) && !ctxNums.has(n));
    if (inventados.length) {
        return { valid: false, reason: 'citou numero que nao esta no conhecimento: ' + inventados.join(', ') };
    }

    // 2) Pergunta de coluna/tabela: a resposta tem que cobrir os valores.
    //    Não se aplica quando a pergunta nomeia uma linha específica
    //    ("no tier 4") nem quando o valor documentado não é numérico.
    if (COLUMN_QUESTION.test(question) && !SPECIFIC_ROW.test(question) && !NON_NUMERIC.test(r)) {
        const cols = findDataColumns(context).filter(c => c.length >= 3);
        if (cols.length) {
            const cobriuAlguma = cols.some(col => {
                const exigidos = Math.ceil(col.length * 0.6);
                return col.filter(v => ansNums.has(v)).length >= exigidos;
            });
            if (!cobriuAlguma) {
                const alvo = cols.map(c => c.join(', ')).join('  |  ');
                return {
                    valid: false,
                    reason: 'a pergunta pede a coluna inteira e a resposta nao cobre nenhuma tabela do conhecimento (' +
                        alvo + '). Repita todos os valores'
                };
            }
        }
    }

    // 3) Pergunta de COMPARACAO com valor ("carro de 90 mil da erro"): a
    // resposta precisa citar pelo menos um teto documentado. Sem isso o modelo
    // responde "acima do seu limite" e nao ajuda (§49).
    // Nao se aplica quando a pergunta ja nomeia a linha ("teto do tier 6"),
    // porque ai a resposta correta e um unico valor.
    const temValorNaPergunta = /\d/.test(question) && /(mil|k\b|reais|real|preco|preço|valor|teto)/i.test(question);
    if (temValorNaPergunta && !NON_NUMERIC.test(r) && !SPECIFIC_ROW.test(question)) {
        const precos = findDataColumns(context).filter(c => c.some(v => v >= 1000));
        if (precos.length) {
            const albedo = precos.some(col => col.some(v => ansNums.has(v)));
            if (!albedo) {
                return {
                    valid: false,
                    reason: 'a pergunta traz um valor e a resposta nao citou nenhum teto do conhecimento (' +
                        precos.map(c => c.join(', ')).join(' | ') + '). Compare o valor e diga a partir de qual tier ele passa'
                };
            }
        }
    }
    return null;
}

function lookEnglish(response, question) {
    const enQ = (question.match(/\b(how|what|which|when|where|is|can|do|are|the|a|please|help|register)\b/gi) || []).length;
    if (enQ > 2) return false; // usuário falou inglês → não punir resposta em inglês
    const toks = (response.toLowerCase().match(/[a-zà-ú]{2,}/g) || []);
    if (toks.length < 4) return false;
    let en = 0, pt = 0;
    for (const t of toks) {
        if (EN_STOPWORDS.has(t)) en++;
        if (PT_STOPWORDS.has(t)) pt++;
    }
    if (en >= 2 && en > pt && pt === 0) return true;
    return en >= 3 && en > pt;
}

const SLASH_ALLOWED = new Set([
    'houseregister', 'housechannel', 'mytier', 'config', 'acess',
    'register', 'registered', 'workcars', 'delete', 'export', 'backup',
    // Comandos slash do próprio HostVille • BOT (existem de verdade, com "/").
    'ping', 'help', 'warn', 'warnings', 'clearwarns', 'timeout', 'kick', 'ban',
    'purge', 'ticket', 'close', 'adicionar', 'ticket-setup', 'ticket-config',
    'filter', 'linksettings', 'autointeraction', 'maintenance', 'adm',
    'private', 'report', 'avatar', 'serverinfo', 'userinfo', 'deploy'
]);

// Comandos citados com "/" que não existem (os prefixos reais são ; $ ')
const SLASH_RE = /(?:^|[\s`"'(])\/([a-z_]{2,20})/gi;

// Rótulo de botão/campo entre aspas na resposta. Se o rótulo não existir no
// contexto, o modelo inventou um botão. (§48/§59)
const LABEL_RE = /["“”«»`]([A-Za-zÀ-ÿ0-9][^"“”«»`\n]{2,60})["“”«»`]/g;
const LABEL_ALLOW = new Set(['registrar veiculo', 'registrar imovel', 'fechar ticket', 'assumir', 'confirmar']);

function findInventedLabels(text, context, extraSource) {
    const src = normText(context + ' ' + (extraSource || ''));
    const out = [];
    LABEL_RE.lastIndex = 0;
    let m;
    while ((m = LABEL_RE.exec(text)) !== null) {
        const label = normText(m[1]);
        if (label.length < 3) continue;
        if (LABEL_ALLOW.has(label)) continue;
        if (src.includes(label)) continue;
        out.push(m[1].trim());
    }
    return [...new Set(out)];
}

function normText(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function findFakeSlashCommands(text) {
    const out = [];
    let m;
    SLASH_RE.lastIndex = 0;
    while ((m = SLASH_RE.exec(text)) !== null) {
        const cmd = m[1].toLowerCase();
        if (!SLASH_ALLOWED.has(cmd)) out.push('/' + cmd);
    }
    return out;
}

const NEGATION_RE = /\b(?:nao e possivel|não é possível|nao possivel|não pode|nao pode|nao existe|não existe|nao tem como|não tem como|não dá|não da)\s+(?:usar|fazer|remover|apagar|excluir|editar|criar|registrar|ver)?\s*(?:(?:para|de|com)\b\s*)?(?:usar|fazer|remover|apagar|excluir|editar|criar|registrar|ver)?\s*([a-zçãõáéíóú]{3,24})/gi;

const CLAIM_SYNONYM = {
    apagar: 'deletar', apaga: 'deletar', remove: 'deletar', remover: 'deletar',
    excluir: 'deletar', exclui: 'deletar', deleta: 'deletar',
    ver: 'consultar', listar: 'consultar', buscar: 'consultar', consultar: 'consultar'
};

const GENERIC_NEGATION = new Set(['coisa', 'modo', 'forma', 'comando', 'comandos', 'essa', 'esse', 'maneira', 'jeito', 'funcao', 'opcao', 'restricao', 'limite']);

function normalizeClaim(word) {
    const w = (word || '').toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    return CLAIM_SYNONYM[w] || w;
}

// Detecta "não é possível/não existe X" quando a base DOCUMENTA esse X.
const ACTION_WORDS = /\b(usar|fazer|remover|remocao|apagar|apaga|apaguei|excluir|exclui|deletar|deleta|editar|criacao|criar|registrar|registro|ver|listar|buscar|consultar|bloquear|desbloquear)\b/gi;

const SYNONYM = {
    apagar: 'deletar', apaga: 'deletar', apaguei: 'deletar', remove: 'deletar', remover: 'deletar',
    excluir: 'deletar', exclui: 'deletar', deleta: 'deletar', delete: 'deletar',
    ver: 'consultar', listar: 'consultar', buscar: 'consultar', consultar: 'consultar'
};

function sharesStem(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 4) return a === b;
    return a.slice(0, n) === b.slice(0, n);
}

function findContradictions(text, source) {
    const src = (source || '').toLowerCase();
    const documented = new Set();
    let m;
    const cmdRe = /[';$]([a-z_]{3,24})/gi;
    while ((m = cmdRe.exec(src)) !== null) documented.add(m[1].toLowerCase());

    const out = [];
    NEGATION_RE.lastIndex = 0;
    while ((m = NEGATION_RE.exec(text)) !== null) {
        const frag = m[0].toLowerCase();
        const negated = frag.match(ACTION_WORDS) || [];
        for (const raw of negated) {
            const neg = SYNONYM[raw] || raw;
            for (const d of documented) {
                if (sharesStem(neg, d)) {
                    out.push(neg);
                    break;
                }
            }
        }
    }
    return [...new Set(out)];
}

// Comandos que existem na base e SEMPRE precisam do prefixo ; $ ' na resposta
const PREFIXED_COMMANDS = [
    'deletar', 'deletevehicle', 'remover', 'listar', 'listvehicles', 'buscar', 'searchvehicle',
    'stats', 'estatisticas', 'bloquear', 'blockplate', 'desbloquear', 'unblockplate', 'bloqueadas',
    'listblocked', 'repost', 'reenviar', 'restaurar', 'restore', 'verify', 'verificar',
    'limpar', 'cleanup', 'exportar', 'exportdata', 'backup', 'anunciar', 'broadcast', 'sandbox', 'arena',
    'help', 'ajuda', 'comandos', 'ping', 'tier', 'sessoes', 'ranking', 'top', 'link', 'info', 'acess', 'config',
    'search', 'info', 'vizinhanca', 'minhasprops', 'neighborhoods', 'bairros',
    'status', 'reformar', 'abandonar', 'invadir', 'gangue', 'policia', 'interditar', 'investigar', 'liberar'
];

// Só é comando quando está em código/aspas ou perto de "use/comando/rode".
const COMANDO_CONTEXTO = /(use|usar|uso|comando|comandos|rode|rodar|digite|digitar|execute|executar|tipo|exemplo)\s+(?:o\s+|a\s+|este\s+|esse\s+)?$/i;
const PALAVRA_RE = /\b([a-z][a-z0-9_]{2,24})\b/gi;

function findUnprefixedCommands(text, source) {
    const t = ' ' + String(text || '');
    const out = [];

    // Normaliza o texto-fonte para comparar labels documentadas sem acento
    // e sem diferenciar maiuscula/minuscula.
    const srcNorm = normText(String(source || '')).toLowerCase();

    PALAVRA_RE.lastIndex = 0;
    let m;
    while ((m = PALAVRA_RE.exec(t)) !== null) {
        const palavra = m[1].toLowerCase();
        if (!PREFIXED_COMMANDS.includes(palavra)) continue;

        const antes = t.slice(Math.max(0, m.index - 30), m.index);
        const inicio = m.index;

        // crase/aspas duplas marcam código; a aspa simples é PREFIXO de comando do Vehix
        let pos = inicio;
        let charAntes = t[pos - 1] || '';
        let emCodigo = false;
        if (/[`"]/.test(charAntes)) {
            emCodigo = true;
            pos = pos - 1;
            charAntes = t[pos - 1] || '';
        }
        if (/['`;$]/.test(charAntes)) continue;
        if (/[`"]/.test(t[inicio + m[0].length] || '')) emCodigo = true;

        // Nome de BOTAO entre aspas que o conhecimento documenta nao e
        // comando: o botao do Vehiclex se chama "Deletar um veiculo" e isso
        // ja confundia a regra com o comando 'deletar.
        if (emCodigo && srcNorm) {
            const abre = t.lastIndexOf('"', inicio) > t.lastIndexOf('`', inicio) ? '"' : '`';
            const fecha = t.indexOf(abre, inicio);
            if (fecha > inicio) {
                // recorta exatamente o texto entre as aspas. Antes havia um
                // clamp "inicio - 60" que, com a palavra perto do começo da
                // frase, cortava desde o inicio e a comparação falhava.
                const abreIdx = t.lastIndexOf(abre, inicio);
                const frase = normText(abreIdx >= 0 ? t.slice(abreIdx + 1, fecha) : t.slice(inicio, fecha));
                if (frase && srcNorm.includes(frase.toLowerCase())) continue;
            }
        }

        const pertoDeComando = COMANDO_CONTEXTO.test(antes);
        if (emCodigo || pertoDeComando) out.push(palavra);
    }
    return [...new Set(out)];
}

/**
 * Valida a resposta da IA.
 * @param {string} response
 * @param {Object} opts
 * @param {string} [opts.question]      - pergunta original
 * @param {string[]} [opts.docs]        - ids dos docs recuperados da KB (não usados para texto)
 * @param {string} [opts.extraSource]   - texto extra onde menções também são aceitas (ex.: histórico/web)
 * @returns {{ valid: boolean, reason?: string }}
 */
function validate(response, opts = {}) {
    const r = (response || '').trim();
    const { question = '', docs = [], extraSource = '', context = '', maxChars = 700, maxLines = 8 } = opts;

    if (!r) return { valid: false, reason: 'a resposta veio vazia' };

    const fakeSlash = findFakeSlashCommands(r);
    if (fakeSlash.length) {
        return { valid: false, reason: 'citou comando inexistente com barra: ' + fakeSlash.join(', ') + ' (prefixos reais sao ; $ \')' };
    }

    // Resposta não pode colar a tabela markdown do conhecimento
    if (/\|[-: |]{3,}\|/.test(r) || /^\s*\|.*\|\s*$/m.test(r)) {
        return { valid: false, reason: 'copiou a tabela do conhecimento (use frases, nao use |)' };
    }

    const soltos = findUnprefixedCommands(r, loadSourceText(docs) + ' ' + (extraSource || '') + ' ' + context);
    if (soltos.length) {
        return { valid: false, reason: 'escreveu comando sem o prefixo: ' + soltos.join(', ') + ' (use ; $ ou \')' };
    }

    // Canal escrito como #123456789 não vira menção no Discord. A versão
    // anterior exigia um caractere específico antes do # e deixava passar
    // "**#1553...**" (o * do markdown quebrava o lookbehind).
    const semSinal = [...String(r).matchAll(/#(\d{15,22})/g)]
        .filter((m) => {
            const antes = r[m.index - 1] || '';
            const depois = r[m.index + m[0].length] || '';
            return !(antes === '<' && depois === '>');
        })
        .map((m) => m[0]);
    if (semSinal.length) {
        return { valid: false, reason: 'escreveu o ID do canal sem <# > (não vira link): ' + [...new Set(semSinal)].join(', ') };
    }

    // NOTA: aqui nao existe regra "a resposta tem mais passos que o
    // conhecimento". Ela foi removida de proposito depois de reprovar TRIM
    // respostas corretas: comparava contagem de itens, e a KB documenta
    // fluxo com seta (0 itens numerados) enquanto a IA reescreve os mesmos
    // passos numerados. A invencao de etapas nao fica sem cobertura: canal,
    // numero, label e comando inventados continuam barrados pelas regras
    // exatas acima (extractAllowedIds, checkNumbers, findInventedLabels,
    // findFakeSlashCommands, findUnprefixedCommands, findContradictions).

    // Tamanho. O teto nao pode ser arbitratio: a resposta vai para a
    // descricao de um embed, e o limite do Discord ali e 4096. Acima disso
    // a propria mensagem nao seria enviada.
    //
    // O prompt pede "3 frases curtas", mas o KILO_MIN_TOKENS=1200 (medido:
    // com 220 o modelo devolve content vazio) deixa a IA escrever ate ~1200
    // tokens. Teto curto demais aqui significava resposta CORRETA recusada e
    // ticket escalado para a staff, que e o pior resultado possivel.
    // Pergunta de dado continua com teto curto; pergunta de "como faço", cujo
    // conhecimento documenta um fluxo, pode vir em etapas.
    const temFluxo = countFlowMarkers(context) > 0;
    const limiteLinhas = temFluxo ? 30 : 10;
    const limiteChars = temFluxo ? 4096 : 1200;

    const shaped = formatLines(stripListMarkers(r));
    if (shaped.length > limiteChars || shaped.split('\n').length > limiteLinhas) {
        return { valid: false, reason: 'a resposta ultrapassou o tamanho/formato permitido (' + shaped.split('\n').length + '/' + limiteLinhas + ' linhas, ' + shaped.length + '/' + limiteChars + ' chars, fluxo=' + temFluxo + ')' };
    }

    const lower = r.toLowerCase();
    for (const phrase of BANNED_PHRASES) {
        if (lower.includes(phrase)) {
            return { valid: false, reason: "mencionou as instrucoes internas ou frase proibida ('" + phrase + "')" };
        }
    }

    if (docs.length > 0 && isGiveUp(r)) {
        return { valid: false, reason: 'desistiu (chamou staff) mesmo com conhecimento disponivel no contexto' };
    }

    // Afirmação que a base não sustenta (ex.: "o registro e gratuito" sem estar no conhecimento)
    const source = loadSourceText(docs) + ' ' + (extraSource || '');
    for (const claim of UNSUPPORTED_CLAIMS) {
        if (claim.out.test(r) && !claim.src.test(source)) {
            return { valid: false, reason: 'afirmou ' + claim.what + ' que nao esta no conhecimento' };
        }
    }

    // Contradição: a resposta nega algo que a base documenta
    const srcForContradiction = loadSourceText(docs) + ' ' + (extraSource || '');
    const contradictions = findContradictions(r, srcForContradiction);
    if (contradictions.length) {
        return { valid: false, reason: 'negou algo que o conhecimento documenta: "' + contradictions.join(', ') + '"' };
    }

    // Menções inventadas: IDs citados devem existir no conhecimento (ou no texto extra)
    const mentioned = extractMentions(r);
    if (mentioned.length) {
        const nudgeSource = docs.length > 0;
        const allowed = extractAllowedIds(loadSourceText(docs) + ' ' + (extraSource || ''));
        const invented = mentioned.filter(id => !allowed.has(id));
        if (nudgeSource && invented.length) {
            return { valid: false, reason: 'citou canal/cargo/usuario inventado nao presente no conhecimento' };
        }
        if (!nudgeSource && docs.length === 0) {
            return { valid: false, reason: 'citou canal/cargo sem ter base para isso' };
        }
    }

    // Intencao x comando: /kick (expulsa) NAO substitui /ban (bane). As duas
    // acoes existem no bot, entao a checagem de "comando real" nao pega.
    const pedeBan = /\b(bane|banir|banimento|banir|ban)\b/i.test(question);
    if (pedeBan) {
        const low = String(r).toLowerCase();
        const citaKick = /\/kick\b|\bexpuls[ao] um membro\b/.test(low);
        const citaBan = /\/ban\b|\bbanid/.test(low);
        if (citaKick && !citaBan) {
            return { valid: false, reason: 'respondeu /kick (expulsa) numa pergunta de banimento. Para banir e /ban' };
        }
    }

    const numero = checkNumbers(r, question, context, extraSource);
    if (numero && !numero.valid) return numero;

    const rotulos = findInventedLabels(r, context, extraSource);
    if (rotulos.length) {
        return { valid: false, reason: 'citou botao/campo que nao existe no conhecimento: ' + rotulos.join(', ') };
    }

    // Resposta que e SO uma menção (<#id>, <@&id>) nao explica nada: sem texto
    // o usuario recebe um link solto e nao sabe o que fazer.
    const semTexto = r
        .replace(/<#[^>]+>|<@&?[^>]+>/g, ' ')
        .replace(/[`*_>#\-|]/g, ' ')
        .replace(/\s+/g, '');
    if (semTexto.length < 3 && (opts.attempt || 0) < 1) {
        return { valid: false, reason: 'respondeu apenas com a mencao, sem explicar' };
    }

    if (lookEnglish(r, question)) {
        return { valid: false, reason: 'respondeu em ingles quando a pergunta era em portugues' };
    }

    return { valid: true };
}

function loadSourceText(docs) {
    try {
        const index = kb.loadIndex();
        const byId = new Map((index.documents || []).map(d => [d.id, d]));
        return (docs || [])
            .map(id => kb.loadDocContent(byId.get(id)))
            .filter(Boolean)
            .join('\n');
    } catch (e) {
        return '';
    }
}

// Quebra uma resposta longa em uma linha por informação (o modelo às vezes
// entrega tudo num parágrafo). É só formatação: não cria nem remove conteúdo.
function formatLines(text) {
    const t = (text || '').trim();
    if (!t) return t;
    if (t.includes('\n')) return t;
    if (t.length < 100) return t;
    // não quebrar número com ponto (ex.: 150.000) nem abreviação comum
    let parts = t.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ü0-9"“*<(])/);
    if (parts.length < 2) return t;
    let clean = parts.map(p => p.trim()).filter(Boolean);
    if (clean.some(p => /^\d{1,2}[.)]\s/.test(p))) return t;
    // máximo de 5 linhas: o excedente volta para a última (nada é perdido)
    if (clean.length > 5) {
        const rest = clean.slice(4).join(' ');
        clean = clean.slice(0, 4).concat([rest]);
    }
    return clean.join('\n');
}

/**
 * Gera resposta com validação + retry.
 * Retorna o texto aceito ou null (para o chamador cair no fallback de staff).
 *
 * @param {Object} ia - instância do KiloClient (ou do cliente do IAFallback,
 *   que tem a mesma interface .chat)
 * @param {Object} opts
 * @param {string} opts.systemPrompt
 * @param {string} opts.userMessage
 * @param {Object} [opts.optionOverrides] - { temperature, max_tokens }
 * @param {string[]} [opts.docs]
 * @param {string} [opts.extraSource]
 * @param {number} [opts.attempts]
 * @param {string} [opts.contexto] - rotulo para os logs (ex.: 'duvidas')
 */
async function generateValidated(ia, opts) {
    // 1 request por pergunta. O retry com outras palavras consome o dobro
    // e, quando a resposta ja era boa, nao muda nada: o modelo devolve
    // quase o mesmo texto e o validador recusa de novo pelo mesmo motivo.
    const attempts = Math.max(1, opts.attempts || 1);
    const options = { temperature: 0.3, max_tokens: 220, ...(opts.optionOverrides || {}) };
    let lastReason = '';
    let text = null;

    for (let a = 0; a < attempts; a++) {
        // Temperatura sobe a cada tentativa: com temp 0.3 o modelo repete a
        // mesma resposta palavra por palavra e o retry não corrige nada.
        const attemptOptions = { ...options, temperature: Math.min(0.75, (options.temperature || 0.3) + 0.25 * a) };
        let systemPrompt = opts.systemPrompt;
        if (a > 0) {
            systemPrompt += `\n\n[NOVA TENTATIVA: sua resposta anterior foi recusada porque ${lastReason}. Reescreva do zero, com outras palavras. NÃO copie e NÃO reestruture o texto do CONHECIMENTO. Entregue no máximo 3 frases curtas, sem numeração, sem tabela e sem markdown.]`;
        }
        try {
            text = await ia.chat({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: opts.userMessage }
                ],
                ...attemptOptions,
                contexto: opts.contexto || 'ticket'
            });
        } catch (e) {
            const err = new Error('IA indisponivel: ' + (e && e.message ? e.message : 'erro desconhecido'));
            err.iaDown = true;
            throw err;
        }

        // conserta o ID de canal escrito sem <# > ANTES de validar
        if (text) text = fixBareChannelIds(text);

        const v = validate(text, {
            attempt: a,
            question: opts.userMessage,
            docs: opts.docs || [],
            extraSource: opts.extraSource,
            context: opts.context,
            maxChars: opts.maxChars,
            maxLines: opts.maxLines
        });
        if (v.valid) {
            // A resposta passou: este tipo de pergunta é respondida por estes
            // documentos. Guardar o padrão melhora a busca das próximas.
            // Só o caminho com docs da KB entra — conversa sem base não tem
            // "onde olhar" para aprender.
            try {
                const docs = opts.docs || [];
                if (Array.isArray(docs) && docs.length) {
                    const { normalize } = require('./knowledge-loader');
                    const words = normalize(opts.userMessage || '').split(/[^a-z0-9]+/).filter(w => w.length >= 4);
                    require('../utils/learnedPatterns').record(words, docs);
                }
            } catch (e) { /* aprendizado é acessório, nunca derruba a resposta */ }

            return formatLines(stripListMarkers(text));
        }

        lastReason = hintFor(v.reason);
        // log com o motivo CRU e o hint: antes so o hint aparecia, e ele nao
        // diz qual regra disparou — impossivel descobrir a causa no console
        logInfo(`⚠️ RESPOSTA RECUSADA (tentativa ${a + 1}/${attempts}) | regra=${v.reason} | hint=${lastReason} | resposta="${String(text).slice(0, 90)}"`);
        text = null;
    }

    logWarn(`🚫 IA SEM RESPOSTA VALIDA após ${attempts} tentativa(s) | ultimo motivo: ${lastReason || 'desconhecido'} | pergunta="${String(opts.userMessage).slice(0, 80)}"`);
    return null;
}

// Traduz o motivo da reprovação em uma instrução que o modelo entende,
// em vez de repetir "você errou de novo".
function hintFor(reason) {
    if (!reason) return 'a resposta anterior não foi aceita';
    if (/tamanho|formato/i.test(reason)) return 'a resposta ficou longa demais. Escreva no máximo 4 frases curtas, sem lista numerada.';
    if (/passos/i.test(reason)) return 'você inventou etapas que não existem. Escreva apenas o que o CONHECIMENTO diz, sem criar etapas.';
    if (/desistiu|staff/i.test(reason)) return 'a resposta existe no CONHECIMENTO acima. Releia o bloco e responda com o dado que está lá.';
    if (/prefixo/i.test(reason)) return 'os comandos têm prefixo: Atlas usa ";", Ascend usa "$", Vehix usa "\'". Escreva com o prefixo.';
    if (/barra/i.test(reason)) return 'não use "/" antes de comandos. Use o prefixo correto: ; $ ou \'.';
    if (/sinal/i.test(reason)) return 'escreva o canal como <#1234567890123456789>, com < e >.';
    if (/gratuidade|custo/i.test(reason)) return 'não comente sobre preço ou gratuidade se o CONHECIMENTO não disser.';
    if (/contrad|negou/i.test(reason)) return 'não diga que algo é impossível se o CONHECIMENTO mostra que existe.';
    if (/inventad/i.test(reason)) return 'não cite canal ou comando que não esteja no CONHECIMENTO.';
    if (/instru|proibida/i.test(reason)) return 'não comente sobre a base de conhecimento nem sobre ser uma IA.';
    if (/idioma|ingles/i.test(reason)) return 'responda em português brasileiro.';
    if (/menç/i.test(reason)) return 'só cite canais e cargos que aparecem no CONHECIMENTO.';
    return 'a resposta anterior foi recusada. Refaça usando somente o CONHECIMENTO e o formato pedido.';
}

module.exports = { validate, generateValidated, formatLines, isGiveUp, findContradictions, fixBareChannelIds, countFlowMarkers, extractNumbers };