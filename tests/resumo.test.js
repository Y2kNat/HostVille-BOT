/**
 * Testes do utils/ResumoIA.js — o resumo do atendimento.
 *
 * Nao usa a internet: o fetch global e substituido por dubles.
 *
 * O ponto central é o PARSE: o modelo escreve "Solução aplicada:" com o
 * acento no C (ç). O padrão antigo (`soluc[aã]o`) só aceitava "solucao"/
 * "solucão" — com "Solução" a linha NUNCA era extraída e o ticket ficava
 * sem resumo de IA. Este teste existe para o padrão não voltar atrás.
 *
 *   node tests/resumo.test.js
 */
const assert = require('assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
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
    const { ResumoIA, parse } = require(path.join(RAIZ, 'utils/ResumoIA'));

    // ============================================================
    // PARSE: os formatos que o modelo realmente devolve
    // ============================================================

    await teste('parse: "Solução aplicada" COM acento no ç', () => {
        // Regressao real: o modelo escreve "Solução" (ç no C) e o padrão
        // antigo nao casava — a linha inteira caia dentro de "problema".
        const r = parse('Problema relatado: nao consigo registrar veiculo\nSolução aplicada: Use /register no painel.');
        assert.ok(r, 'o parse falhou');
        assert.strictEqual(r.problema, 'nao consigo registrar veiculo');
        assert.strictEqual(r.solucao, 'Use /register no painel.');
    });

    await teste('parse: "Solucao aplicada" SEM acento', () => {
        const r = parse('Problema relatado: nao consigo registrar veiculo\nSolucao aplicada: Use /register no painel.');
        assert.ok(r);
        assert.strictEqual(r.problema, 'nao consigo registrar veiculo');
        assert.strictEqual(r.solucao, 'Use /register no painel.');
    });

    await teste('parse: "Solução" com maiuscula e \r\n', () => {
        const r = parse('Problema relatado: erro no painel\r\nSolução aplicada: reiniciado o bot');
        assert.ok(r);
        assert.strictEqual(r.problema, 'erro no painel');
        assert.strictEqual(r.solucao, 'reiniciado o bot');
    });

    await teste('parse: so uma das duas linhas', () => {
        const r = parse('Problema relatado: usuario nao consegue entrar');
        assert.ok(r);
        assert.strictEqual(r.problema, 'usuario nao consegue entrar');
        assert.strictEqual(r.solucao, '');
    });

    await teste('parse: texto sem os rotulos devolve null', () => {
        assert.strictEqual(parse('o usuario resolveu o problema sozinho'), null);
        assert.strictEqual(parse(''), null);
        assert.strictEqual(parse(null), null);
    });

    await teste('parse: remove <think> e aspas', () => {
        const r = parse('<think>pensando</think>\n"Problema relatado: x"\n"Solução aplicada: y"');
        assert.ok(r);
        assert.strictEqual(r.problema, 'x');
        assert.strictEqual(r.solucao, 'y');
    });

    // ============================================================
    // gerar(): contrato com a API
    // ============================================================

    await teste('gerar: devolve problema e solucao', async () => {
        const original = global.fetch;
        let corpo = null;
        global.fetch = async (_u, o) => {
            corpo = JSON.parse(o.body);
            return {
                ok: true, status: 200,
                json: async () => ({ choices: [{ message: { content: 'Problema relatado: A\nSolução aplicada: B' }, finish_reason: 'stop' }] }),
                text: async () => '{}',
            };
        };
        try {
            const r = await ResumoIA.gerar('alguem: oi\nbot: ola');
            assert.ok(r);
            assert.strictEqual(r.problema, 'A');
            assert.strictEqual(r.solucao, 'B');
            // PISO de tokens: sem ele o modelo de raciocinio queima o
            // orçamento e a resposta volta VAZIA (medido no gateway).
            assert.ok(corpo.max_tokens >= 600, `piso de tokens ausente: ${corpo.max_tokens}`);
            // Resumo é EXTRAÇÃO: não deve raciocinar.
            assert.strictEqual(corpo.reasoning_effort, 'none',
                `o resumo nao deve raciocinar, veio ${corpo.reasoning_effort}`);
        } finally {
            global.fetch = original;
        }
    });

    await teste('gerar: resposta em formato inesperado devolve null', async () => {
        const original = global.fetch;
        global.fetch = async () => ({
            ok: true, status: 200,
            json: async () => ({ choices: [{ message: { content: 'nao segue o formato' }, finish_reason: 'stop' }] }),
            text: async () => '{}',
        });
        try {
            assert.strictEqual(await ResumoIA.gerar('alguem: oi'), null);
        } finally {
            global.fetch = original;
        }
    });

    await teste('gerar: falha de rede devolve null (nao estoura)', async () => {
        const original = global.fetch;
        global.fetch = async () => { throw new Error('fetch failed'); };
        try {
            assert.strictEqual(await ResumoIA.gerar('alguem: oi'), null);
        } finally {
            global.fetch = original;
        }
    });

    await teste('gerar: transcricao vazia nao chama a API', async () => {
        const original = global.fetch;
        let chamou = false;
        global.fetch = async () => { chamou = true; throw new Error('nao devia chamar'); };
        try {
            assert.strictEqual(await ResumoIA.gerar('   '), null);
            assert.strictEqual(chamou, false);
        } finally {
            global.fetch = original;
        }
    });

    global.fetch = fetchReal;
    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou ? 1 : 0);
})();
