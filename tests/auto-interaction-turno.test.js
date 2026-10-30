/**
 * Testes do turno de usuario do AutoInteraction e da deteccao de request
 * degenerado no KiloClient.
 *
 * Contexto do bug: o AutoInteraction mandava `messages: [{role:'system'}]` sem
 * turno 'user'. O modelo devolvia HTTP 200 com finish_reason='load', usage
 * zerada e content vazio em ~150ms — o modelo nunca comecava. O cliente nao lia
 * finish_reason nem usage, entao repetia o request quebrado (tentativas=2) e
 * jogava a culpa no modelo ("resposta sem conteudo valido").
 *
 * Nao usa a internet: o fetch global e substituido por um duble. Roda em menos
 * de 1 segundo.
 *
 *   node tests/auto-interaction-turno.test.js
 */
const assert = require('assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

// Log separado do bot (ver utils/logger.js: LOG_FILE). Sem isto as linhas
// de teste caem no logs/bot-*.log junto com as do bot rodando, e o
// diagnostico fica impossivel: nao da para saber qual processo escreveu.
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


/**
 * Intercepta o fetch e devolve sempre a mesma resposta.
 * Resolve { valor, chamadas }: `valor` e o que a fn devolveu, `chamadas`
 * quantas vezes o fetch foi-stubado (para checar se houve retry).
 */
function comResposta(resposta, fn) {
    const original = global.fetch;
    let chamadas = 0;
    global.fetch = async () => {
        chamadas++;
        return {
            ok: true,
            status: 200,
            json: async () => resposta,
            text: async () => JSON.stringify(resposta),
        };
    };
    return Promise.resolve()
        .then(fn)
        .then((valor) => ({ valor, chamadas }))
        .finally(() => { global.fetch = original; });
}

/**
 * Resposta no formato da OpenAI.
 * `usage` nulo = o daemon nao mandou contagem (nao confunda com zero).
 */
function respostaIA({ content = '', reasoning = '', finish_reason = 'stop', usage = { prompt_tokens: 80, completion_tokens: 141, total_tokens: 221 } }) {
    return { choices: [{ message: { content, reasoning }, finish_reason }], usage };
}

/** Recarrega o KiloClient do zero para pegar um singleton limpo. */
function carregarCliente() {
    for (const k of Object.keys(require.cache)) {
        if (k.includes('KiloClient') || k.includes('config')) delete require.cache[k];
    }
    return require(path.join(RAIZ, 'managers/KiloClient'));
}

/** buildUserTurn e estatico e nao toca rede, mas o require puxa o DB. */
function carregarAI() {
    return require(path.join(RAIZ, 'managers/AutoInteraction'));
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
    const AI = carregarAI();

    // ============================================================
    // buildUserTurn — os 4 contextType de producao
    // ============================================================

    await teste('reply vira turno de user com o texto dito', () => {
        const t = AI.buildUserTurn('reply', { userId: '123', content: 'cria um site pra mim' });
        assert.ok(t.length > 0, 'turno nao pode ser vazio: voltaria ao bug do template');
        assert.ok(t.includes('cria um site pra mim'), `perdido o conteudo: ${t}`);
        assert.ok(t.includes('123'), `perdido o userId: ${t}`);
    });

    await teste('respond_to_message leva o texto do alvo', () => {
        const t = AI.buildUserTurn('respond_to_message', { userId: '9', content: 'oi tudo bem' });
        assert.ok(t.includes('oi tudo bem'), `perdido o conteudo: ${t}`);
        assert.ok(t.includes('9'), `perdido o userId: ${t}`);
    });

    await teste('remember_fact usa username (nao userId) + fact', () => {
        // o chamador em AutoInteraction.js:344 passa {username, fact}, sem userId
        const t = AI.buildUserTurn('remember_fact', { username: 'leo', fact: 'gosta de pizza' });
        assert.ok(t.includes('leo'), `perdido o username: ${t}`);
        assert.ok(t.includes('gosta de pizza'), `perdido o fact: ${t}`);
    });

    await teste('random leva as ultimas mensagens', () => {
        const t = AI.buildUserTurn('random', { lastMessages: 'fulano: ola' });
        assert.ok(t.includes('fulano: ola'), `perdido o historico: ${t}`);
    });

    // ============================================================
    // A divergencia: contextType desconhecido cai no generico
    // ============================================================

    await teste('DIVERGENCIA: tipo desconhecido cai no generico', () => {
        const t = AI.buildUserTurn('tipo_que_nao_existe', { qualquerCoisa: 'x' });
        assert.strictEqual(t, 'Responda ao chat.',
            'um contextType novo precisa cair no default, e o default tem que ser util');
    });

    await teste('DIVERGENCIA: default generico nao carrega o contexto perdido', () => {
        // o default NAO conhece o contextData, entao dados novos ficam de fora.
        // Documentado de proposito: um 5o tipo exige um case explicito.
        const t = AI.buildUserTurn('tipo_novo', { userId: '5', content: 'segredo' });
        assert.ok(!t.includes('segredo'),
            'se o default comecar a vazar contextData, o case explicito virou redundante');
    });

    // ============================================================
    // Turno nunca pode sair vazio, nem com dados faltando
    // ============================================================

    await teste('reply sem content ainda devolve turno nao vazio', () => {
        const t = AI.buildUserTurn('reply', { userId: '7' });
        assert.ok(t.trim().length > 0, 'turno vazio recriaria o bug do template');
    });

    await teste('random sem lastMessages cai no placeholder', () => {
        const t = AI.buildUserTurn('random', {});
        assert.ok(t.includes('nenhuma'), `esperava o placeholder: ${t}`);
    });

    await teste('nenhum contextType produz turno vazio', () => {
        for (const ct of ['reply', 'respond_to_message', 'remember_fact', 'random', 'x', '']) {
            const t = AI.buildUserTurn(ct, {});
            assert.ok(t.trim().length > 0, `contextType "${ct}" devolveu turno vazio`);
        }
    });

    // ============================================================
    // generateResponse manda [system, user] — nunca so [system]
    // ============================================================

    await teste('generateResponse envia turno de user (regressao do bug original)', async () => {
        const orig = AI.generateResponse;
        let visto = null;
        AI.generateResponse = async () => { /* stub: o teste real e o de baixo */ };
        AI.generateResponse = orig;

        // Intercepta o kilo.chat que o AutoInteraction usa
        const mod = require.cache[require.resolve(path.join(RAIZ, 'managers/KiloClient'))];
        const cliente = mod.exports;
        const chatOriginal = cliente.chat.bind(cliente);
        cliente.chat = async (opts) => { visto = opts; return 'frase'; };
        try {
            await AI.generateResponse('guild', 'reply', { userId: '1', content: 'oi' });
        } finally {
            cliente.chat = chatOriginal;
        }
        assert.ok(visto, 'generateResponse nao chamou o kilo.chat');
        assert.strictEqual(visto.messages.length, 2, `esperava 2 mensagens, veio ${visto.messages.length}`);
        assert.strictEqual(visto.messages[0].role, 'system');
        assert.strictEqual(visto.messages[1].role, 'user', 'a 2a mensagem tem que ser user');
        assert.ok(visto.messages[1].content.length > 0, 'turno de user vazio');
    });

    // ============================================================
    // KiloClient: request degenerado e erro claro, sem retry
    // ============================================================

    await teste('finish_reason=load vira erro nomeado em 1 tentativa', async () => {
        const cliente = carregarCliente();
        const degenerado = respostaIA({ content: '', finish_reason: 'load', usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
        const r = await comResposta(degenerado, async () => {
            await assert.rejects(
                () => cliente.chat({ messages: [{ role: 'system', content: 'oi' }], max_tokens: 1200 }),
                /sem turno de 'user'/
            );
        });
        assert.strictEqual(r.chamadas, 1, `repetiu o request quebrado ${r.chamadas}x — antes repetia 2x`);
    });

    await teste('usage zerada sem finish_reason tambem e degenerado', async () => {
        const cliente = carregarCliente();
        const degenerado = respostaIA({ content: '', finish_reason: null, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
        const r = await comResposta(degenerado, async () => {
            await assert.rejects(
                () => cliente.chat({ messages: [{ role: 'system', content: 'oi' }], max_tokens: 1200 }),
                /sem turno de 'user'/
            );
        });
        assert.strictEqual(r.chamadas, 1, `repetiu ${r.chamadas}x`);
    });

    // ============================================================
    // O caminho NORMAL de content vazio nao pode ter regredido
    // ============================================================

    await teste('content vazio com usage real NAO e tratado como degenerado', async () => {
        const cliente = carregarCliente();
        // finish_reason 'length' + usage>0 = o modelo pensou e estourou o orcamento.
        // Esse tem de escalar pro retry com mais tokens, como antes.
        const estourou = respostaIA({ content: '', reasoning: 'pensando...', finish_reason: 'length' });
        let segunda = null;
        const original = global.fetch;
        let n = 0;
        global.fetch = async () => {
            n++;
            return {
                ok: true, status: 200,
                json: async () => (n === 1 ? estourou : respostaIA({ content: 'resposta boa' })),
                text: async () => '{}',
            };
        };
        try {
            const out = await cliente.chat({ messages: [{ role: 'system', content: 'oi' }, { role: 'user', content: 'oi' }], max_tokens: 16000 });
            assert.strictEqual(out, 'resposta boa', 'o retry nao devolveu o content bom');
            assert.strictEqual(n, 2, `esperava 2 chamadas, veio ${n}`);
            segunda = true;
        } finally { global.fetch = original; }
        assert.ok(segunda);
    });

    await teste('ESCALADA nao regride: retry de 16000 pede >= 16000', async () => {
        const cliente = carregarCliente();
        const estourou = respostaIA({ content: '', reasoning: 'pensando...', finish_reason: 'length' });
        const corpos = [];
        const original = global.fetch;
        let n = 0;
        global.fetch = async (_url, opts) => {
            corpos.push(JSON.parse(opts.body));
            n++;
            return {
                ok: true, status: 200,
                json: async () => (n === 1 ? estourou : respostaIA({ content: 'ok' })),
                text: async () => '{}',
            };
        };
        try {
            await cliente.chat({ messages: [{ role: 'system', content: 'oi' }, { role: 'user', content: 'oi' }], max_tokens: 16000 });
        } finally { global.fetch = original; }
        assert.ok(corpos.length >= 2, `esperava 2 requests, veio ${corpos.length}`);
        const retry = corpos[1].max_tokens;
        assert.ok(retry >= 16000,
            `o retry regrediu para ${retry} — antes de 16000 sairia truncado sem erro`);
    });

    await teste('content vazio sem reasoning e sem usage zero mantem a mensagem antiga', async () => {
        const cliente = carregarCliente();
        // finish_reason normal e usage > 0 mas content vazio: nao e degenerado,
        // continua sendo o erro generico (nao regredi a diagnostico).
        const vazio = respostaIA({ content: '   ', finish_reason: 'stop' });
        await comResposta(vazio, async () => {
            await assert.rejects(
                () => cliente.chat({ messages: [{ role: 'system', content: 'oi' }, { role: 'user', content: 'oi' }], max_tokens: 1200 }),
                /resposta sem conteudo valido/
            );
        });
    });

    await teste('resposta valida continua retornando content', async () => {
        const cliente = carregarCliente();
        const r = await comResposta(respostaIA({ content: '  ola tudo bem  ' }), async () => {
            return await cliente.chat({ messages: [{ role: 'system', content: 'oi' }, { role: 'user', content: 'oi' }], max_tokens: 1200 });
        });
        assert.strictEqual(r.valor, 'ola tudo bem', `veio ${JSON.stringify(r.valor)}`);
        assert.strictEqual(r.chamadas, 1);
    });

    global.fetch = fetchReal;
    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou ? 1 : 0);
})();
