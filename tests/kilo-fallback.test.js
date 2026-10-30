/**
 * Testes do fallback de rota do Kilo Code (AI Gateway).
 *
 * O bot fala com o gateway (https://ai-gateway.kilo.ai/api/v1), que e
 * OpenAI-compatible e autentica com KILO_API_KEY. O provedor e UNICO: a
 * rota alternativa e o MESMO gateway com OUTRO MODELO, para o caso do
 * modelo principal cair (cota, modelo fora do catalogo, 401 na chave).
 *
 * Regra central: fallback SÓ em erro de TRANSPORTE/AUTENTICACAO (sem
 * conexao, 5xx, 429, timeout, 401/403). Erro de conteudo (vazio,
 * finish_reason=load) NÃO aciona — repetir no outro modelo devolve o mesmo
 * e só gasta cota duas vezes.
 *
 *   node tests/kilo-fallback.test.js
 */
const fs = require('fs');
const assert = require('assert');
const path = require('path');

// Log separado do bot (ver utils/logger.js: LOG_FILE).
process.env.LOG_FILE = process.env.LOG_FILE || 'teste.log';
const RAIZ = path.join(__dirname, '..');
const fetchReal = global.fetch;

// Modelos usados no teste. Dotenv nao sobrescreve variavel de ambiente que
// ja existe, entao estes valores valem mesmo com o .env real carregado.
const MODELO_PRINCIPAL = 'provedor/modelo-principal';
const MODELO_ALTERNATIVO = 'provedor/modelo-alternativo';

function carregar({ reasoning = 'none' } = {}) {
    for (const k of Object.keys(require.cache)) {
        if (k.includes('KiloClient') || k.includes('/config')) delete require.cache[k];
    }
    process.env.KILO_API_KEY = 'chave-de-teste-kilo';
    process.env.KILO_BASE_URL = 'http://kilo.test/v1';
    process.env.KILO_DEFAULT_MODEL = MODELO_PRINCIPAL;
    process.env.KILO_FALLBACK_MODEL = MODELO_ALTERNATIVO;
    process.env.KILO_REASONING = reasoning;
    return require(path.join(RAIZ, 'managers/KiloClient'));
}

let passou = 0, falhou = 0;
async function teste(nome, fn) {
    try { await fn(); console.log('  ok   ' + nome); passou++; }
    catch (e) {
        console.log('  FALHA ' + nome);
        console.log('       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e));
        falhou++;
    }
}

/** Dublê de fetch que responde por URL e registra as chamadas. */
function comFetch(handler, fn) {
    const original = global.fetch;
    const chamadas = [];
    global.fetch = async (url, opts) => {
        chamadas.push({ url: String(url), opts, corpo: opts && opts.body ? JSON.parse(opts.body) : null, headers: (opts && opts.headers) || {} });
        return handler(String(url), opts, chamadas.length - 1);
    };
    return Promise.resolve()
        .then(fn)
        .then((r) => ({ ...(typeof r === 'object' && r ? r : {}), _chamadas: chamadas }))
        .finally(() => { global.fetch = original; });
}

const okContent = (conteudo = 'resposta do modelo') => ({
    ok: true, status: 200,
    json: async () => ({ choices: [{ message: { content: conteudo }, finish_reason: 'stop' }], usage: { total_tokens: 30 } }),
    text: async () => '{}',
});

/** Erro de rede: fetch rejeita, como o gateway fora do ar / DNS oscilando. */
const erroRede = () => { const e = new Error('fetch failed'); e.cause = new Error('connect ECONNREFUSED'); throw e; };

/** Qual modelo a chamada esta usando (as duas rotas ficam no mesmo host). */
const modeloDa = (c) => c && c.corpo && c.corpo.model;

(async () => {
    // ============================================================
    // _valeFallback: o que aciona e o que NÃO aciona
    // ============================================================

    await teste('sem rota alternativa configurada, _valeFallback e sempre false', () => {
        const O = carregar();
        O.cadeia = [];
        O.fallback = null; // simula .env sem KILO_FALLBACK_MODEL
        assert.strictEqual(O._valeFallback(new Error('fetch failed')), false);
        assert.strictEqual(O._valeFallback(new Error('HTTP 500')), false);
    });

    await teste('erro de rede ACIONA o fallback', () => {
        const O = carregar();
        assert.strictEqual(O._valeFallback(new Error('fetch failed')), true);
        const abort = new Error('abortado'); abort.name = 'AbortError';
        assert.strictEqual(O._valeFallback(abort), true, 'timeout deve acionar');
    });

    await teste('5xx e 429 ACIONAM o fallback', () => {
        const O = carregar();
        const e5 = new Error('HTTP 502'); e5.status = 502;
        assert.strictEqual(O._valeFallback(e5), true);
        const e429 = new Error('HTTP 429'); e429.status = 429;
        assert.strictEqual(O._valeFallback(e429), true);
        const e408 = new Error('HTTP 408'); e408.status = 408;
        assert.strictEqual(O._valeFallback(e408), true);
    });

    await teste('erro de CONTEUDO NAO aciona o fallback', () => {
        const O = carregar();
        // A falha degenerada (sem turno de user) é um Error normal, sem status.
        assert.strictEqual(O._valeFallback(new Error("request sem turno de 'user' (finish_reason=load)")), false,
            'resposta degenerada nao deve gastar cota do fallback');
        assert.strictEqual(O._valeFallback(new Error('resposta sem conteudo valido')), false);
    });

    await teste('401 do gateway ACIONA o fallback (chave expirada/cortada)', () => {
        // Cenario real de producao: o gateway responde 401 porque a chave
        // expirou ou a conta ficou sem saldo. A rota alternativa (outro
        // modelo) e exatamente o que cobre isso.
        const O = carregar();
        const e401 = new Error('HTTP 401'); e401.status = 401;
        assert.strictEqual(O._valeFallback(e401), true,
            '401 nao pode ficar sem fallback — o bot ficaria sem IA');
        const e403 = new Error('HTTP 403'); e403.status = 403;
        assert.strictEqual(O._valeFallback(e403), true);
    });

    await teste('gateway respondendo 401 -> rota alternativa assume', async () => {
        const O = carregar();
        const r = await comFetch(async (url, opts) => {
            const modelo = modeloDa({ corpo: JSON.parse(opts.body) });
            if (modelo === MODELO_ALTERNATIVO) return okContent('resposta pelo modelo alternativo');
            return { ok: false, status: 401, text: async () => '{"error":"Unauthorized"}' };
        }, async () => {
            const out = await O.chat({ messages: [{ role: 'user', content: 'oi' }], max_tokens: 100 });
            assert.strictEqual(out, 'resposta pelo modelo alternativo');
        });
        const chamadaAlt = r._chamadas.find(c => modeloDa(c) === MODELO_ALTERNATIVO);
        assert.ok(chamadaAlt, 'a rota alternativa deveria ter sido acionada no 401');
        assert.ok(chamadaAlt.headers['Authorization'], 'a chamada da alternativa leva a Authorization');
    });

    // ============================================================
    // Fluxo de rede: principal cai -> alternativa responde
    // ============================================================

    await teste('rota principal respondendo NAO toca na alternativa', async () => {
        const O = carregar();
        const r = await comFetch(async (url, opts) => {
            if (modeloDa({ corpo: JSON.parse(opts.body) }) !== MODELO_PRINCIPAL) {
                throw new Error('FALLOU: alternativa nao devia ser chamada');
            }
            return okContent('veio do modelo principal');
        }, async () => {
            const out = await O.chat({ messages: [{ role: 'user', content: 'oi' }], max_tokens: 100 });
            assert.strictEqual(out, 'veio do modelo principal');
        });
        assert.ok(!r._chamadas.some(c => modeloDa(c) === MODELO_ALTERNATIVO),
            'chamou a alternativa mesmo com a principal saudavel');
    });

    await teste('gateway fora do ar -> alternativa responde', async () => {
        const O = carregar();
        const r = await comFetch(async (url, opts) => {
            if (modeloDa({ corpo: JSON.parse(opts.body) }) === MODELO_ALTERNATIVO) return okContent('veio da rota alternativa');
            erroRede();
        }, async () => {
            const out = await O.chat({ messages: [{ role: 'user', content: 'oi' }], max_tokens: 100 });
            assert.strictEqual(out, 'veio da rota alternativa');
        });
        const chamadasAlt = r._chamadas.filter(c => modeloDa(c) === MODELO_ALTERNATIVO);
        assert.strictEqual(chamadasAlt.length, 1, 'a alternativa deveria ter sido chamada 1x');
        // A chamada leva a Authorization e o modelo da rota.
        const auth = chamadasAlt[0].headers['Authorization'];
        assert.ok(auth && auth.startsWith('Bearer '), 'a alternativa precisa mandar a Authorization');
        assert.strictEqual(chamadasAlt[0].corpo.model, O.fallback.model, 'a alternativa tem que usar o modelo dela');
    });

    await teste('as DUAS rotas caidas -> erro final, sem laco infinito', async () => {
        const O = carregar();
        await comFetch(async () => { erroRede(); }, async () => {
            await assert.rejects(
                () => O.chat({ messages: [{ role: 'user', content: 'oi' }], max_tokens: 100 }),
                /ECONNREFUSED|fetch failed|indisponivel/i
            );
        });
    });

    await teste('conteudo vazio NAO consome a alternativa (so uma chamada)', async () => {
        const O = carregar();
        const r = await comFetch(async (url, opts) => {
            if (modeloDa({ corpo: JSON.parse(opts.body) }) === MODELO_ALTERNATIVO) {
                throw new Error('FALLOU: nao devia chamar alternativa p/ erro de conteudo');
            }
            // resposta 200 mas sem conteudo e sem raciocinio => degenerada
            return {
                ok: true, status: 200,
                json: async () => ({ choices: [{ message: { content: '' }, finish_reason: 'stop' }], usage: { total_tokens: 30 } }),
                text: async () => '{}',
            };
        }, async () => {
            await assert.rejects(
                () => O.chat({ messages: [{ role: 'user', content: 'oi' }], max_tokens: 100 }),
                /sem conteudo valido/
            );
        });
        assert.ok(r._chamadas.every(c => modeloDa(c) !== MODELO_ALTERNATIVO),
            'erro de conteudo nao pode ir pro fallback');
    });

    await teste('content vazio COM raciocinio escala tokens, sem ir pro fallback', async () => {
        const O = carregar();
        let n = 0;
        await comFetch(async (url, opts) => {
            if (modeloDa({ corpo: JSON.parse(opts.body) }) === MODELO_ALTERNATIVO) {
                throw new Error('FALHOU: escalacao nao pode acionar o fallback');
            }
            n++;
            if (n === 1) {
                // 1a chamada: acabou o orcamento pensando
                return {
                    ok: true, status: 200,
                    json: async () => ({ choices: [{ message: { content: '', reasoning: 'pensou bastante' }, finish_reason: 'length' }], usage: { total_tokens: 100 } }),
                    text: async () => '{}',
                };
            }
            return okContent('resposta apos retry');
        }, async () => {
            const out = await O.chat({ messages: [{ role: 'user', content: 'oi' }], max_tokens: 100 });
            assert.strictEqual(out, 'resposta apos retry');
        });
        assert.ok(n >= 2, `a escalacao deveria ter repetido a chamada, houve ${n}`);
    });

    await teste('ateRota=principal PARA a cadeia antes da rota alternativa', async () => {
        // Regressao real: a cadeia tem uma rota com um modelo generico. Se ela
        // respondesse primeiro, um ticket que deveria usar o modelo do
        // contexto acabaria com o generico — mais fraco, sem ninguem avisar.
        // O IAFallback passa ateRota='principal' e cai no modelo certo.
        const O = carregar();
        const r = await comFetch(async (url, opts) => {
            if (modeloDa({ corpo: JSON.parse(opts.body) }) === MODELO_ALTERNATIVO) {
                return okContent('veio da alternativa');
            }
            erroRede();
        }, async () => {
            await assert.rejects(
                () => O.chat({ messages: [{ role: 'user', content: 'oi' }], max_tokens: 100, ateRota: 'principal' }),
                /ECONNREFUSED|fetch failed/i
            );
        });
        assert.ok(!r._chamadas.some(c => modeloDa(c) === MODELO_ALTERNATIVO),
            'a cadeia foi ate a alternativa mesmo com ateRota=principal');
    });

    await teste('ateRota NAO vaza para o corpo HTTP', async () => {
        // ateRota e campo interno: `extra` e espalhado no body, e a API pode
        // rejeitar propriedade desconhecida (o gateway ja rejeitou options).
        const O = carregar();
        const r = await comFetch(async () => okContent('ok'), async () => {
            await O.chat({ messages: [{ role: 'user', content: 'oi' }], max_tokens: 100, ateRota: 'principal' });
        });
        for (const c of r._chamadas) {
            assert.strictEqual(c.corpo.ateRota, undefined, `ateRota vazou no body: ${JSON.stringify(c.corpo)}`);
        }
    });

    await teste('contexto NAO vaza para o corpo HTTP', async () => {
        // Regressao real de producao: `contexto` e rotulo de log
        // (ResponseValidator, TaskRunner, ProjectGenerator), mas `extra` e
        // espalhado no corpo e a API responde 400 "property 'contexto' is
        // unsupported". Com isso TODAS as rotas caem de uma vez e o bot fica
        // sem IA em todo ticket/task/gerador.
        const O = carregar();
        const r = await comFetch(async () => okContent('ok'), async () => {
            await O.chat({ messages: [{ role: 'user', content: 'oi' }], max_tokens: 100, contexto: 'duvidas' });
        });
        assert.ok(r._chamadas.length > 0, 'nenhuma chamada foi registrada');
        for (const c of r._chamadas) {
            assert.strictEqual(c.corpo.contexto, undefined, `contexto vazou no body: ${JSON.stringify(c.corpo)}`);
        }
    });

    await teste('campos internos com prefixo __ nunca vao no corpo', async () => {
        // `__retry` e o marcador do retry de escalacao por raciocinio. Ele
        // entrava no corpo pelo mesmo `...extra` e derrubava a 2a chamada com
        // 400 — que e exatamente a chamada feita para recuperar a resposta.
        const O = carregar();
        let n = 0;
        const r = await comFetch(async () => {
            n++;
            if (n === 1) {
                return {
                    ok: true, status: 200,
                    json: async () => ({ choices: [{ message: { content: '', reasoning: 'pensou bastante' }, finish_reason: 'length' }], usage: { total_tokens: 100 } }),
                    text: async () => '{}',
                };
            }
            return okContent('resposta apos retry');
        }, async () => {
            const out = await O.chat({ messages: [{ role: 'user', content: 'oi' }], max_tokens: 100, contexto: 'taskrunner:geracao' });
            assert.strictEqual(out, 'resposta apos retry');
        });
        assert.ok(n >= 2, `a escalacao deveria ter repetido a chamada, houve ${n}`);
        for (const c of r._chamadas) {
            assert.strictEqual(c.corpo.__retry, undefined, `__retry vazou no body: ${JSON.stringify(c.corpo)}`);
            assert.strictEqual(c.corpo.contexto, undefined, `contexto vazou no body: ${JSON.stringify(c.corpo)}`);
        }
    });

    await teste('parametros de API reais (top_p/penalties) continuam indo no corpo', async () => {
        // A correcao nao pode ser "nao espalha mais nada": utils/ai.js passa
        // top_p, frequency_penalty e presence_penalty, que sao campos validos
        // da OpenAI. So o que NAO e parametro de API sai.
        const O = carregar();
        const r = await comFetch(async () => okContent('ok'), async () => {
            await O.chat({
                messages: [{ role: 'user', content: 'oi' }],
                max_tokens: 100,
                top_p: 0.8,
                frequency_penalty: 0.3,
                presence_penalty: 0.2,
            });
        });
        const o = r._chamadas.find(c => modeloDa(c) === MODELO_PRINCIPAL);
        assert.ok(o, 'a rota principal deveria ter sido chamada');
        assert.strictEqual(o.corpo.top_p, 0.8, 'top_p do chamador sumiu');
        assert.strictEqual(o.corpo.frequency_penalty, 0.3, 'frequency_penalty do chamador sumiu');
        assert.strictEqual(o.corpo.presence_penalty, 0.2, 'presence_penalty do chamador sumiu');
    });

    await teste('corpo NAO leva options/top_k/repeat_penalty/keep_alive', async () => {
        // Regressao real: `options` {top_k, repeat_penalty, num_ctx} e
        // `keep_alive` sao NATIVOS do Ollama. O gateway (OpenRouter por baixo)
        // REJEITA propriedade desconhecida com 400 "property 'options' is
        // unsupported". Nenhum dos dois pode ser enviado.
        const O = carregar();
        const r = await comFetch(async () => okContent('ok'), async () => {
            await O.chat({ messages: [{ role: 'user', content: 'oi' }], max_tokens: 100 });
        });
        for (const c of r._chamadas) {
            const corpo = c.corpo;
            assert.strictEqual(corpo.options, undefined, `options nao pode ir no body: ${JSON.stringify(corpo)}`);
            assert.strictEqual(corpo.keep_alive, undefined, 'keep_alive nao pode ir no body');
            assert.strictEqual(corpo.top_k, undefined, 'top_k nao e parametro do gateway');
            assert.strictEqual(corpo.repeat_penalty, undefined, 'repeat_penalty nao e parametro do gateway');
            assert.strictEqual(corpo.num_ctx, undefined, 'num_ctx nao e parametro do gateway');
            assert.ok(corpo.top_p !== undefined, 'top_p e parametro valido e deve ser enviado');
        }
    });

    await teste('reasoning_effort vai com o valor do .env', async () => {
        // O valor vai AO GATEWAY como `reasoning_effort`. 'none' significa
        // "sem raciocínio" (o gateway entende e devolve reasoning_tokens=0),
        // não "não enviar".
        const O = carregar({ reasoning: 'none' });
        const r = await comFetch(async () => okContent('ok'), async () => {
            await O.chat({ messages: [{ role: 'user', content: 'oi' }], max_tokens: 100 });
        });
        for (const c of r._chamadas) {
            assert.strictEqual(c.corpo.reasoning_effort, 'none',
                `reasoning_effort deveria ir como 'none': ${JSON.stringify(c.corpo)}`);
        }
    });

    await teste('sem ateRota, a cadeia usa a alternativa normalmente', async () => {
        // O caso de quem NAO tem IAFallback (ChatManager, AutoInteraction,
        // filas): precisa da cadeia inteira.
        const O = carregar();
        const r = await comFetch(async (url, opts) => {
            if (modeloDa({ corpo: JSON.parse(opts.body) }) === MODELO_ALTERNATIVO) return okContent('veio da alternativa');
            erroRede();
        }, async () => {
            const out = await O.chat({ messages: [{ role: 'user', content: 'oi' }], max_tokens: 100 });
            assert.strictEqual(out, 'veio da alternativa');
        });
        assert.ok(r._chamadas.some(c => modeloDa(c) === MODELO_ALTERNATIVO),
            'sem ateRota a cadeia deve usar a alternativa');
    });

    await teste('gateway que recusa reasoning_effort: repete sem o campo', async () => {
        // O contrato do gateway nao lista `reasoning_effort` e ele e repassado
        // ao provedor de baixo. Alguns modelos respondem 400 "property
        // 'reasoning_effort' is unsupported". Um parametro opcional nao pode
        // derrubar o bot: o cliente repete a mesma rota sem o campo.
        process.env.KILO_REASONING = 'high';
        const O = carregar({ reasoning: 'high' });
        let n = 0;
        const r = await comFetch(async (url, opts) => {
            n++;
            const corpo = JSON.parse(opts.body);
            if (corpo.reasoning_effort) {
                return { ok: false, status: 400, text: async () => '{"error":{"message":"property \'reasoning_effort\' is unsupported"}}' };
            }
            return okContent('ok sem o campo');
        }, async () => {
            const out = await O.chat({ messages: [{ role: 'user', content: 'oi' }], max_tokens: 100 });
            assert.strictEqual(out, 'ok sem o campo');
        });
        assert.ok(n >= 2, `deveria ter repetido a chamada, houve ${n}`);
        // A 2a chamada (a que vale) não leva o campo.
        const ultima = r._chamadas[r._chamadas.length - 1];
        assert.strictEqual(ultima.corpo.reasoning_effort, undefined, 'a repeticao ainda levou o campo');
        process.env.KILO_REASONING = 'none';
    });

    await teste('a mensagem de status mostra o modelo REAL, nao um fixo', () => {
        // O MemoryWatcher mostrava um modelo fixo que nao era o usado. Procura
        // no CODIGO (sem comentarios), senao a propria explicacao do bug
        // faria o teste falhar.
        const src = fs.readFileSync(path.join(RAIZ, 'managers/MemoryWatcher.js'), 'utf8');
        const codigo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        assert.ok(!/qwen2\.5-coder/.test(codigo), 'o codigo ainda mostra o modelo fixo errado');
        assert.ok(/kilo\.model/.test(codigo), 'deveria ler o modelo do KiloClient');
    });

    await teste('erro OPERACIONAL nao derruba o bot (buffering/EAI_AGAIN/401)', () => {
        // Regressao real de producao: o "buffering timed out" do Mongoose
        // chegava por uncaughtException e o process.exit(1) matava o bot
        // inteiro a cada oscilacao de rede. Agora o crashLogger classifica
        // e deixa vivo.
        const src = fs.readFileSync(path.join(RAIZ, 'utils/crashLogger.js'), 'utf8');
        assert.ok(/EAI_AGAIN/.test(src) && /buffering timed out/.test(src),
            'o classificador de erro operacional sumiu do crashLogger');

        // Isola SO o corpo do handler, sem comentarios nem o resto do arquivo.
        const ini = src.indexOf("process.on('uncaughtException'");
        const fim = src.indexOf("process.on('unhandledRejection'");
        const corpo = src.slice(ini, fim).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').trim();
        assert.ok(corpo.length > 0, 'nao achei o handler de uncaughtException');

        // O `if (operacional) { ... return; }` tem de vir antes do process.exit
        // do caminho de CRASH (o ultimo, depois do bloco). O process.exit
        // DENTRO do if de rajada e proposito e nao conta.
        const iIf = corpo.indexOf('if (operacional)');
        const iReturn = corpo.indexOf('return;', iIf);
        const iCrashExit = corpo.lastIndexOf('process.exit(1)');
        assert.ok(iIf >= 0, 'o handler nao classifica erro operacional');
        assert.ok(iReturn >= 0, 'o caminho operacional nao tem return');
        assert.ok(iCrashExit >= 0, 'o handler nao encerra em crash de verdade');
        assert.ok(iReturn < iCrashExit, 'o return operacional precisa vir antes do process.exit de crash');
        // e o caminho de crash (codigo real) continua com process.exit
        assert.ok(iCrashExit > iReturn, 'o crash de verdade precisa continuar encerrando');
    });

    await teste('erro de codigo (bug real) AINDA encerra o bot', () => {
        const src = fs.readFileSync(path.join(RAIZ, 'utils/crashLogger.js'), 'utf8');
        const bloco = src.slice(src.indexOf("process.on('uncaughtException'"));
        assert.ok(/process\.exit\(1\)/.test(bloco), 'o crash de verdade tem que continuar encerrando');
    });

    await teste('h limite de rajada: 30 falhas operacionais em 60s encerram', () => {
        // Se o processo esta realmente quebrado, continuar fingindo que esta
        // de pe e pior que sair: o bot parece online e nao responde nada.
        const src = fs.readFileSync(path.join(RAIZ, 'utils/crashLogger.js'), 'utf8');
        assert.ok(/_operacionais\.length >= LIMITE/.test(src),
            'sem limite de rajada, um loop de erro operacional nunca sairia');
    });

    await teste('a chamada usa o dispatcher com connect timeout > 10s do undici', async () => {
        // Regressao real de producao: o undici aborta o connect em 10s e,
        // nesta rede, o TLS do host lento leva 15-26s. A rota morria com
        // UND_ERR_CONNECT_TIMEOUT ("This operation was aborted") mesmo com a
        // chave certa. O timeout por rota protege o tempo TOTAL; este e o do
        // TCP, e precisa ir no fetch.
        //
        // O dispatcher mora DENTRO do utils/httpDispatcher: o fetch global
        // do Node recusa o Agent do undici instalado (UND_ERR_INVALID_ARG),
        // entao o httpDispatcher usa o fetch do proprio undici, que e
        // coerente com o Agent dele. O teste nao ve o Agent na opcao do
        // fetch (ele e aplicado dentro do httpDispatcher) — ve o Agent
        // criado e o timeout configurado.
        const HD = require(path.join(RAIZ, 'utils/httpDispatcher'));
        const agent = HD.dispatcher();
        assert.ok(agent, 'o dispatcher tem que existir');
        assert.ok(HD.fetchOpts().dispatcher, 'o fetchOpts tem que entregar o dispatcher');

        const ms = Number(require(path.join(RAIZ, 'config')).KILO_CONNECT_TIMEOUT_MS);
        assert.ok(ms > 10000, `connect timeout tem que passar de 10s (padrao do undici), veio ${ms}`);
    });

    await teste('sem undici no projeto, o fetch segue sem dispatcher', () => {
        // O dispatcher é opcional de propósito: se o undici sumir do
        // node_modules, a chamada tem que continuar funcionando (só volta ao
        // connect de 10s) em vez de estourar com TypeError.
        const HD = require(path.join(RAIZ, 'utils/httpDispatcher'));
        assert.ok(HD.dispatcher(), 'com undici instalado, o dispatcher deve existir');

        // Simula o undici ausente: intercepta o require dele.
        const Mod = require('module');
        const cache = require.resolve(path.join(RAIZ, 'utils/httpDispatcher'));
        const mod = require.cache[cache];
        delete require.cache[cache];
        const loadOriginal = Mod._load;
        Mod._load = function (req, parent, isMain) {
            if (req === 'undici') { const e = new Error("Cannot find module 'undici'"); e.code = 'MODULE_NOT_FOUND'; throw e; }
            return loadOriginal.call(this, req, parent, isMain);
        };
        try {
            const quebrado = require(path.join(RAIZ, 'utils/httpDispatcher'));
            assert.strictEqual(quebrado.dispatcher(), null, 'sem undici tem que devolver null, não explodir');
            assert.deepStrictEqual(quebrado.fetchOpts(), {}, 'fetchOpts vazio = fetch sem dispatcher');
        } finally {
            Mod._load = loadOriginal;
            delete require.cache[cache];
            if (mod) require.cache[cache] = mod;
        }
    });

    await teste('a cadeia tem no maximo 1 rota (mesmo gateway, outro modelo)', () => {
        const O = carregar();
        const nomes = O.cadeia.map(r => r.nome);
        assert.deepStrictEqual(nomes, ['kilo-alternativa'],
            `cadeia fora de ordem ou com rota a mais/menos: ${JSON.stringify(nomes)}`);
        for (const r of O.cadeia) {
            assert.ok(r.apiKey && r.apiKey.length > 5, `rota ${r.nome} sem chave`);
            assert.ok(r.model, `rota ${r.nome} sem modelo`);
            assert.strictEqual(r.provider, 'kilo', 'todo provedor agora e o Kilo');
        }
    });

    await teste('a cadeia e VAZIA sem KILO_FALLBACK_MODEL', () => {
        // Vazio, e NAO deletado: o dotenv repõe a variavel no process.env
        // quando o config e recarregado, e o teste deixaria de medir o que
        // diz medir.
        process.env.KILO_FALLBACK_MODEL = '';
        for (const k of Object.keys(require.cache)) {
            if (k.includes('KiloClient') || k.includes('/config')) delete require.cache[k];
        }
        const O = require(path.join(RAIZ, 'managers/KiloClient'));
        assert.strictEqual(O.cadeia.length, 0, 'sem modelo alternativo a cadeia tem que ficar vazia');
        assert.strictEqual(O.fallback, null);
    });

    await teste('cadeia percorre ate uma responder: principal cai, alternativa assume', async () => {
        const O = carregar();
        const r = await comFetch(async (url, opts) => {
            if (modeloDa({ corpo: JSON.parse(opts.body) }) === MODELO_ALTERNATIVO) return okContent('veio da alternativa');
            erroRede();
        }, async () => {
            const out = await O.chat({ messages: [{ role: 'user', content: 'oi' }], max_tokens: 100 });
            assert.strictEqual(out, 'veio da alternativa');
        });
        assert.ok(r._chamadas.some(c => modeloDa(c) === MODELO_PRINCIPAL), 'deveria ter tentado o principal primeiro');
        assert.ok(r._chamadas.some(c => modeloDa(c) === MODELO_ALTERNATIVO), 'deveria ter tentado a alternativa depois');
    });

    await teste('cadeia para na primeira que responder (nao gasta as outras)', async () => {
        const O = carregar();
        const r = await comFetch(async (url, opts) => {
            if (modeloDa({ corpo: JSON.parse(opts.body) }) === MODELO_PRINCIPAL) return okContent('veio do principal');
            throw new Error('FALLOU: nao devia chegar na alternativa');
        }, async () => {
            const out = await O.chat({ messages: [{ role: 'user', content: 'oi' }], max_tokens: 100 });
            assert.strictEqual(out, 'veio do principal');
        });
        assert.ok(!r._chamadas.some(c => modeloDa(c) === MODELO_ALTERNATIVO),
            'a cadeia nao devia continuar apos a 1a responder');
    });

    await teste('cadeia inteira fora -> erro final, sem laco', async () => {
        const O = carregar();
        await comFetch(async () => { erroRede(); }, async () => {
            await assert.rejects(
                () => O.chat({ messages: [{ role: 'user', content: 'oi' }], max_tokens: 100 }),
                /ECONNREFUSED|fetch failed|indisponivel/i
            );
        });
    });

    await teste('a rota alternativa tem timeout menor e chave propria', () => {
        const O = carregar();
        assert.ok(O.fallback.timeoutMs <= O.timeoutMs,
            'a alternativa nao pode esperar mais que a principal');
        assert.ok(O.fallback.apiKey && O.fallback.apiKey.length > 5, 'a alternativa precisa da chave');
        assert.strictEqual(O.fallback.baseUrl, O.baseUrl, 'a alternativa usa o mesmo gateway');
    });

    await teste('nenhuma referencia a Ollama ou Groq sobrou no codigo', () => {
        // Varredura no CODIGO (sem comentarios) dos arquivos que fazem chamada
        // de IA. Um "GROQ_API_KEY" esquecido manda a chamada para o gateway
        // sem chave e o bot fica sem IA sem avisar.
        const alvos = [
            'config.js',
            'managers/KiloClient.js',
            'managers/InjectionGuard.js',
            'managers/TierJudge.js',
            'managers/ModerationClassifier.js',
            'utils/IAFallback.js',
            'utils/TaskIA.js',
            'utils/TicketIA.js',
            'utils/ResumoIA.js',
            'utils/httpDispatcher.js',
        ];
        for (const a of alvos) {
            const src = fs.readFileSync(path.join(RAIZ, a), 'utf8');
            const codigo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
            assert.ok(!/OLLAMA_|GROQ_/.test(codigo), `${a} ainda usa OLLAMA_/GROQ_ no codigo`);
        }
    });

    // ============================================================

    global.fetch = fetchReal;
    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou ? 1 : 0);
})();
