/**
 * Testes do Auto-KB (Fase 3) e da memória de conversa (Fase 4).
 *
 * O foco é o filtro: uma proposta ruim entra na KB como se fosse verdade,
 * então o descarte tem que ser mais rigoroso que a proposta.
 *
 *   node tests/auto-kb-miner.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = path.join(os.tmpdir(), 'autokb-miner-' + process.pid + '.json');
process.env.CHAT_MEMORY_FILE = TMP;
const RAIZ = path.join(__dirname, '..');

// Log separado do bot (ver utils/logger.js: LOG_FILE). Sem isto as linhas
// de teste caem no logs/bot-*.log junto com as do bot rodando, e o
// diagnostico fica impossivel: nao da para saber qual processo escreveu.
process.env.LOG_FILE = process.env.LOG_FILE || 'teste.log';

const { minerar, eLixo, extrairPerguntasRespostas } = require(path.join(RAIZ, 'managers/AutoKBMiner'));
const ChatMemory = require(path.join(RAIZ, 'managers/ChatMemory'));
const { findRelevantDocs, cobreConhecimento } = require(path.join(RAIZ, 'ai/knowledge-loader'));

function memoria(pares) {
    const msgs = [];
    pares.forEach(([p, r]) => {
        msgs.push({ user: 'alguem', content: p, timestamp: Date.now() });
        msgs.push({ user: 'HostBot', content: r, timestamp: Date.now() });
    });
    fs.writeFileSync(TMP, JSON.stringify({ '999': { messages: msgs, lastSeen: Date.now() } }));
    return ChatMemory;
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
    try {
        // --- o filtro que descarta lixo -------------------------------
        await teste('descarta saudação, teste, emoji e resposta vazia', () => {
            for (const t of ['oi', 'bom dia', 'teste', 'vlw', '😀😀', '', '   ']) {
                assert.ok(eLixo(t), 'deveria descartar: ' + JSON.stringify(t));
            }
        });

        await teste('descarta dado pessoal', () => {
            const pii = [
                'qual o meu cpf 123.456.789-00 aqui',
                'meu email e jogador@teste.com',
                'meu telefone e (11) 98765-4321',
                'a senha do servidor e: segredo123',
            ];
            for (const t of pii) {
                assert.match(String(eLixo(t)), /dado pessoal/, 'não pegou PII: ' + t);
            }
        });

        await teste('descarta pergunta curta demais', () => {
            assert.ok(eLixo('qual o tiers'));
            assert.ok(eLixo('x'));
        });

        await teste('NÃO descarta pergunta de verdade', () => {
            assert.strictEqual(eLixo('como apago meu carro'), null);
            assert.strictEqual(eLixo('onde fica o painel de veiculos'), null);
        });

        // --- cobertura da KB -----------------------------------------
        await teste('a KB é reconhecida como cobertura', () => {
            for (const q of ['quantos veiculos posso ter', 'como apago um carro', 'qual o teto do tier 3']) {
                assert.ok(cobreConhecimento(q, findRelevantDocs(q, 3)), 'deveria cobrir: ' + q);
            }
        });

        await teste('assunto que a KB não cobre é lacuna', () => {
            for (const q of ['onde fica a vitrine de artes', 'como recupero um bonus de festival', 'como troco meu telefone']) {
                assert.ok(!cobreConhecimento(q, findRelevantDocs(q, 3)), 'não deveria cobrir: ' + q);
            }
        });

        // --- mineração ------------------------------------------------
        await teste('agrupa a mesma lacuna com palavras diferentes', () => {
            memoria([
                ['como recupero um bonus de festival', 'Volta no domingo.'],
                ['como eu recupero o bonus de festival', 'Volta no domingo.'],
                ['recupero bonus de festival como', 'Volta domingo.'],
            ]);
            const r = minerar();
            assert.strictEqual(r.propostas.length, 1, 'deveria virar 1 proposta');
            assert.strictEqual(r.propostas[0].freq, 3, 'contagem errada');
        });

        await teste('uma vez só não vira proposta (minRepetitions)', () => {
            memoria([['como recupero um bonus de festival', 'Volta no domingo.']]);
            assert.strictEqual(minerar().propostas.length, 0, '1 vez não pode virar proposta');
        });

        await teste('não propõe pergunta que a KB já cobre', () => {
            memoria([
                ['quantos veiculos posso ter', '3 no tier 1.'],
                ['quantos veiculos posso ter', '3 no tier 1.'],
                ['quantos veiculos posso ter', '3 no tier 1.'],
            ]);
            const r = minerar();
            assert.strictEqual(r.propostas.length, 0, 'a KB já cobre, não deveria propor');
            assert.ok(r.descartes['KB já cobre'] >= 3, 'deveria contar como coberto');
        });

        await teste('não propõe quando a resposta foi "vou chamar staff"', () => {
            memoria([
                ['como recupero um bonus de festival', 'Vou chamar um staff'],
                ['como recupero um bonus de festival', 'Vou chamar um staff'],
                ['como recupero um bonus de festival', 'Vou chamar um staff'],
            ]);
            const r = minerar();
            assert.strictEqual(r.propostas.length, 0, 'propor a própria admissão de falha seria aprender o erro');
        });

        await teste('mistura de lixo + lacuna: só a lacuna vira proposta', () => {
            memoria([
                ['oi', 'Oi!'],
                ['teste', 'ok'],
                ['meu cpf 123.456.789-00', 'não sei'],
                ['😀', 'oi'],
                ['como recupero um bonus de festival', 'Volta domingo.'],
                ['como recupero um bonus de festival', 'Volta domingo.'],
                ['quantos veiculos posso ter', '3 no tier 1.'],
            ]);
            const r = minerar();
            assert.strictEqual(r.propostas.length, 1);
            assert.ok(/festival/.test(r.propostas[0].chave), 'a proposta errada passou');
        });

        // --- extração de pares ----------------------------------------
        await teste('só conta par pergunta -> resposta do bot', () => {
            const pares = extrairPerguntasRespostas({
                c1: { messages: [
                    { user: 'a', content: 'pergunta 1', timestamp: 1 },
                    { user: 'HostBot', content: 'resposta 1', timestamp: 2 },
                    { user: 'HostBot', content: 'outro bot', timestamp: 3 },
                    { user: 'b', content: 'pergunta 2', timestamp: 4 },
                ] },
            });
            // só (pergunta 1 -> resposta 1): a mensagem seguinte é do bot
            // (não é pergunta) e "pergunta 2" não tem resposta depois
            assert.strictEqual(pares.length, 1, 'pares: ' + JSON.stringify(pares.map(p => p.pergunta)));
            assert.strictEqual(pares[0].pergunta, 'pergunta 1');
            assert.strictEqual(pares[0].resposta, 'resposta 1');
        });

        // --- ChatMemory endurecido (Fase 4) ---------------------------
        await teste('ChatMemory corrompido recupera do .bak', () => {
            const CM = memoria([['pergunta valida aqui', 'resposta valida aqui']]);
            CM.remember('c1', 'alguem', 'mensagem para gerar o bak');
            CM.flush();
            fs.copyFileSync(TMP, TMP + '.bak');
            fs.writeFileSync(TMP, '{ json quebrado');
            const dados = CM.load();
            assert.ok(Object.keys(dados).length > 0, 'deveria ter recuperado do .bak');
        });

        await teste('ChatMemory sem .bak e corrompido não derruba', () => {
            fs.writeFileSync(TMP, 'nao é json');
            try { fs.unlinkSync(TMP + '.bak'); } catch (e) {}
            assert.deepStrictEqual(ChatMemory.load(), {});
        });

        await teste('debounce agrupa escritas e o flush grava', () => {
            const CM = memoria([]);
            for (let i = 0; i < 50; i++) CM.remember('cx', 'a', 'mensagem numero ' + i);
            const antes = fs.existsSync(TMP) ? fs.statSync(TMP).mtimeMs : 0;
            CM.flush(); // força
            assert.ok(fs.existsSync(TMP), 'o flush deveria gravar');
            const dados = JSON.parse(fs.readFileSync(TMP, 'utf8'));
            assert.ok(dados.cx, 'canal cx deveria existir');
            assert.ok(dados.cx.messages.length <= 40, 'deveria respeitar o teto de 40');
        });

        await teste('prune remove canal sem atividade', () => {
            const CM = memoria([['pergunta antiga', 'resposta antiga']]);
            const dados = CM.load();
            dados.c1 = { messages: [{ user: 'x', content: 'velho', timestamp: 1 }], lastSeen: 1 };
            dados.c2 = { messages: [{ user: 'x', content: 'novo', timestamp: Date.now() }], lastSeen: Date.now() };
            CM.save(dados);
            const removidos = CM.prune();
            assert.ok(removidos >= 1, 'deveria remover o canal antigo');
            assert.ok(CM.load().c1 === undefined, 'c1 (antigo) deveria ter saído');
            assert.ok(CM.load().c2 !== undefined, 'c2 (novo) deveria ficar');
        });
    } finally {
        try { fs.unlinkSync(TMP); } catch (e) {}
        try { fs.unlinkSync(TMP + '.bak'); } catch (e) {}
    }

    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou ? 1 : 0);
})();
