const config = require('../config');
const { logWarn } = require('../utils/logger');
const { chat: kiloChat } = require('../utils/kiloChat');

/**
 * Decide se um pedido de código merece o seletor de tier.
 *
 * POR QUE UM FUNIL E NAO SO O JUIZ
 *
 * A decisão ("isso é um projeto ou uma tarefa simples?") erra barato dos
 * dois lados: falso positivo custa um clique perdido, falso negativo custa
 * o output curto que o bot já dá hoje. Nada disso é caro, então a
 * implementação certa é a mais barata possível — e o mais barato possível
 * é não gastar chamada de modelo.
 *
 * Por isso o funil de 3 estágios:
 *   1. claramente pequeno  → regex, zero custo
 *   2. claramente projeto  → regex, zero custo
 *   3. ambíguo             → só aqui o juiz (Kilo) decide
 *
 * O TASK_KEYWORDS do TaskRunner não serve para isso: tem 'script', 'um bot'
 * e 'modulo', casados como palavra inteira, o que dá falso positivo demais.
 *
 * POR QUE O JUIZ É SEPARADO DO MODELO PRINCIPAL
 *
 * O juiz roda em request de USUÁRIO, no meio de um atendimento: se ele
 * usar o mesmo caminho do modelo principal, trava atrás da geração de
 * código (que pode levar minutos). Então o juiz tem base, chave, timeout
 * e modelo próprios — mesmo gateway do Kilo, mas com timeout curto
 * (2,5s). O padrão vem de managers/InjectionGuard.js: temperature 0,
 * max_tokens 16, fail-open.
 */

const ENABLED = config.TIER_JUDGE;
const MODEL = config.TIER_JUDGE_MODEL;
const BASE = String(config.TIER_JUDGE_BASE_URL || '').replace(/\/+$/, '');
const TIMEOUT_MS = config.TIER_JUDGE_TIMEOUT_MS;
const MAX_TOKENS = config.TIER_JUDGE_MAX_TOKENS;
const API_KEY = config.TIER_JUDGE_API_KEY || process.env.KILO_API_KEY || '';
const API_KEYS = (config.TIER_JUDGE_API_KEYS && config.TIER_JUDGE_API_KEYS.length) ? config.TIER_JUDGE_API_KEYS : (config.KILO_API_KEYS || []);
// 'none' DESLIGA o raciocínio. Medido no gateway: com reasoning_effort=none
// o juiz responde "PROJETO"/"SIMPLES" direto, em ~4 tokens. Sem isso, o
// orçamento inteiro vai para raciocínio e o `content` volta VAZIO — o juiz
// nunca daria veredito.
const REASONING = config.TIER_JUDGE_REASONING_EFFORT;

// Palavras FORTES de projeto: sozinhas já decidem. "site" e "dashboard" não
// têm leitura de "arquivo único".
const PESADO = [
    'site', 'sites', 'landing page', 'pagina', 'paginas', 'página', 'páginas',
    'aplicativo', 'app completo', 'dashboard', 'painel', 'sistema', 'plataforma',
    'portifolio', 'portfolio', 'e-commerce', 'loja virtual', 'api rest', 'fullstack',
    'projeto', 'multiplos arquivos', 'varios arquivos', 'estrutura completa',
    'profissional', 'identidade visual', 'frontend', 'front-end', 'back-end', 'landing',
];

// Stack é sinal FRACO e nunca decide sozinho. "calculadora em React e
// TypeScript" é projeto (vira package.json, tsconfig, App.tsx, index.tsx,
// styles), mas "valida CPF em TypeScript" é um .ts só. Colocar stack em
// PESADO tratava os dois igual; aqui ela só entra quando não há palavra de
// arquivo único no pedido, e o resto vai pro juiz.
const STACK = [
    'react', 'typescript', 'nextjs', 'next.js', 'vue', 'vuejs', 'angular', 'svelte',
    'flutter', 'dart', 'node', 'express', 'django', 'flask', 'rails', 'spring',
    'laravel', 'dotnet', 'tailwind', 'bootstrap', 'firebase',
];

// Palavras que pedem uma coisa so, pequena.
//
// NINGUMA aqui pode ser subpalavra de outra: "script" casando dentro de
// "typescript" ja fez o funil reprovar um projeto React como tarefa simples.
// Por isso o casamento é por palavra inteira (ver casaPalavra).
const LEVE = [
    'funcao', 'função', 'funções', 'metodo', 'método', 'classe', 'variavel',
    'variável', 'tipagem', 'regex', 'expressao', 'expressão', 'consulta sql',
    'query', 'comando', 'snippet', 'trecho', 'palavra', 'palavras', 'mistura',
    'ordenar', 'contar', 'explicar', 'explica', 'traduzir', 'corrigir', 'erro',
    'bug', 'ajuste', 'ajustar', 'refatorar', 'renomear', 'script', 'teste unitario',
    'arquivo so', 'único arquivo', 'so um arquivo', 'um arquivo',
];

/**
 * Casa a palavra como PALAVRA INTEIRA.
 *
 * String.includes() é o que gerou o bug do "TypeScript": contains('script')
 * é true. O mesmo cuidado já existe em TaskRunner._hasKeyword e é o motivo
 * de o padrão existir.
 */
function casaPalavra(texto, palavra) {
    const t = ` ${String(texto || '').toLowerCase()} `;
    // Frases com espaço casam como frase: "landing page"
    if (palavra.includes(' ')) return t.includes(palavra);
    const seguro = palavra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${seguro}([^a-z0-9]|$)`).test(t);
}

const cache = new Map();
const MAX_CACHE = 300;

const PROMPT = `Você decide se um pedido de programação é um PROJETO (vários arquivos, site, app, sistema completo) ou uma TAREFA SIMPLES (uma função, um script, um único arquivo).

Responda APENAS com "PROJETO" ou "SIMPLES". Nada além disso.

PROJETO = site, landing page, páginas, aplicativo, dashboard, sistema, plataforma, bot completo, projeto profissional, "algo completo", múltiplos arquivos, frontend + backend.
SIMPLES = uma função, um método, uma classe, um script, uma query, um comando, um único arquivo, corrigir um erro, explicar um trecho.

Exemplos:
"crie uma calculadora usando React e TypeScript, focando na acessibilidade" -> PROJETO
"faz um site institucional completo e responsivo" -> PROJETO
"cria um dashboard de vendas com gráfico e tabela" -> PROJETO
"monta um bot de Discord com comandos e painel admin" -> PROJETO
"me escreve uma função que inverte string em Python" -> SIMPLES
"faz um script bash pra backupar um diretório" -> SIMPLES
"cria uma classe Usuario com nome e email em Java" -> SIMPLES
"corrige esse erro de sintaxe no meu codigo" -> SIMPLES
"como faço uma consulta SQL que conta linhas" -> SIMPLES

Pedido: "`
    + '{PEDIDO}'
    + `"

Resposta:`;

/** Cache circular simples: nao deixa o Map crescer sem parar. */
function lembrar(chave, valor) {
    if (cache.size >= MAX_CACHE) {
        const primeiro = cache.keys().next().value;
        cache.delete(primeiro);
    }
    cache.set(chave, valor);
    return valor;
}

/**
 * Estagio 1 e 2: o que o regex já resolve sem gastar modelo.
 * @param {string} texto
 * @returns {'projeto'|'simples'|null} null = ambíguo, precisa do juiz
 */
function porPalavras(texto) {
    const forte = PESADO.some(p => casaPalavra(texto, p));
    const stack = STACK.some(p => casaPalavra(texto, p));
    const leve = LEVE.some(p => casaPalavra(texto, p));

    if (forte) return 'projeto';
    // Sinal fraco sem sinal de arquivo único: projeto.
    if (stack && !leve) return 'projeto';
    if (leve && !stack) return 'simples';
    // forte+leve ("sistema com uma função só") ou stack+leve ("valida CPF em
    // TypeScript"): ninguém decide, o juiz sim.
    return null;
}

/**
 * Estagio 3: o juiz (Kilo). Só é chamado no caso ambíguo.
 * @param {string} texto
 * @returns {Promise<'projeto'|'simples'|null>} null = não deu, decide o chamador
 */
async function juiz(texto) {
    if (!ENABLED) return null;
    if (!API_KEYS.length) return null;

    const chave = `j:${texto}`;
    if (cache.has(chave)) return cache.get(chave);

    try {
        const r = await kiloChat({
            model: MODEL,
            messages: [{ role: 'user', content: PROMPT.replace('{PEDIDO}', String(texto).slice(0, 600)) }],
            temperature: 0,
            max_tokens: MAX_TOKENS,
            reasoning_effort: REASONING,
            timeoutMs: TIMEOUT_MS,
            // Orçamento TOTAL: o juiz roda no meio do atendimento do usuário.
            deadlineMs: TIMEOUT_MS,
            apiKey: API_KEYS,
            baseUrl: BASE,
        });

        const bruto = String(r.content || '').toUpperCase();
        if (!bruto) return null;

        // "SIMPLES" não contém "PROJETO", então a ordem de teste não tem
        // colisão entre os dois.
        if (bruto.includes('PROJETO')) return lembrar(chave, 'projeto');
        if (bruto.includes('SIMPLES')) return lembrar(chave, 'simples');
        return null;
    } catch (e) {
        if (e.name === 'AbortError' || e.status === 408) {
            logWarn(`[TierJudge] juíz estourou ${TIMEOUT_MS}ms — sem veredito, decide o chamador`);
        } else {
            logWarn(`[TierJudge] falhou (${e.message}) — sem veredito, decide o chamador`);
        }
        return null;
    }
}

/**
 * Ponto de entrada: decide se o pedido abre o seletor de tier.
 * NUNCA lança, NUNCA trava: no pior caso devolve 'simples' (o
 * comportamento que o bot já tinha antes dos tiers existirem).
 *
 * @param {string} texto o pedido do usuário
 * @returns {Promise<{projeto:boolean, via:'palavras'|'juiz'|'padrao'}>}
 */
async function precisaTier(texto) {
    const palavra = porPalavras(texto);
    if (palavra) {
        return { projeto: palavra === 'projeto', via: 'palavras' };
    }
    const v = await juiz(texto);
    if (v) {
        return { projeto: v === 'projeto', via: 'juiz' };
    }
    // Ambíguo e juiz indisponível: não abre seletor. O usuário ainda pode
    // forçar com !max / !high.
    return { projeto: false, via: 'padrao' };
}

/** Só para os testes: esvazia o cache. */
function limparCache() { cache.clear(); }

module.exports = { precisaTier, porPalavras, juiz, casaPalavra, limparCache, PESADO, STACK, LEVE, cache };
