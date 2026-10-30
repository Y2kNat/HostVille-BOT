/**
 * Regressões do validador de respostas.
 *
 * Cada caso aqui é um bug que reprovou uma resposta CORRETA e mandou o
 * ticket para a staff. São casos reais de produção, não inventados.
 *
 *   node tests/validador.test.js
 */
const assert = require('assert');
const path = require('path');

// Log separado do bot (ver utils/logger.js: LOG_FILE). Sem isto as linhas
// de teste caem no logs/bot-*.log junto com as do bot rodando, e o
// diagnostico fica impossivel: nao da para saber qual processo escreveu.
process.env.LOG_FILE = process.env.LOG_FILE || 'teste.log';
const { buildContext } = require(path.join(__dirname, '..', 'ai/knowledge-loader'));
const v = require(path.join(__dirname, '..', 'ai/ResponseValidator'));

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
    const apagar = buildContext('como apago um carro meu?');
    const tiers = buildContext('quantos veiculos pessoais posso ter?');

    // 1) ID de canal sem <# >: corrigido, não reprovado
    await teste('ID de canal sem sinais vira menção em vez de ser rejeitado', () => {
        const cru = 'Para apagar, acesse o canal #1553042999720542218 (retirada) e use o botão.';
        const corrigido = v.fixBareChannelIds(cru);
        assert.ok(corrigido.includes('<#1553042999720542218>'), 'o ID deveria virar menção: ' + corrigido);
        const r = v.validate(corrigido, {
            question: 'como apago um carro meu',
            context: apagar.context, docs: apagar.docs, extraSource: apagar.context,
        });
        assert.ok(r.valid, 'deveria aceitar: ' + (r.reason || ''));
    });

    // 1b) o conserto não duplica menção que já está correta
    await teste('consertar ID não duplica menção já formatada', () => {
        const certo = 'Vá no canal <#1553042999720542218> para retirar.';
        assert.strictEqual(v.fixBareChannelIds(certo), certo);
    });

    // 1c) números dentro de menção não entram na lista de números
    await teste('extractNumbers ignora snowflake de menção', () => {
        const nums = v.extractNumbers('canal <#1553042999720542218> e limite 3');
        assert.ok(nums.has(3), 'o 3 do limite deve estar');
        assert.ok(!nums.has(1553042999720542218), 'o snowflake nao deveria virar numero de conteudo');
    });

    // 2) ... mas mentioned canal que não existe na KB continua barrado
    await teste('canal inventado continua barrado', () => {
        const r = v.validate('Acesse o canal <#111111111111111111> para isso.', {
            context: apagar.context, docs: apagar.docs, extraSource: apagar.context,
        });
        assert.ok(!r.valid, 'canal inventado nao deveria passar');
    });

    // 3) número dentro de menção não vira "número inventado"
    await teste('snowflake dentro de menção não conta como número inventado', () => {
        const r = v.validate('Use o botão no canal <#1553042999720542218>. O limite é 3 por semana.', {
            question: 'como apago um carro meu',
            context: apagar.context, docs: apagar.docs, extraSource: apagar.context,
        });
        assert.ok(r.valid, 'deveria aceitar: ' + (r.reason || ''));
    });

    // 4) número inventado continua barrado
    await teste('número inventado continua barrado', () => {
        const r = v.validate('O tier 1 permite 37 veículos pessoais.', {
            question: 'quantos veiculos pessoais posso ter',
            context: tiers.context, docs: tiers.docs, extraSource: tiers.context,
        });
        assert.ok(!r.valid, 'numero inventado nao deveria passar');
    });

    // 5) nome de botão documentado não vira "comando sem prefixo"
    await teste('nome de botão documentado não é tratado como comando solto', () => {
        const r = v.validate('Clique no botão "Deletar um veículo" no painel de retirada.', {
            question: 'como apago um carro meu',
            context: apagar.context, docs: apagar.docs, extraSource: apagar.context,
        });
        assert.ok(r.valid, 'deveria aceitar: ' + (r.reason || ''));
    });

    // 6) comando real sem prefixo continua barrado
    await teste('comando real sem prefixo continua barrado', () => {
        const r = v.validate('Execute deletar <id> para remover o veículo.', {
            question: 'como deletar um veiculo',
            context: apagar.context, docs: apagar.docs, extraSource: apagar.context,
        });
        assert.ok(!r.valid, 'comando sem prefixo nao deveria passar');
    });

    // 7) resposta em etapas, com fluxo documentado na KB, é aceita
    await teste('resposta em etapas com fluxo na KB é aceita', () => {
        const passos = [
            'Para remover o seu veículo:',
            '1. Acesse o canal <#1553042999720542218> (retirada).',
            '2. Clique no botão "Deletar um veículo".',
            '3. Escolha o tipo, selecione o veículo e confirme.',
            '',
            'A ação é permanente e o limite é 3 por semana.',
        ].join('\n');
        const r = v.validate(passos, {
            question: 'como apago um carro meu',
            context: apagar.context, docs: apagar.docs, extraSource: apagar.context,
        });
        assert.ok(r.valid, 'deveria aceitar: ' + (r.reason || ''));
    });

    // 8) não existe mais a regra de "mais passos que o conhecimento"
    await teste('a regra de contagem de passos não existe mais', () => {
        const src = require('fs').readFileSync(path.join(__dirname, '..', 'ai/ResponseValidator.js'), 'utf8');
        assert.ok(!/criou \d+ passos|passos sendo que/.test(src),
            'a regra de contagem de passos foi removida de proposito');
    });

    // 9) as regras precisas continuam no lugar
    await teste('as regras exatas continuam barrando invenção', () => {
        const r = v.validate('Use o comando /telar na loja para isso.', {
            context: apagar.context, docs: apagar.docs, extraSource: apagar.context,
        });
        assert.ok(!r.valid, 'comando com barra inexistente nao deveria passar');
    });

    // 10) o log mostra a regra que disparou, não só o hint
    await teste('o log de recusa mostra a regra crua', () => {
        const src = require('fs').readFileSync(path.join(__dirname, '..', 'ai/ResponseValidator.js'), 'utf8');
        assert.ok(/regra=\$\{v\.reason\}/.test(src),
            'o log precisa mostrar o motivo cru, senao nao da para depurar');
    });

    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou ? 1 : 0);
})();
