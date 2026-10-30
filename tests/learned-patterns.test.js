/**
 * Testes dos padrões aprendidos (Fase 2).
 *
 * O ponto central: o bot aprende "onde olhar", nunca "o que responder".
 * Se qualquer coisa aqui virar cache de texto, voltamos ao bot
 * pré-programado que a staff reclamou.
 *
 *   node tests/learned-patterns.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = path.join(os.tmpdir(), 'learnedPatterns-' + process.pid + '.json');
process.env.LEARNED_PATTERNS_FILE = TMP;
const RAIZ = path.join(__dirname, '..');

// Log separado do bot (ver utils/logger.js: LOG_FILE). Sem isto as linhas
// de teste caem no logs/bot-*.log junto com as do bot rodando, e o
// diagnostico fica impossivel: nao da para saber qual processo escreveu.
process.env.LOG_FILE = process.env.LOG_FILE || 'teste.log';
const lp = require(path.join(RAIZ, 'utils/learnedPatterns'));
const { normalize, DEBUG_SCORES, invalidateCache } = require(path.join(RAIZ, 'ai/knowledge-loader'));

const palavras = (q) => normalize(q).split(/[^a-z0-9]+/).filter(w => w.length >= 4);
const apagar = () => { try { fs.unlinkSync(TMP); } catch (e) {} };

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
    try {
        // 1) grava e devolve o boost certaino
        await teste('record guarda o padrão e devolve boost', () => {
            lp.record(palavras('quantos veiculos posso ter'), ['vehix-limites-e-tiers']);
            const b = lp.boostsFor(palavras('quantos veiculos posso ter'));
            assert.ok(b.get('vehix-limites-e-tiers') > 0, 'deveria dar boost no doc aprendido');
        });

        // 2) o boost só vale para a pergunta parecida
        await teste('boost não vaza para pergunta diferente', () => {
            const b = lp.boostsFor(palavras('como apago um carro'));
            assert.ok(!b.get('vehix-limites-e-tiers'), 'boost vazou para outra pergunta');
        });

        // 3) uma palavra em comum não cria padrão
        await teste('palavra em comum não gera boost', () => {
            lp.record(palavras('onde fica o painel de vehiculos'), ['tickets-painel']);
            const b = lp.boostsFor(palavras('como deletar veiculo'));
            assert.ok(!b.get('tickets-painel'), 'boost criado por coincidência de uma palavra');
        });

        // 4) NÃO guarda resposta: só documentos
        await teste('o padrão guarda documentos, nunca texto de resposta', () => {
            lp.record(palavras('teste de guardar doc'), ['x-doc']);
            const bruto = fs.readFileSync(TMP, 'utf8');
            assert.ok(!/resposta|texto|content/i.test(bruto), 'o arquivo guardou algo que parece resposta');
            const d = JSON.parse(bruto);
            for (const v of Object.values(d)) {
                assert.ok(Array.isArray(v.docIds) && typeof v.hits === 'number' && typeof v.validadoEm === 'number',
                    'formato do padrão inesperado: ' + JSON.stringify(v));
            }
        });

        // 5) exige 2+ tokens e 1+ documento
        await teste('record ignora entrada insuficiente', () => {
            assert.strictEqual(lp.record([], ['doc']), false, 'sem palavras');
            assert.strictEqual(lp.record(['uma'], ['doc']), false, '1 token só');
            assert.strictEqual(lp.record(palavras('pergunta valida aqui'), []), false, 'sem documento');
        });

        // 6) desempata um ranking que estava empatado
        await teste('boost desempata ranking empatado', () => {
            apagar();
            const q = 'quantos veiculos posso ter';
            const antes = DEBUG_SCORES(q).scores.filter(s => s.score > 0);
            const empate = antes.filter(s => s.score === antes[0].score).length;
            assert.ok(empate > 1, 'o caso de teste não está empatado, ajuste a query');

            for (let i = 0; i < 3; i++) lp.record(palavras(q), ['vehix-limites-e-tiers']);
            invalidateCache();
            const depois = DEBUG_SCORES(q).scores.filter(s => s.score > 0);
            assert.strictEqual(depois[0].id, 'vehix-limites-e-tiers', 'o doc aprendido deveria ter subido');
        });

        // 7) o peso satura: 50 acertos não viram monopólio
        await teste('peso satura e não vira monopólio', () => {
            apagar();
            const q = 'quantos veiculos posso ter';
            for (let i = 0; i < 50; i++) lp.record(palavras(q), ['vehix-limites-e-tiers']);
            const b = lp.boostsFor(palavras(q));
            assert.ok(b.get('vehix-limites-e-tiers') <= 4, 'boost passou do teto: ' + b.get('vehix-limites-e-tiers'));
        });

        // 8) prune remove padrão velho
        await teste('prune remove padrão vencido', () => {
            apagar();
            lp.record(palavras('padrao antigo aqui'), ['doc-antigo']);
            const d = lp.load();
            const k = Object.keys(d)[0];
            d[k].validadoEm = Date.now() - 999 * 24 * 60 * 60 * 1000; // 999 dias
            fs.writeFileSync(TMP, JSON.stringify(d, null, 2));
            lp.load(); // recarrega
            const removidos = lp.prune(lp.load());
            assert.ok(removidos > 0, 'deveria remover o padrão vencido');
        });

        // 9) stats reflete o uso
        await teste('stats mostra os padrões mais usados', () => {
            apagar();
            lp.record(palavras('primeira pergunta aqui'), ['a']);
            lp.record(palavras('primeira pergunta aqui'), ['a']);
            const s = lp.stats();
            assert.strictEqual(s.padroes, 1);
            assert.strictEqual(s.acertosTotal, 2);
            assert.ok(s.maisUsados[0].hits === 2);
        });

        // 10) arquivo corrompido não derruba o bot
        await teste('arquivo corrompido vira memória vazia, sem exceção', () => {
            fs.writeFileSync(TMP, '{ isso nao é json');
            assert.deepStrictEqual(lp.load(), {});
            assert.ok(lp.boostsFor(palavras('qualquer coisa')) instanceof Map);
        });
    } finally {
        apagar();
    }

    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou ? 1 : 0);
})();
