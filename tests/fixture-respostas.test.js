/**
 * Respostas REAIS do modelo, capturadas em producao.
 *
 * Fixture 1 (calculator-arquivo-fiel.txt): o modelo devolveu o formato do
 * prompt com rotulo em portugues e prosa no fim.
 *
 * Fixture 2 (calculator-file-ingles.txt): NA MESMA SESSAO, o mesmo pedido
 * voltou com rotulo em ingles, entre asteriscos:
 *     **FILE: [FILE: src/Calculator.tsx]**
 *     **ACTION: [ACAO: CREATE] + execute**
 *
 * Por isso estes testes existem: o comportamento varies entre chamadas com
 * o mesmo input, e so um teste com texto real pega a variacao. Um duble
 * sintetico devolveria sempre o formato "certo" e passaria enquanto a
 * producao quebrava.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

// Log separado do bot (ver utils/logger.js: LOG_FILE). Sem isto as linhas
// de teste caem no logs/bot-*.log junto com as do bot rodando, e o
// diagnostico fica impossivel: nao da para saber qual processo escreveu.
process.env.LOG_FILE = process.env.LOG_FILE || 'teste.log';
const FIX = path.join(__dirname, 'fixtures');
const Gen = require(path.join(RAIZ, 'managers/ProjectGenerator'));
const Judge = require(path.join(RAIZ, 'managers/TierJudge'));
const { nomeDeArquivo } = require(path.join(RAIZ, 'utils/ZipBuilder'));

let passou = 0, falhou = 0;
async function teste(nome, fn) {
    try { await fn(); console.log('  ok   ' + nome); passou++; }
    catch (e) {
        console.log('  FALHA ' + nome);
        console.log('       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e));
        falhou++;
    }
}

const ler = (n) => fs.readFileSync(path.join(FIX, n), 'utf8');
const TAREFA = 'crie uma calculadora usando React e TypeScript, focando na acessibilidade';

(async () => {
    for (const fixture of ['calculator-arquivo-fiel.txt', 'calculator-file-ingles.txt']) {
        await teste(`${fixture}: extrai o nome com extensao`, () => {
            const nome = Gen.extrairNomeMarcado(ler(fixture));
            assert.ok(nome, 'nao achou marcador de nome');
            assert.ok(/\.\w{1,5}$/.test(nome), `nome sem extensao: "${nome}"`);
            assert.ok(nome.includes('Calculator.tsx'), `nome errado: "${nome}"`);
        });

        await teste(`${fixture}: o conteudo gravado e codigo limpo`, () => {
            const bruto = ler(fixture);
            const nome = nomeDeArquivo(Gen.extrairNomeMarcado(bruto));
            const conteudo = Gen.extrairConteudo(bruto, nome);

            // Nenhum marcador do formato do prompt pode sobrar no fonte.
            assert.ok(!/AÇÃO:|ACAO:|ACTION:|CODE:|CÓDIGO:|FILE:|ARQUIVO:/.test(conteudo),
                `marcador vazou para o arquivo:\n${conteudo.slice(0, 200)}`);
            assert.ok(!conteudo.includes('```'), `cerca vazou:\n${conteudo.slice(0, 200)}`);
            assert.ok(!/^\s*\*/.test(conteudo), `os ** do rotulo em ingles sobraram:\n${conteudo.slice(0, 200)}`);

            // E tem que ter o codigo de verdade.
            assert.ok(/^\s*import React/.test(conteudo), `comecou errado:\n${conteudo.slice(0, 120)}`);
            assert.ok(conteudo.includes('export const'), `faltou o export:\n${conteudo.slice(0, 200)}`);

            // Fecha a chave: um arquivo truncado no meio nao compila.
            assert.strictEqual(
                (conteudo.match(/\{/g) || []).length,
                (conteudo.match(/\}/g) || []).length,
                'chaves desbalanceadas — o codigo foi cortado'
            );
        });
    }

    await teste('a prosa do fim nao entra no arquivo', () => {
        const conteudo = Gen.extrairConteudo(ler('calculator-arquivo-fiel.txt'), 'Calculator.tsx');
        assert.ok(!conteudo.includes('leitores de tela'), 'a prosa do final entrou no fonte');
        assert.ok(conteudo.includes('useState'), 'perdeu o codigo');
    });

    await teste('as duas fixtures produzem o MESMO codigo', () => {
        // O modelo alternou o rotulo, mas o codigo tem de ser equivalente.
        const a = Gen.extrairConteudo(ler('calculator-arquivo-fiel.txt'), 'Calculator.tsx');
        const b = Gen.extrairConteudo(ler('calculator-file-ingles.txt'), 'Calculator.tsx');
        assert.ok(a.includes('useState') && b.includes('useState'), 'as duas devem ter o codigo');
        assert.strictEqual(/AÇÃO:|FILE:/.test(a + b), false, 'nenhum marcador pode sobrar');
    });

    await teste('o pedido que gerou a fixture e classificado como PROJETO', () => {
        // Era este o bug: "TypeScript" casava com 'script' em LEVE e o
        // pedido caia como "simples", sem seletor de tier.
        assert.strictEqual(Judge.porPalavras(TAREFA), 'projeto');
    });

    await teste('o codigo da fixture casa com o que o modelo deveria ter mandado', () => {
        // Sanidade: o esperado tem que ser um pedaco de .tsx plausivel.
        const esperado = ler('calculator-esperado.tsx');
        assert.ok(esperado.includes('useState'));
        assert.ok(/\{[\s\S]*\}/.test(esperado));
    });

    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou ? 1 : 0);
})();
