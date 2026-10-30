/**
 * Testes do fallback de IA (tickets e taskrunner).
 *
 * Nao usa a internet e nem abre porta: o fetch global e substituido por um
 * duble que finge ser o gateway do Kilo, e o "modelo principal fora do ar"
 * e simulado com uma URL que nao responde. Roda em qualquer maquina, em
 * menos de 1 segundo.
 *
 *   node tests/fallback.test.js
 */
const assert = require('assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

// Grava em log SEPARADO do bot. Sem isto as linhas de teste aparecem no
// logs/bot-*.log junto com as do bot rodando, e o diagnostico fica
// impossivel: nao da para saber qual processo escreveu a linha.
process.env.LOG_FILE = process.env.LOG_FILE || 'teste.log';
const fetchReal = global.fetch;

// Carrega o httpDispatcher ANTES de qualquer troca de global.fetch.
//
// Ele captura o fetch "de verdade" UMA vez por processo (Symbol.for) para
// conseguir distinguir "o fetch global foi trocado por um duble" de "o
// fetch global é o normal". Se ele fosse carregado depois da troca, o
// snapshot seria o duble, a detecção nunca dispararia e a chamada
// escaparia para a rede de verdade — foi o que aconteceu.
require(path.join(RAIZ, 'utils/httpDispatcher'));


//_urls usadas pelos testes
const KILO_URL = 'http://kilo.test/v1';               // duble responde com o gateway
const PRINCIPAL_MORTO = 'http://127.0.0.1:59999/v1';  // ninguem escuta: simula queda

/** Troca o fetch por um duble durante o teste e restaura no final. */
function comKilo(duble, fn) {
    const original = global.fetch;
    global.fetch = async (url, opts) => {
        if (String(url).includes('59999')) {
            // simula o modelo principal fora do ar: conexao recusada, como
            // na vida real
            const e = new Error('fetch failed');
            e.cause = new Error('connect ECONNREFUSED 127.0.0.1:11434');
            throw e;
        }
        return duble(String(url), opts, original);
    };
    return Promise.resolve()
        .then(fn)
        .finally(() => { global.fetch = original; });
}

/** Simula os DOIS modelos fora do ar: toda chamada e recusada. */
function semNenhumModelo(fn) {
    const original = global.fetch;
    global.fetch = async () => {
        const e = new Error('fetch failed');
        e.cause = new Error('connect ECONNREFUSED');
        throw e;
    };
    return Promise.resolve().then(fn).finally(() => { global.fetch = original; });
}

/** Resposta no formato da OpenAI, como o gateway do Kilo devolve. */
function respostaKilo({ content = '', reasoning = '', finish_reason = 'stop' }) {
    return {
        ok: true,
        status: 200,
        json: async () => ({
            choices: [{ message: { content, reasoning }, finish_reason }],
            usage: { completion_tokens_details: { reasoning_tokens: 0 } },
        }),
        text: async () => JSON.stringify({ content }),
    };
}

function carregar(mod, { principalMorto = false } = {}) {
    for (const k of Object.keys(require.cache)) {
        // '/config' também: o config lê o .env no require, e este teste
        // troca o KILO_BASE_URL entre uma chamada e outra. Sem limpá-lo, o
        // cliente continuaria apontando para o gateway de verdade.
        if (k.includes('TaskIA') || k.includes('TicketIA') || k.includes('IAFallback')
            || k.includes('KiloClient') || k.includes('/config')) {
            delete require.cache[k];
        }
    }
    process.env.KILO_BASE_URL = principalMorto ? PRINCIPAL_MORTO : 'http://127.0.0.1:59999/v1';
    process.env.KILO_API_KEY = process.env.KILO_API_KEY || 'chave-de-teste';
    process.env.KILO_DEFAULT_MODEL = process.env.KILO_DEFAULT_MODEL || 'provedor/modelo-de-teste';
    return require(path.join(RAIZ, mod));
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

(async () => {
    // 1) o piso de tokens vence o max_tokens:5 do classificador do TaskRunner
    await teste('MIN_TOKENS vence max_tokens:5 (classificador)', async () => {
        const corpos = [];
        await comKilo(async (url, opts) => {
            corpos.push(JSON.parse(opts.body));
            return respostaKilo({ content: 'SIM' });
        }, async () => {
            process.env.TASK_FALLBACK_BASE_URL = KILO_URL;
            const { Kilo } = carregar('utils/TaskIA');
            const r = await Kilo.chat({ messages: [{ role: 'user', content: 'oi' }], max_tokens: 5 });
            assert.strictEqual(r, 'SIM');
            assert.ok(corpos[0].max_tokens >= 2000, `esperava >=2000, veio ${corpos[0].max_tokens}`);
            // `reasoning_effort` vai AO GATEWAY como está. 'none' = o modelo
            // NÃO raciocina (medido: reasoning_tokens=0, resposta direta).
            assert.strictEqual(corpos[0].reasoning_effort, 'none',
                `deveria pedir reasoning_effort none, veio ${corpos[0].reasoning_effort}`);
        });
    });

    // 2) orcamento esgotado: erro acionavel, e NAO devolve o raciocinio como resposta
    await teste('orcamento esgotado da erro, sem devolver raciocinio', async () => {
        await comKilo(async () => respostaKilo({ content: '', reasoning: 'raciocinio interno...', finish_reason: 'length' }), async () => {
            process.env.TASK_FALLBACK_BASE_URL = KILO_URL;
            const { Kilo } = carregar('utils/TaskIA');
            await assert.rejects(
                () => Kilo.chat({ messages: [{ role: 'user', content: 'oi' }] }),
                (e) => /MAX_TOKENS|MIN_TOKENS/.test(e.message) && !/raciocinio interno/.test(e.message),
            );
        });
    });

    // 3) resposta vazia com finish=stop tambem e erro (nada de devolver lixo)
    await teste('resposta vazia com finish=stop da erro', async () => {
        await comKilo(async () => respostaKilo({ content: '   ' }), async () => {
            process.env.TASK_FALLBACK_BASE_URL = KILO_URL;
            const { Kilo } = carregar('utils/TaskIA');
            await assert.rejects(() => Kilo.chat({ messages: [{ role: 'user', content: 'oi' }] }), /vazia/);
        });
    });

    // 4) modelo principal fora do ar -> o fallback responde
    await teste('modelo principal fora do ar cai no fallback', async () => {
        let chamadas = 0;
        await comKilo(async () => { chamadas++; return respostaKilo({ content: 'resposta do fallback' }); }, async () => {
            process.env.TASK_FALLBACK_BASE_URL = KILO_URL;
            process.env.TASK_FALLBACK_APOS_MS = '3000';
            const { cliente } = carregar('utils/TaskIA', { principalMorto: true });
            const r = await cliente.chat({ messages: [{ role: 'user', content: 'oi' }], contexto: 'teste' });
            assert.strictEqual(r, 'resposta do fallback');
            assert.strictEqual(chamadas, 1, 'o fallback deveria ter sido chamado exatamente 1 vez');
        });
    });

    // 5;os dois fora do ar -> erro, sem resposta inventada
    await teste('os dois modelos fora do ar da erro', async () => {
        await semNenhumModelo(async () => {
            process.env.TASK_FALLBACK_BASE_URL = KILO_URL;
            process.env.TASK_FALLBACK_APOS_MS = '3000';
            const { cliente } = carregar('utils/TaskIA', { principalMorto: true });
            await assert.rejects(
                () => cliente.chat({ messages: [{ role: 'user', content: 'oi' }] }),
                (e) => !/resposta do fallback/.test(String(e.message)),
            );
        });
    });

    // 6) fallback desligado no .env -> erro nao silencioso
    await teste('TASK_FALLBACK_IA=false desliga o fallback', async () => {
        await comKilo(async () => respostaKilo({ content: 'x' }), async () => {
            process.env.TASK_FALLBACK_IA = 'false';
            process.env.TASK_FALLBACK_BASE_URL = KILO_URL;
            const { cliente } = carregar('utils/TaskIA', { principalMorto: true });
            // A rota alternativa do KiloClient tambem precisa estar desligada
            // aqui: com ela ligada, um modelo principal fora do ar se
            // recupera sozinho e nunca chega neste fallback — o teste
            // deixaria de medir o que diz medir. Desliga direto na instancia,
            // porque o config ja foi cacheado com as chaves reais.
            const kilo = require(path.join(RAIZ, 'managers/KiloClient'));
            const cadeia = kilo.cadeia;
            kilo.cadeia = [];
            kilo.fallback = null;
            try {
                await assert.rejects(() => cliente.chat({ messages: [{ role: 'user', content: 'oi' }] }));
            } finally {
                kilo.cadeia = cadeia;
            }
            delete process.env.TASK_FALLBACK_IA;
        });
    });

    // 7) o .env tem as chaves dos dois fallbacks
    await teste('.env tem as chaves de FALLBACK_ e TASK_FALLBACK_', () => {
        const env = require('fs').readFileSync(path.join(RAIZ, '.env'), 'utf8');
        for (const k of [
            'FALLBACK_IA', 'FALLBACK_MODEL', 'FALLBACK_MIN_TOKENS', 'FALLBACK_REASONING_EFFORT', 'FALLBACK_APOS_MS',
            'TASK_FALLBACK_IA', 'TASK_FALLBACK_MODEL', 'TASK_FALLBACK_MIN_TOKENS',
            'TASK_FALLBACK_REASONING_EFFORT', 'TASK_FALLBACK_APOS_MS',
        ]) {
            assert.ok(new RegExp('^' + k + '=', 'm').test(env), `falta ${k} no .env`);
        }
    });

    // 8) o .env tem as 3 chaves do Kilo e nenhuma do Ollama/Groq
    await teste('.env tem KILO_API_KEY, KILO_BASE_URL e KILO_DEFAULT_MODEL', () => {
        const env = require('fs').readFileSync(path.join(RAIZ, '.env'), 'utf8');
        for (const k of ['KILO_API_KEY', 'KILO_BASE_URL', 'KILO_DEFAULT_MODEL']) {
            assert.ok(new RegExp('^' + k + '=', 'm').test(env), `falta ${k} no .env`);
        }
        // Nenhuma chave do/providers antigo pode sobrar: ela daria 401 no
        // gateway e o bot nao avisaria nada.
        for (const k of ['OLLAMA_', 'GROQ_']) {
            assert.ok(!new RegExp('^' + k, 'm').test(env), `sobrou ${k}* no .env`);
        }
    });

    // 9) nenhum chamador ficou no cliente cru (perderia o fallback)
    await teste('todos os chamadores usam o cliente com fallback', () => {
        const fs = require('fs');
        // o TaskRunner chama .chat() direto; os tickets entregam o cliente
        // ao generateValidated, que e quem chama .chat()
        const esperadas = {
            'managers/TaskRunner.js': /clienteTarefa\.chat\(/g,
            'managers/TicketDuvidas.js': /generateValidated\(clienteIA/g,
            'managers/TicketSuporte.js': /generateValidated\(clienteIA/g,
            'managers/TicketAtendimento.js': /generateValidated\(clienteIA/g,
        };
        for (const [a, regex] of Object.entries(esperadas)) {
            const src = fs.readFileSync(path.join(RAIZ, a), 'utf8');
            const cru = (src.match(/\bkilo\.chat\(/g) || []).length;
            assert.strictEqual(cru, 0, `${a} ainda chama kilo.chat() direto (${cru}x) — perde o fallback`);
            assert.ok((src.match(regex) || []).length > 0, `${a} nao usa o cliente com fallback`);
        }
    });

    global.fetch = fetchReal;
    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou ? 1 : 0);
})();
