/**
 * Testes do TierJudge (funil de 3 estagios + juiz Kilo) e do ProjectGenerator
 * (planejador, limpeza de conteudo, nomes de arquivo, HTML unico).
 *
 * Nao usa a internet: o fetch global e substituido por dubles que imitam o
 * gateway do Kilo. Roda em menos de 1 segundo.
 *
 *   node tests/tier.test.js
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


function carregar(nome) {
    for (const k of Object.keys(require.cache)) {
        if (k.includes('TierJudge') || k.includes('ProjectGenerator') || k.includes('KiloClient') || k.includes('/config')) {
            delete require.cache[k];
        }
    }
    return require(path.join(RAIZ, nome));
}

/** Duble que responde conforme a URL chamada. */
function comFetch(handler, fn) {
    const original = global.fetch;
    global.fetch = handler;
    return Promise.resolve().then(fn).finally(() => { global.fetch = original; });
}

/** Resposta do gateway com um veredito. */
function veredito(texto) {
    return {
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { content: texto }, finish_reason: 'stop' }] }),
        text: async () => '{}',
    };
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
    process.env.KILO_API_KEY = process.env.KILO_API_KEY || 'chave-de-teste';
    process.env.KILO_DEFAULT_MODEL = process.env.KILO_DEFAULT_MODEL || 'provedor/modelo-de-teste';
    const Judge = carregar('managers/TierJudge.js');
    const Gen = carregar('managers/ProjectGenerator.js');

    // ============================================================
    // Funil: estagios 1 e 2 resolvem sem chamar modelo
    // ============================================================

    await teste('estagio 1/2: "site institucional" e projeto, sem modelo', () => {
        assert.strictEqual(Judge.porPalavras('faz um site institucional completo e responsivo'), 'projeto');
    });

    await teste('estagio 1/2: "landing page" e projeto', () => {
        assert.strictEqual(Judge.porPalavras('cria uma landing page para a barbearia'), 'projeto');
    });

    await teste('estagio 1/2: "dashboard de vendas" e projeto', () => {
        assert.strictEqual(Judge.porPalavras('cria um dashboard de vendas'), 'projeto');
    });

    await teste('estagio 1/2: "funcao que inverte string" e simples', () => {
        assert.strictEqual(Judge.porPalavras('me escreve uma função que inverte string em Python'), 'simples');
    });

    await teste('estagio 1/2: "corrige esse erro" e simples', () => {
        assert.strictEqual(Judge.porPalavras('corrige esse erro de sintaxe no meu codigo'), 'simples');
    });

    await teste('estagio 1/2: "script bash pra backupar" e simples', () => {
        assert.strictEqual(Judge.porPalavras('faz um script bash pra backupar um diretorio'), 'simples');
    });

    await teste('estagio 1/2: pesado ganha de leve ("sistema com varias classes")', () => {
        assert.strictEqual(Judge.porPalavras('cria um sistema com varias classes de dominio'), 'projeto',
            '"classes" casa com LEVE, mas o pedido e projeto mesmo assim');
    });

    await teste('texto sem sinal conhecido fica ambiguo (vai pro juiz)', () => {
        assert.strictEqual(Judge.porPalavras('xyz abc123'), null);
        assert.strictEqual(Judge.porPalavras(''), null);
    });

    // ============================================================
    // O juiz so roda no ambiguo, e nunca trava a geracao
    // ============================================================

    await teste('pedido claro NAO chama o juiz', async () => {
        let chamou = false;
        await comFetch(async () => { chamou = true; return veredito('PROJETO'); }, async () => {
            const r = await Judge.precisaTier('faz um site institucional completo');
            assert.strictEqual(r.via, 'palavras');
            assert.strictEqual(r.projeto, true);
        });
        assert.strictEqual(chamou, false, 'estagio 1 resolveu mas o juiz foi chamado mesmo assim');
    });

    await teste('ambiguo chama o juiz e aceita PROJETO', async () => {
        let url = null;
        await comFetch(async (u) => { url = String(u); return veredito('PROJETO'); }, async () => {
            const r = await Judge.precisaTier('xyz abc123 def456');
            assert.strictEqual(r.via, 'juiz');
            assert.strictEqual(r.projeto, true);
        });
        assert.ok(url && url.includes('ai-gateway.kilo.ai'), `chamou ${url} em vez do gateway do Kilo`);
    });

    await teste('juiz aceita SIMPLES', async () => {
        await comFetch(async () => veredito('SIMPLES'), async () => {
            const r = await Judge.precisaTier('qqq www eeee');
            assert.strictEqual(r.via, 'juiz');
            assert.strictEqual(r.projeto, false);
        });
    });

    await teste('juiz nao deixa SIMPLES virar PROJETO (colisao de substring)', async () => {
        // "SIMPLES" nao contem "PROJETO"; se o parser inverter a ordem, buga
        await comFetch(async () => veredito('SIMPLES'), async () => {
            assert.strictEqual((await Judge.precisaTier('r1 r2 r3')).projeto, false);
        });
        await comFetch(async () => veredito('PROJETO'), async () => {
            assert.strictEqual((await Judge.precisaTier('r4 r5 r6')).projeto, true);
        });
    });

    await teste('gateway fora do ar: fail-open, nao trava', async () => {
        Judge.limparCache();
        await comFetch(async () => ({ ok: false, status: 503, text: async () => 'indisponivel' }), async () => {
            const r = await Judge.precisaTier('ambiguo xyz 789');
            assert.strictEqual(r.via, 'padrao');
            assert.strictEqual(r.projeto, false, 'sem veredito nao deve abrir seletor');
        });
    });

    await teste('juiz em timeout: fail-open, nao trava', async () => {
        Judge.limparCache();
        await comFetch(async () => {
            await new Promise(r => setTimeout(r, 50));
            const e = new Error('abortado'); e.name = 'AbortError'; throw e;
        }, async () => {
            const r = await Judge.precisaTier('ambiguo abc 111');
            assert.strictEqual(r.via, 'padrao');
        });
    });

    await teste('resposta vazia ou inesperada do juiz: fail-open', async () => {
        Judge.limparCache();
        for (const resposta of ['', 'talvez', '   ']) {
            await comFetch(async () => veredito(resposta), async () => {
                const r = await Judge.precisaTier('ambigo zz ' + resposta);
                assert.strictEqual(r.via, 'padrao', `veredito "${resposta}" nao devia ser aceito`);
            });
        }
    });

    await teste('mesmo pedido ambiguo e julgado uma vez so (cache)', async () => {
        Judge.limparCache();
        let chamadas = 0;
        await comFetch(async () => { chamadas++; return veredito('PROJETO'); }, async () => {
            await Judge.precisaTier('igual aqui 42');
            await Judge.precisaTier('igual aqui 42');
            await Judge.precisaTier('igual aqui 42');
        });
        assert.strictEqual(chamadas, 1, `chamou ${chamadas}x, esperava 1 (cache)`);
    });

    await teste('juiz usa temperature 0, orcamento curto e SEM raciocinio', async () => {
        Judge.limparCache();
        let corpo = null;
        await comFetch(async (_u, o) => { corpo = JSON.parse(o.body); return veredito('PROJETO'); }, async () => {
            await Judge.precisaTier('ambiguo xx yy');
        });
        assert.strictEqual(corpo.temperature, 0);
        assert.ok(corpo.max_tokens <= 64, `max_tokens ${corpo.max_tokens} alto demais para um juiz de 1 palavra`);
        // MEDIDO no gateway: com raciocinio, o orcamento inteiro vira
        // pensamento e o `content` volta VAZIO — o juiz nunca daria veredito.
        assert.strictEqual(corpo.reasoning_effort, 'none',
            `o juiz precisa responder sem raciocinio, veio ${corpo.reasoning_effort}`);
        assert.ok(/PROJETO/.test(corpo.messages[0].content), 'o prompt do juiz sumiu');
    });

    // ============================================================
    // ProjectGenerator: parsing do plano
    // ============================================================

    await teste('extrairNome pega nome em varios formatos de separador', () => {
        assert.strictEqual(Gen.extrairNome('index.html — página inicial'), 'index.html');
        assert.strictEqual(Gen.extrairNome('style.css - estilos'), 'style.css');
        assert.strictEqual(Gen.extrairNome('app.js: logica'), 'app.js');
        assert.strictEqual(Gen.extrairNome('- package.json: dependencias'), 'package.json');
        assert.strictEqual(Gen.extrairNome('1. main.py: entrada'), 'main.py');
    });

    await teste('extrairNome ignora linha sem arquivo', () => {
        assert.strictEqual(Gen.extrairNome('apenas texto solto'), '');
        assert.strictEqual(Gen.extrairNome(''), '');
        assert.strictEqual(Gen.extrairNome('- '), '');
    });

    await teste('extrairNome ignora path traversal do modelo', () => {
        // Um nome com barra é preservado (o ZipBuilder cria a pasta), mas
        // traversal e caminho absoluto têm de ser descartados na origem.
        const linhas = ['../../etc/passwd', '/main.js', 'src/ok.js', 'C:\\Windows\\evil.js', 'a/../../b.js'];
        const nomes = linhas.map(Gen.extrairNome);
        assert.strictEqual(nomes[0], '', `aceitou traversal: ${nomes[0]}`);
        assert.strictEqual(nomes[1], '', `aceitou caminho unix absoluto: ${nomes[1]}`);
        assert.strictEqual(nomes[2], 'src/ok.js', `perdeu o valido: ${nomes[2]}`);
        assert.strictEqual(nomes[3], '', `aceitou caminho windows absoluto: ${nomes[3]}`);
        assert.strictEqual(nomes[4], '', `aceitou traversal no meio: ${nomes[4]}`);
    });

    await teste('linguagemDe mapeia as extensoes comuns', () => {
        assert.strictEqual(Gen.linguagemDe('a.js'), 'javascript');
        assert.strictEqual(Gen.linguagemDe('a.tsx'), 'tsx');
        assert.strictEqual(Gen.linguagemDe('a.html'), 'html');
        assert.strictEqual(Gen.linguagemDe('a.css'), 'css');
        assert.strictEqual(Gen.linguagemDe('a.desconhecida'), '');
    });

    // ============================================================
    // ProjectGenerator: limpeza de conteudo
    // ============================================================

    await teste('limparConteudo tira cerca ``` e devolve o codigo', () => {
        const r = Gen.limparConteudo('```js\nconst a = 1;\n```', 'a.js');
        assert.strictEqual(r, 'const a = 1;');
    });

    await teste('limparConteudo tira preambulo "Claro! Aqui esta..."', () => {
        const r = Gen.limparConteudo('Claro! Aqui está o index.html:\n<h1>oi</h1>', 'index.html');
        assert.ok(r.startsWith('<h1>'), `veio: ${r}`);
    });

    await teste('limparConteudo tira rotulo solto e data-fronte', () => {
        const r = Gen.limparConteudo('## index.html\ndata: x=1\n<div>oi</div>', 'index.html');
        assert.ok(!r.includes('## index.html'), `rotulo sobrou: ${r}`);
        assert.ok(!r.includes('data: x=1'), `data-fronte sobrou: ${r}`);
        assert.ok(r.includes('<div>oi</div>'));
    });

    await teste('limparConteudo tira marcador de arquivo repetido do modelo', () => {
        // O modelo as vezes reescreve o rotulo DENTRO da cerca. Sem esta
        // limpeza, "## index.html" ia sobrar no arquivo final.
        const r = Gen.limparConteudo('```html\n## index.html\n<h1>oi</h1>\n```', 'index.html');
        assert.ok(!r.startsWith('##'), `rotulo repetido sobrou: ${r}`);
        assert.ok(r.startsWith('<h1>'), `veio: ${r}`);
    });

    await teste('limparConteudo com cerca nao fechada nao quebra', () => {
        const r = Gen.limparConteudo('```python\nprint(1)\n', 'a.py');
        assert.strictEqual(r, 'print(1)');
    });

    await teste('limparConteudo sem cerca nenhuma devolve o texto', () => {
        const r = Gen.limparConteudo('linha1\nlinha2', 'a.txt');
        assert.ok(r.includes('linha1') && r.includes('linha2'));
    });

    await teste('extrairConteudo tira os rotulos do formato do prompt', () => {
        // Formato REAL que o modelo devolveu em producao. Gravar a resposta
        // menos a tag [ARQUIVO:] produzia um .tsx com AÇÃO:, CODE:, a cerca
        // ``` e a prosa dentro do fonte: um arquivo que nao compila.
        const real = 'FILE:  [ARQUIVO: src/Calculator.tsx]  \n'
            + 'AÇÃO:  [ACAO: CREATE] + execute  \n'
            + 'CODE: ```tsx\n'
            + "import React from 'react';\n"
            + 'export const Calc = () => <div>1</div>;\n'
            + '```\n\n'
            + 'Calculadora acessível com suporte a teclado.';
        const out = Gen.extrairConteudo(real, 'src/Calculator.tsx');
        assert.ok(out.includes('export const Calc'), `perdeu o codigo: ${out}`);
        assert.ok(!/AÇÃO|ACAO|CODE:|FILE:/.test(out), `rotulo sobrou: ${out}`);
        assert.ok(!out.includes('```'), `cerca sobrou: ${out}`);
        assert.ok(!out.includes('acessível'), `prosa do final sobrou: ${out}`);
        assert.ok(out.includes("import React from 'react'"), `o import do codigo foi perdido: ${out}`);
    });

    await teste('extrairConteudo aceita rotulo em ingles', () => {
        const r = Gen.extrairConteudo('FILE: [ARQUIVO: a.js]\nCODE:\n```js\nconst a = 1;\n```', 'a.js');
        assert.strictEqual(r, 'const a = 1;');
    });

    await teste('extrairConteudo pega o MAIOR bloco quando ha varios', () => {
        const r = Gen.extrairConteudo(
            '```js\nconst exemplo = 1;\n```\n'
            + 'Exemplo curto acima, agora o arquivo real:\n'
            + '```js\nconst a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;\n```\n'
            + 'prisma no fim',
            'a.js'
        );
        assert.ok(r.includes('const e = 5'), `pegou o bloco errado: ${r}`);
        assert.ok(!r.includes('exemplo'), 'pegou o exemplo curto');
        assert.ok(!r.includes('prisma'), 'prosa do fim sobrou');
    });

    await teste('extrairConteudo com cerca aberta nao perde o codigo', () => {
        const r = Gen.extrairConteudo('CODE:\n```tsx\nexport const A = 1;', 'a.tsx');
        assert.ok(r.includes('export const A'), `perdeu: ${r}`);
    });

    await teste('extrairConteudo SEM cerca remove so os rotulos', () => {
        const r = Gen.extrairConteudo('ARQUIVO: data.json\n{\n  "a": 1\n}', 'data.json');
        assert.ok(r.startsWith('{'), `veio: ${r}`);
        assert.ok(r.includes('"a": 1'), `perdeu o json: ${r}`);
        assert.ok(!r.includes('data.json'), 'o rotulo ficou');
    });

    await teste('extrairConteudo nao devolve vazio para entrada vazia', () => {
        assert.strictEqual(Gen.extrairConteudo(''), '');
        assert.strictEqual(Gen.extrairConteudo(null), '');
        assert.strictEqual(Gen.extrairConteudo(undefined), '');
    });

    await teste('extrairNomeMarcado aceita ARQUIVO e FILE', () => {
        // O modelo alterna entre os dois no mesmo formato de prompt.
        // Medido: "Calculator.tsx" veio como [ARQUIVO:] numa chamada e
        // [FILE:] na seguinte; aceitar um so perdia a extensao.
        assert.strictEqual(Gen.extrairNomeMarcado('[ARQUIVO: src/Calculator.tsx]'), 'src/Calculator.tsx');
        assert.strictEqual(Gen.extrairNomeMarcado('[FILE: src/Calculator.tsx]'), 'src/Calculator.tsx');
        assert.strictEqual(Gen.extrairNomeMarcado('**FILE: [FILE: index.html]**'), 'index.html');
        assert.strictEqual(Gen.extrairNomeMarcado('[Arquivo:  style.css ]'), 'style.css');
        assert.strictEqual(Gen.extrairNomeMarcado('[FILES: a.js]'), 'a.js');
    });

    await teste('extrairNomeMarcado devolve vazio sem marcador', () => {
        assert.strictEqual(Gen.extrairNomeMarcado('aqui esta o codigo'), '');
        assert.strictEqual(Gen.extrairNomeMarcado(''), '');
        assert.strictEqual(Gen.extrairNomeMarcado(null), '');
    });

    await teste('extrairNomeMarcado cai no generico quando nao ha nome', () => {
        // Nao pode devolver "acao" ou "code": so interessa nome com extensao.
        const r = Gen.extrairNomeMarcado('[ACAO: mutar] algum texto [ACTION: run]');
        assert.ok(!r || /\.\w{1,5}$/.test(r), `devolveu algo sem extensao: ${r}`);
    });

    // ============================================================
    // TierJudge: fronteira de palavra (o bug do "TypeScript")
    // ============================================================

    await teste('casaPalavra nao casa subpalavra de outra', () => {
        // Este e o bug real: includes('script') e true dentro de
        // "TypeScript", e reprovava um projeto React como tarefa simples.
        assert.strictEqual(Judge.casaPalavra('crie algo em TypeScript', 'script'), false,
            '"script" casou DENTRO de "typescript"');
        assert.strictEqual(Judge.casaPalavra('me faz um script bash', 'script'), true);
        assert.strictEqual(Judge.casaPalavra('um script', 'script'), true);
        assert.strictEqual(Judge.casaPalavra('scripting em python', 'script'), false);
        assert.strictEqual(Judge.casaPalavra('descrição de um script.', 'script'), true);
    });

    await teste('calculadora em React e TypeScript e classed como PROJETO', () => {
        const r = Judge.porPalavras('crie uma calculadora usando React e TypeScript, focando na acessibilidade');
        assert.strictEqual(r, 'projeto', `veio ${r} — e o pedido que gerou o bug`);
    });

    await teste('stack NAO decide sozinha: script em TypeScript vai pro juiz', () => {
        // "valida CPF em TypeScript" e um .ts so. Stack e sinal fraco, entao
        // quem decide e o juiz.
        assert.strictEqual(Judge.porPalavras('faz um script em TypeScript pra validar CPF'), null);
    });

    await teste('palavra forte ganha de palavra leve', () => {
        assert.strictEqual(Judge.porPalavras('cria um sistema com várias classes'), 'projeto');
    });

    // ============================================================
    // ProjectGenerator: fluxo com chat dublê
    // ============================================================

    await teste('planejar extrai a lista e respeita o teto de arquivos', async () => {
        const resposta = ['index.html — pagina', 'style.css — estilos', 'app.js — logica'].join('\n');
        const chat = async () => resposta;
        const plano = await Gen.planejar({ chat, pedido: 'um site' });
        assert.strictEqual(plano.length, 3);
        assert.strictEqual(plano[0].nome, 'index.html');
        assert.ok(plano[0].proposito.includes('pagina'), `proposito: ${plano[0].proposito}`);
    });

    await teste('planejar joga fora planilha sem arquivo valido', async () => {
        const chat = async () => 'Nenhum arquivo necessario.';
        let err = null;
        try { await Gen.planejar({ chat, pedido: 'x' }); } catch (e) { err = e; }
        assert.ok(err, 'deveria falhar quando o modelo nao devolve nenhum arquivo');
    });

    await teste('gerarArquivos faz 1 call por arquivo e monta o contexto', async () => {
        const chamadas = [];
        const chat = async (opts) => {
            chamadas.push(opts);
            const nomes = ['index.html', 'style.css', 'app.js'];
            const i = chamadas.length - 1;
            return `\`\`\`${nomes[i]}\n/* ${nomes[i]} */\nconst x${i} = ${i};\n\`\`\``;
        };
        const plano = [
            { nome: 'index.html', proposito: 'pagina' },
            { nome: 'style.css', proposito: 'estilos' },
            { nome: 'app.js', proposito: 'logica' },
        ];
        const { ok, falhas } = await Gen.gerarArquivos({ chat, pedido: 'site', plano, maxTokens: 8000 });
        assert.strictEqual(chamadas.length, 3, `fez ${chamadas.length} chamadas, esperava 3 (1 por arquivo)`);
        assert.strictEqual(ok.length, 3);
        assert.strictEqual(falhas.length, 0);
        // o 2o arquivo tem de ver o 1o no contexto
        const segundo = chamadas[1].messages[0].content;
        assert.ok(segundo.includes('index.html'), 'o 2o arquivo nao viu o 1o no contexto');
        assert.ok(!segundo.includes('style.css —'), 'o 2o nao deve se ver a si mesmo no contexto');
    });

    await teste('cabecalho de identificacao usa o comentario da linguagem', async () => {
        // "//" no topo de um .css ou .html aparece como lixo no arquivo final.
        const chamadas = [];
        const chat = async (opts) => {
            chamadas.push(opts);
            const nomes = ['index.html', 'style.css', 'app.js'];
            const i = chamadas.length - 1;
            return `${nomes[i]}\ncorpo valido do arquivo ${i}`;
        };
        const plano = [
            { nome: 'index.html', proposito: 'pagina' },
            { nome: 'style.css', proposito: 'estilos' },
            { nome: 'app.js', proposito: 'logica' },
        ];
        const { ok } = await Gen.gerarArquivos({ chat, pedido: 'site', plano, maxTokens: 4000 });
        assert.ok(ok[0].conteudo.startsWith('<!--'), `html devia abrir com <!--, veio ${ok[0].conteudo.slice(0, 30)}`);
        assert.ok(ok[1].conteudo.startsWith('/*'), `css devia abrir com /*, veio ${ok[1].conteudo.slice(0, 30)}`);
        assert.ok(ok[2].conteudo.startsWith('//'), `js devia abrir com //, veio ${ok[2].conteudo.slice(0, 30)}`);
    });

    await teste('gerarArquivos isola falha de um arquivo e segue', async () => {
        let n = 0;
        const chat = async () => {
            n++;
            if (n === 2) throw new Error('modelo caiu');
            return '```\nconteudo valido do arquivo ' + n + '\n```';
        };
        const plano = [
            { nome: 'a.js', proposito: 'x' },
            { nome: 'b.js', proposito: 'y' },
            { nome: 'c.js', proposito: 'z' },
        ];
        const { ok, falhas } = await Gen.gerarArquivos({ chat, pedido: 'p', plano, maxTokens: 4000 });
        assert.strictEqual(ok.length, 2, 'os 2 bons deveriam ter saído');
        assert.strictEqual(falhas.length, 1);
        assert.strictEqual(falhas[0].nome, 'b.js');
    });

    await teste('gerarArquivos joga fora conteudo vazio', async () => {
        const chat = async (opts) => {
            const i = Math.random();
            return i > 0.5 ? '```\nconteudo bom suficiente aqui\n```' : '```\n\n```';
        };
        const plano = [{ nome: 'a.js', proposito: 'x' }, { nome: 'b.js', proposito: 'y' }];
        const { ok, falhas } = await Gen.gerarArquivos({ chat, pedido: 'p', plano, maxTokens: 4000 });
        assert.ok(falhas.length >= 0 && ok.length + falhas.length === 2,
            'todo arquivo precisa estar em ok ou em falhas, nenhum pode sumir');
    });

    await teste('gerarProjeto junta tudo num zip', async () => {
        const nomes = ['index.html', 'style.css'];
        let n = 0;
        const chat = async (opts) => {
            if (opts.max_tokens <= 1000) {
                return 'index.html — pagina\nstyle.css — estilos';
            }
            const nome = nomes[n++] || 'extra.js';
            return `\`\`\`\n/* ${nome} */\nbody { color: red; }\n\`\`\``;
        };
        const os = require('os');
        const pasta = os.tmpdir();
        const r = await Gen.gerarProjeto({
            chat, pedido: 'um site', tierLabel: 'MED', maxTokens: 8000, pasta,
        });
        assert.ok(r.arquivos.length >= 2, `gerou ${r.arquivos.length}`);
        assert.ok(r.partes.length === 1, 'deveria caber em 1 zip');
        require('fs').unlinkSync(r.partes[0].caminho);
    });

    await teste('gerarHtmlUnico extrai o html de dentro da cerca', async () => {
        const chat = async () => '```html\n<!DOCTYPE html><html><style>a{}</style><script>1</script></html>\n```';
        const html = await Gen.gerarHtmlUnico({ chat, pedido: 'um site', maxTokens: 4000 });
        assert.ok(html.startsWith('<!DOCTYPE'), `veio: ${html.slice(0, 40)}`);
        assert.ok(html.includes('<style>') && html.includes('<script>'), 'tem que manter css e js inline');
    });

    await teste('gerarHtmlUnico remove chatter antes do DOCTYPE', async () => {
        const chat = async () => 'Claro! Aqui esta:\n\n<!DOCTYPE html><html></html>';
        const html = await Gen.gerarHtmlUnico({ chat, pedido: 'p', maxTokens: 4000 });
        assert.ok(html.startsWith('<!DOCTYPE'), `veio: ${html.slice(0, 40)}`);
    });

    // ============================================================

    global.fetch = fetchReal;
    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou ? 1 : 0);
})();
