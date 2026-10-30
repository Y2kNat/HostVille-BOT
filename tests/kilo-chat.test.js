/**
 * Testes do utils/kiloChat.js — a porta de entrada única do gateway.
 *
 * Nao usa a internet: o fetch global e substituido por dubles.
 *
 * Cobre os behaviours que MEDIDOS no gateway real obligaram:
 *   - auto-cura quando o modelo recusa `reasoning_effort` (unsupported)
 *   - auto-cura quando o modelo EXIGE raciocinio ("cannot be disabled")
 *   - retry de falha transitoria (rede oscilando, 5xx, 429)
 *   - o dispatcher (connect timeout > 10s do undici)
 *
 *   node tests/kilo-chat.test.js
 */
const assert = require('assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
process.env.LOG_FILE = process.env.LOG_FILE || 'teste.log';
const fetchReal = global.fetch;

let passou = 0, falhou = 0;
async function teste(nome, fn) {
    try { await fn(); console.log('  ok   ' + nome); passou++; }
    catch (e) {
        console.log('  FALHA ' + nome);
        console.log('       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e));
        falhou++;
    }
}

/** Resposta 200 no formato OpenAI. */
function ok(content = 'resposta') {
    return {
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }),
        text: async () => '{}',
    };
}

/** Resposta de erro HTTP com corpo em JSON. */
function httpErro(status, corpo) {
    return {
        ok: false, status,
        json: async () => JSON.parse(corpo),
        text: async () => corpo,
    };
}

/** Troca o fetch global por um duble e restaura no final. */
function comFetch(handler, fn) {
    const original = global.fetch;
    global.fetch = handler;
    return Promise.resolve().then(fn).finally(() => { global.fetch = original; });
}

(async () => {
    const { chat, ErroKilo } = require(path.join(RAIZ, 'utils/kiloChat'));
    const { fetchOpts } = require(path.join(RAIZ, 'utils/httpDispatcher'));

    await teste('envia o corpo com model, messages, temperature e max_tokens', async () => {
        let corpo = null;
        await comFetch(async (_u, o) => { corpo = JSON.parse(o.body); return ok('ok'); }, async () => {
            const r = await chat({
                model: 'provedor/modelo',
                messages: [{ role: 'user', content: 'oi' }],
                temperature: 0.3,
                max_tokens: 1234,
                apiKey: 'chave',
            });
            assert.strictEqual(r.content, 'ok');
        });
        assert.strictEqual(corpo.model, 'provedor/modelo');
        assert.strictEqual(corpo.max_tokens, 1234);
        assert.strictEqual(corpo.temperature, 0.3);
        assert.strictEqual(corpo.reasoning_effort, undefined, 'sem reasoning_effort nao envia o campo');
    });

    await teste('manda o dispatcher (connect timeout > 10s do undici)', async () => {
        // O dispatcher mora dentro do utils/httpDispatcher: o fetch do
        // undici INSTALADO é o que leva o Agent (o global do Node recusa
        // ele — ver o teste do UND_ERR_INVALID_ARG abaixo). Então aqui
        // verificamos que o httpDispatcher existe e entrega o Agent.
        const HD = require(path.join(RAIZ, 'utils/httpDispatcher'));
        assert.ok(HD.dispatcher(), 'o dispatcher tem que existir');
        assert.ok(HD.fetchOpts().dispatcher, 'o fetchOpts tem que entregar o dispatcher');
        assert.strictEqual(typeof HD.fetch, 'function', 'o httpDispatcher tem que exportar o fetch proprio');
    });

    await teste('o fetch GLOBAL do Node nao aceita o Agent do undici INSTALADO', async () => {
        // A regressao que matava TODA chamada de IA no aparelho:
        //
        //   o fetch global do Node usa o undici EMBUTIDO (v7 no Node 24,
        //   v8 no Node 26) e RECUSA o Agent do undici instalado (v6). A
        //   chamada nem saia — e o health check dizia "Gateway nao esta
        //   respondendo" com a IA funcionando.
        //
        // A solucao esta no httpDispatcher: usar o fetch do PROPRIO undici
        // instalado, que e coerente com o Agent dele. Este teste trava o
        // diagnostico comparando os DOIS caminhos: o global falha, o do
        // undici instalado funciona.
        const undici = require('undici');
        const agent = new undici.Agent({ connect: { timeout: 45000 } });
        const url = 'http://127.0.0.1:1/';   // porta fechada: so o connect importa

        let erroGlobal = null;
        try {
            await globalThis.fetch(url, { dispatcher: agent });
        } catch (e) { erroGlobal = e; }

        let erroUndici = null;
        try {
            await undici.fetch(url, { dispatcher: agent });
        } catch (e) { erroUndici = e; }

        // O global pode falhar por qualquer motivo (versao, malformed) —
        // o que importa e que ele NAO funcione com este Agent. O do undici
        // instalado tem que FUNCIONAR com ele (falha so de conexao, que e
        // o esperado para uma porta fechada).
        assert.ok(erroGlobal, 'o fetch global recusou o Agent: a chamada nem saiu (regressao do UND_ERR_INVALID_ARG)');
        const codigoUndici = String((erroUndici && erroUndici.cause && erroUndici.cause.code) || '');
        assert.ok(codigoUndici !== 'UND_ERR_INVALID_ARG',
            `o fetch do undici instalado tambem recusou o Agent: ${codigoUndici}`);
    });

    await teste('auto-cura: modelo recusa reasoning_effort -> repete sem o campo', async () => {
        // MEDIDO: meta-llama/llama-prompt-guard-2-86m nao lista o campo.
        let n = 0;
        let ultimoCorpo = null;
        await comFetch(async (_u, o) => {
            n++;
            const c = JSON.parse(o.body);
            ultimoCorpo = c;
            if (c.reasoning_effort) {
                return httpErro(400, '{"error":{"message":"property \'reasoning_effort\' is unsupported"}}');
            }
            return ok('sem o campo');
        }, async () => {
            const r = await chat({
                model: 'm', messages: [], reasoning_effort: 'high', apiKey: 'chave',
            });
            assert.strictEqual(r.content, 'sem o campo');
        });
        assert.strictEqual(n, 2, 'deveria ter tentado 2x');
        assert.strictEqual(ultimoCorpo.reasoning_effort, undefined, 'a repeticao nao pode levar o campo');
    });

    await teste('auto-cura: modelo EXIGE raciocinio ("cannot be disabled")', async () => {
        // MEDIDO: minimax/minimax-m3.1-flash:free responde 400
        // "Reasoning is mandatory for this endpoint and cannot be disabled."
        // A saida e a mesma: repetir SEM o campo.
        let n = 0;
        await comFetch(async (_u, o) => {
            n++;
            const c = JSON.parse(o.body);
            if (c.reasoning_effort) {
                return httpErro(400, '{"error":{"message":"Reasoning is mandatory for this endpoint and cannot be disabled.","code":400}}');
            }
            return ok('deixou o modelo decidir');
        }, async () => {
            const r = await chat({
                model: 'm', messages: [], reasoning_effort: 'none', apiKey: 'chave',
            });
            assert.strictEqual(r.content, 'deixou o modelo decidir');
        });
        assert.strictEqual(n, 2, 'deveria ter tentado 2x');
    });

    await teste('auto-cura nao entra em laco: so uma repeticao sem o campo', async () => {
        let n = 0;
        await comFetch(async (_u, o) => {
            n++;
            const c = JSON.parse(o.body);
            if (c.reasoning_effort) return httpErro(400, '{"error":{"message":"reasoning_effort unsupported"}}');
            // o campo ja foi removido e ainda assim falha: nao repete mais
            return httpErro(400, '{"error":{"message":"reasoning_effort unsupported"}}');
        }, async () => {
            await assert.rejects(() => chat({
                model: 'm', messages: [], reasoning_effort: 'high', apiKey: 'chave',
            }), /400/);
        });
        assert.strictEqual(n, 2, `deveria ter parado na 2a chamada, houve ${n}`);
    });

    await teste('400 normal (modelo invalido) NAO e repetido', async () => {
        let n = 0;
        await comFetch(async () => {
            n++;
            return httpErro(400, '{"error":{"message":"model not found"}}');
        }, async () => {
            await assert.rejects(() => chat({ model: 'm', messages: [], apiKey: 'chave' }), /400/);
        });
        assert.strictEqual(n, 1, `um 400 de pedido invalido nao deve ser repetido, houve ${n}`);
    });

    await teste('falha de rede e repetida', async () => {
        // A rede do aparelho oscila (EAI_AGAIN, ECONNRESET). O fallback
        // existe justamente para quando a rede cai: sem retry, ele cai junto.
        let n = 0;
        await comFetch(async () => {
            n++;
            if (n < 3) throw new Error('fetch failed');
            return ok('deu certo na 3a');
        }, async () => {
            const r = await chat({ model: 'm', messages: [], apiKey: 'chave' });
            assert.strictEqual(r.content, 'deu certo na 3a');
        });
        assert.strictEqual(n, 3, `deveria ter tentado 3x, houve ${n}`);
    });

    await teste('500 e repetido ate o limite', async () => {
        let n = 0;
        await comFetch(async () => {
            n++;
            return httpErro(500, '{"error":"boom"}');
        }, async () => {
            await assert.rejects(() => chat({ model: 'm', messages: [], apiKey: 'chave' }), /500/);
        });
        assert.ok(n >= 2, `o 500 deveria ser repetido, houve ${n}`);
    });

    await teste('timeout vira erro com status 408', async () => {
        await comFetch(async () => {
            await new Promise(r => setTimeout(r, 100));
            const e = new Error('abortado'); e.name = 'AbortError'; throw e;
        }, async () => {
            await assert.rejects(
                () => chat({ model: 'm', messages: [], apiKey: 'chave', timeoutMs: 10 }),
                (e) => e instanceof ErroKilo && e.status === 408
            );
        });
    });

    await teste('apiKey vazio usa a KILO_API_KEY do config', async () => {
        let auth = null;
        await comFetch(async (_u, o) => { auth = o.headers.Authorization; return ok('x'); }, async () => {
            await chat({ model: 'm', messages: [], apiKey: '' });
        });
        const cfg = require(path.join(RAIZ, 'config'));
        assert.ok(auth && auth.startsWith('Bearer '), 'tem que mandar Authorization');
        assert.strictEqual(auth, `Bearer ${cfg.KILO_API_KEY}`);
    });

    await teste('a chave explicita tem prioridade sobre a do config', async () => {
        let auth = null;
        await comFetch(async (_u, o) => { auth = o.headers.Authorization; return ok('x'); }, async () => {
            await chat({ model: 'm', messages: [], apiKey: 'chave-propria' });
        });
        assert.strictEqual(auth, 'Bearer chave-propria');
    });

    await teste('sem modelo: erro claro, sem chamar a rede', async () => {
        let chamou = false;
        await comFetch(async () => { chamou = true; return ok('x'); }, async () => {
            await assert.rejects(() => chat({ model: '', messages: [], apiKey: 'chave' }), /modelo/i);
        });
        assert.strictEqual(chamou, false, 'nao devia chamar a rede sem modelo');
    });

    global.fetch = fetchReal;
    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou ? 1 : 0);
})();
