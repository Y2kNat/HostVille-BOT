const config = require('../config');
const fs = require('fs');
const path = require('path');
const ZipBuilder = require('../utils/ZipBuilder');
const { logInfo, logWarn, logError } = require('../utils/logger');

/**
 * Geracao de projeto em varios arquivos.
 *
 * POR QUE ISSO EXISTE
 *
 * Medido no nemotron-3-nano:30b-cloud, pedindo "um site completo" numa
 * geracao unica de 16.000 tokens: finish_reason="stop" com 2.386 tokens
 * gerados (15% do orcamento). O modelo nao foi cortado por limite nenhum —
 * ele simplesmente ACHOU QUE TINHA TERMINADO. Subir o teto nao resolve,
 * porque o teto ja era 16k.
 *
 * A virada e inverter a granularidade: primeiro pergunta quais arquivos o
 * projeto tem, depois gera UM arquivo por chamada. Obrigado a escrever
 * index.html sozinho, o modelo entrega o orcamento inteiro nele; o
 * seguinte ja herda o contexto dos anteriores.
 */

const PLANEJADOR_TOKENS = config.GEN_PLANNER_TOKENS;
const MAX_ARQUIVOS = config.GEN_MAX_FILES;

// Teto de caracteres por arquivo. 16000 tokens ~ 64.000 caracteres, mas o
// modelo raramente usa tudo e um arquivo gigante engasga o deflate.
const CHARS_POR_ARQUIVO = 120000;

const PROMPT_PLANEJADOR = `Você é um arquiteto de software. Dado um pedido, liste OS ARQUIVOS que precisam ser criados.

Responda APENAS com a lista, um arquivo por linha, no formato:
nome.ext — o que ele faz

SEM numeração, SEM markdown, SEM explicação, SEM bloco de código.
Comece a resposta direto pela lista.

Exemplo de pedido: "site institucional da HostVille, com página inicial, sobre e contato"
Resposta:
index.html — página inicial com cabeçalho, hero e rodapé
style.css — estilos da página, tipografia e layout responsivo
app.js — menu mobile e animações de entrada

Pedido: "{PEDIDO}"

Arquivos:`;

// As cercas entram por escape porque um ``` solto dentro de um template
// literal fecha o proprio template. \x60 e o mesmo caractere.
const CERCA = '\x60\x60\x60';
const CERCA_TEXTO = CERCA + ' e ' + CERCA;

const PROMPT_ARQUIVO = `Você é um desenvolvedor expert. Escreva UM arquivo: {NOME}.

CONTEXTO DO PROJETO: {PROJETO}

PROGRESSO ATUAL (arquivos já gerados, use para manter coerência):
{ANTERIORES}

REGRAS:
- O conteúdo do arquivo vai entre ${CERCA_TEXTO}
- NAIS use outras cercas dentro do conteúdo
- Código COMPLETO e funcional, sem placeholder tipo "// resto do código aqui"
- Se o arquivo depender de outro, importe do jeito que os anteriores fazem
- Responda SÓ com o arquivo, sem explicação antes ou depois

Arquivo {NOME}:`;

// Marcadores de nome de arquivo. O prompt pede [ARQUIVO: nome.ext], mas o
// modelo responde ora com [FILE: ...], ora com [Arquivo: ...]: medido na
// mesma sessão, "Calculator.tsx" veio como [ARQUIVO:] numa chamada e como
// [FILE:] na seguinte. Aceitar só um dos formatos fazia o arquivo cair no
// nome genérico arquivo-<timestamp>.txt e perder a extensão.
const NOME_MARCADO = /\[(?:\s*)(?:ARQUIVO|ARQUIVOS|FILE|FILES|ARQUIVE|FICHEIRO)(?:\s*):\s*([^\]\n]+?)\s*\]/i;

/**
 * Extrai o nome do arquivo de uma resposta no formato do prompt.
 * @param {string} bruto
 * @returns {string} nome, ou '' se nenhum marcador for reconhecido
 */
function extrairNomeMarcado(bruto) {
    const m = String(bruto || '').match(NOME_MARCADO);
    if (m) return m[1].trim();
    // Último recurso: qualquer "[ALGO: algo.ext]" com cara de nome de arquivo.
    const alt = String(bruto || '').match(/\[[^\]\n]{0,20}?:\s*([\w./\\-]+\.\w{1,5})\s*\]/i);
    return alt ? alt[1].trim() : '';
}

/**
 * Extrai SÓ o código de uma resposta crua do modelo no formato do prompt.
 *
 * O TaskRunner usa isso na criação de arquivo, porque o modelo devolve a
 * resposta inteira:
 *
 *   FILE:  [ARQUIVO: src/Calculator.tsx]
 *   AÇÃO:  [ACAO: CREATE] + execute
 *   CODE:  ```tsx
 *   import React from 'react';
 *   ```
 *   Calculadora acessível com suporte a teclado.   <- prosa
 *
 * Pegar a tag [ARQUIVO:] e gravar o resto produz um .tsx com "AÇÃO:", a
 * cerca ``` e a prosa dentro do fonte: não compila. Aqui sai só o código.
 *
 * @param {string} bruto resposta crua
 * @param {string} [nome] nome do arquivo, para tirar rótulo repetido
 * @returns {string}
 */
function extrairConteudo(bruto, nome = '') {
    const texto = String(bruto || '');

    // 1. Bloco cercado FECHADO: pega o MAIOR. Vários blocos são comum
    //    (o modelo separa arquivo e exemplo), e o maior é o arquivo.
    const blocos = [...texto.matchAll(/```[a-zA-Z0-9_+-]*\n?([\s\S]*?)```/g)].map(m => m[1]);
    if (blocos.length) {
        return blocos.reduce((a, b) => (b.length > a.length ? b : a)).replace(/\s+$/, '').trim();
    }

    // 2. Cerca ABERTA (geração cortada no limite): fica com o que tem.
    const aberta = texto.match(/```[a-zA-Z0-9_+-]*\n([\s\S]*)$/);
    if (aberta) return aberta[1].replace(/\s+$/, '').trim();

    // 3. Sem cerca: remove os rótulos do formato e devolve o resto.
    let t = texto;
    t = t.replace(/\[ARQUIVO:\s*.+?\]/gi, '');
    t = t.replace(/\[ACAO:\s*.+?\]/gi, '');
    // Rótulos do prompt, em português ou inglês. O modelo alterna entre os
    // dois ("FILE:" numa resposta, "ARQUIVO:" na outra).
    t = t.replace(/^\s*(FILE|FILES|ARQUIVO|ARQUIVOS|ACTION|ACAO|AÇÃO|CODE|CODIGO|CÓDIGO|TEXT|TEXTO|OUTPUT|SADA|SÍDA)\s*:\s*/gim, '');
    t = t.replace(/^(Claro|Certo|Ok|Entendido|Perfeito)[^\n:]*:\s*/i, '').trim();
    const rotulo = String(nome || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (rotulo) {
        t = t.replace(new RegExp(`^\\s*${rotulo}\\s*[:=]\\s*`, 'i'), '');
        // "ARQUIVO: data.json" sem cerca: o nome fica na linha seguinte, sem
        // dois-pontos. Sem esta regra o arquivo saia com "data.json" na
        // primeira linha e quebrava o JSON.
        const base = rotulo.split('/').pop();
        t = t.replace(new RegExp(`^\\s*${base}\\s*$`, 'im'), '');
    }
    return t.replace(/^\n+/, '').replace(/\s+$/, '').trim();
}

/**
 * Remove cercas, numeração e commentary que o modelo enrola em volta.
 *
 * O cabeçalho "// ARQUIVO n de N" entra DEPOIS da limpeza de comentários: se
 * entrasse antes, o stripper de comentário `//` apagaria as duas linhas e o
 * arquivo perderia a identificação.
 *
 * @param {string} bruto resposta crua do modelo
 * @param {string} nome nome do arquivo
 * @param {string} [linguagem] extensão derivada, para não comentar dentro de string
 */
function limparConteudo(bruto, nome, linguagem) {
    let t = String(bruto || '').trim();

    // Tira cercas ``` ... ``` involve o arquivo inteiro
    const fences = t.match(/```[a-zA-Z0-9_+-]*\n?([\s\S]*?)```/);
    if (fences) {
        t = fences[1];
    } else {
        // Sem cerca de fechamento: o modelo foi cortado no limite
        const aberta = t.match(/```[a-zA-Z0-9_+-]*\n([\s\S]*)$/);
        if (aberta) t = aberta[1];
    }

    // Prefacio do tipo "Claro! Aqui está o index.html:"
    t = t.replace(/^(Claro|Certo|Ok|Entendido|Perfeito)[^\n:]*:\s*/i, '').trim();
    // Rotulo solto antes do conteúdo: "## index.html", "index.html:", "arquivo: "
    t = t.replace(/^#+\s*\w[\w./-]*\s*$/gm, '');
    const rotulo = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`^\\s*(?:arquivo\\s*)?${rotulo}\\s*[:=]\\s*`, 'i'), '');
    // Data-fronte ficticia que o modelo inventa as vezes. O ^ sem /m ancoreia
    // no inicio da string, entao precisa engolir a quebra de linha que sobrou
    // da remocao do rotulo acima.
    t = t.replace(/^\s*data:\s*.*$/gm, '');

    return t.replace(/\s+$/, '').trim().replace(/^\n+/, '');
}

/** Extensão -> linguagem, para nomear o bloco. */
function linguagemDe(nome) {
    const ext = path.extname(nome).toLowerCase();
    return {
        '.js': 'javascript', '.mjs': 'javascript', '.jsx': 'jsx',
        '.ts': 'typescript', '.tsx': 'tsx',
        '.html': 'html', '.htm': 'html', '.css': 'css', '.scss': 'scss',
        '.json': 'json', '.md': 'markdown', '.py': 'python',
        '.sql': 'sql', '.sh': 'bash', '.yml': 'yaml', '.yaml': 'yaml',
        '.java': 'java', '.go': 'go', '.rb': 'ruby', '.php': 'php',
    }[ext] || '';
}

/**
 * Normaliza a linha do planejador: "index.html — página inicial" -> index.html
 * @param {string} linha
 * @returns {string} nome de arquivo, ou '' se a linha não serve
 */
function extrairNome(linha) {
    const l = String(linha || '').trim();
    if (!l) return '';
    // Linha do formato oficial: "index.html — página inicial"
    // Aceita separador de verdade (— –) ou o hífen simples que o modelo
    // digita com mais frequência do que os typográficos.
    const m = l.match(/^[\s\-*•\d.)]+\s*([\w.-]+\.\w{1,5})\s*(?:[—–-]|:|$)/);
    if (m) return seguro(m[1]);
    // Qualquer menção a arquivo na linha, mesmo precedida de texto.
    // A classe de char INCLUI a barra: sem isso "/main.js" casaria só em
    // "main.js" e o caminho absoluto passava limpio.
    const m2 = l.match(/([\w./\\-]+\.\w{1,5})/);
    if (m2) return seguro(m2[1]);
    return '';
}

/**
 * Neutraliza o que o ZipBuilder também bloqueia, mas ANTES de gravar.
 * Devolve '' quando o nome não é aceitável, e o chamador pula a linha.
 *
 * Delegação deliberada: a regra de nome seguro mora em um lugar só
 * (ZipBuilder.nomeDeArquivo) e é a mesma que o TaskRunner usa para gravar.
 * Duas cópias da regra divergem com o tempo, e a divergência aparece como
 * "o modelo pediu ../ e o bot gravou fora".
 *
 * @param {string} nome
 * @returns {string}
 */
function seguro(nome) {
    const n = String(nome || '').trim();
    if (!n) return '';
    if (n.includes('..')) return '';
    if (n.startsWith('/') || n.startsWith('\\') || /^[a-zA-Z]:/.test(n)) return '';
    const normalizado = n.replace(/\\/g, '/');
    if (normalizado.split('/').some(p => p === '..' || p === '.')) return '';
    // nome sem extensão não é arquivo
    if (!/\.\w{1,5}$/.test(normalizado.split('/').pop())) return '';
    return normalizado;
}

/**
 * Etapa 1: pergunta a lista de arquivos.
 * @param {object} opts
 * @param {(args:object)=>Promise<string>} opts.chat mesmo formato do KiloClient.chat
 * @param {string} opts.pedido
 * @returns {Promise<Array<{nome:string, proposito:string}>>}
 */
async function planejar({ chat, pedido }) {
    const bruto = await chat({
        messages: [{ role: 'user', content: PROMPT_PLANEJADOR.replace('{PEDIDO}', String(pedido).slice(0, 800)) }],
        temperature: 0.3,
        max_tokens: PLANEJADOR_TOKENS,
        contexto: 'gerador:planejador',
    });

    const linhas = String(bruto || '')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);

    const vistos = new Set();
    const arquivos = [];
    for (const linha of linhas) {
        if (arquivos.length >= MAX_ARQUIVOS) break;
        const nome = extrairNome(linha);
        if (!nome) continue;
        if (/\.md$/i.test(nome) && arquivos.length === 0) continue; // README nunca é o primeiro
        if (vistos.has(nome)) continue;
        // nome de arquivo precisa ter extensão
        if (!/\.\w{1,5}$/.test(nome)) continue;
        // barra de traversal e caminho absoluto não entram
        if (nome.includes('..') || nome.startsWith('/')) continue;
        vistos.add(nome);
        const proposito = linha.replace(nome, '').replace(/^[—–\-:\s]+/, '').trim();
        arquivos.push({ nome, proposito: proposito.slice(0, 200) });
    }

    if (!arquivos.length) throw new Error('planejador nao devolveu nenhum arquivo valido');
    return arquivos;
}

/**
 * Etapa 2: gera um arquivo por chamada, herdando o contexto dos anteriores.
 * @param {object} opts
 * @param {(args:object)=>Promise<string>} opts.chat
 * @param {string} opts.pedido
 * @param {Array<{nome:string,proposito:string}>} opts.plano
 * @param {number} opts.maxTokens
 * @param {(msg:string)=>void} [opts.progress] callback de progresso
 * @returns {Promise<{ok:Array, falhas:Array, contexto:string}>}
 */
async function gerarArquivos({ chat, pedido, plano, maxTokens, progress = () => {} }) {
    const ok = [];
    const falhas = [];
    let contexto = '';

    for (let i = 0; i < plano.length; i++) {
        const { nome, proposito } = plano[i];
        const linguagem = linguagemDe(nome);
        // Comentario no estilo da linguagem do arquivo. Num .css ou .html um
        // "//" nao e comentario e aparecia como lixo no topo do arquivo.
        const abre = linguagem === 'html' ? '<!--' : linguagem === 'css' ? '/*' : '//';
        const fecha = linguagem === 'html' ? '-->' : linguagem === 'css' ? '*/' : '';
        const cabecalho = abre === '/*'
            ? `/* ARQUIVO ${i + 1} de ${plano.length}: ${nome}\n   Proposito: ${proposito || '(definir no arquivo)'} */\n`
            : `${abre} ARQUIVO ${i + 1} de ${plano.length}: ${nome}\n${abre} Proposito: ${proposito || '(definir no arquivo)'} ${fecha}\n`;

        progress(`📄 ${i + 1}/${plano.length} — ${nome}`);

        let conteudo = '';
        try {
            const bruto = await chat({
                messages: [{
                    role: 'user',
                    content: PROMPT_ARQUIVO
                        .replace(/\{NOME\}/g, nome)
                        .replace('{PROJETO}', String(pedido).slice(0, 800))
                        .replace('{ANTERIORES}', contexto || '(nenhum arquivo ainda — este é o primeiro)'),
                }],
                temperature: 0.4,
                max_tokens: maxTokens,
                contexto: 'gerador:arquivo',
            });
            conteudo = cabecalho + limparConteudo(bruto, nome, linguagem);
        } catch (e) {
            // 429 e 413 por TPM sao transitorios: a chamada seguinte quase
            // sempre passa. O 413 merece estar aqui porque alguns planos do
            // gateway tem TPM apertado e o proprio max_tokens ja estoura o
            // limite — "Requested 8098 / Limit 8000". Sem a espera, o loop
            // de 12 arquivos martela o limite e perde tudo de uma vez.
            if (/429|413|rate limit|too many requests|TPM/i.test(e.message)) {
                const espera = /413|TPM/i.test(e.message) ? 4000 : 2000;
                logWarn(`[Gerador] limite de taxa em ${nome}, esperando ${espera}ms`);
                await new Promise(r => setTimeout(r, espera));
                try {
                    const bruto = await chat({
                        messages: [{
                            role: 'user',
                            content: PROMPT_ARQUIVO
                                .replace(/\{NOME\}/g, nome)
                                .replace('{PROJETO}', String(pedido).slice(0, 800))
                                .replace('{ANTERIORES}', contexto || '(nenhum arquivo ainda — este é o primeiro)'),
                    }],
                        temperature: 0.4,
                        max_tokens: maxTokens,
                        contexto: 'gerador:arquivo',
                    });
                    conteudo = cabecalho + limparConteudo(bruto, nome, linguagem);
                } catch (e2) {
                    logError(`[Gerador] falhou ao gerar ${nome}: ${e2.message}`);
                    falhas.push({ nome, erro: e2.message });
                    continue;
                }
            } else {
                logError(`[Gerador] falhou ao gerar ${nome}: ${e.message}`);
                falhas.push({ nome, erro: e.message });
                continue;
            }
        }

        if (conteudo.trim().length < 20) {
            // 20 chars é menos que um import. Não vale mandar arquivo inútil.
            falhas.push({ nome, erro: 'conteudo vazio' });
            logWarn(`[Gerador] ${nome} veio vazio, pulando`);
            continue;
        }
        if (conteudo.length > CHARS_POR_ARQUIVO) {
            conteudo = conteudo.slice(0, CHARS_POR_ARQUIVO);
            logWarn(`[Gerador] ${nome} estourou o teto e foi cortado`);
        }

        ok.push({ nome, conteudo, linguagem });
        // Contexto para os próximos: o modelo precisa saber o que já existe
        // para não repetir import nem criar arquivo duplicado.
        contexto += `- ${nome} (${linguagem || 'texto'}): ${conteudo.length} chars, contem ${primeiraLinhaUtil(conteudo)}\n`;
    }

    return { ok, falhas, contexto };
}

/** Uma linha que descreva o arquivo, para o contexto dos próximos. */
function primeiraLinhaUtil(conteudo) {
    const linhas = conteudo.split('\n');
    for (const l of linhas) {
        const t = l.trim();
        if (!t || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
        return t.slice(0, 100);
    }
    return '(sem conteúdo)';
}

/**
 * Fluxo completo: planeja, gera, zipa.
 * @param {object} opts
 * @param {(args:object)=>Promise<string>} opts.chat
 * @param {string} opts.pedido
 * @param {string} opts.tierLabel
 * @param {number} opts.maxTokens
 * @param {string} opts.pasta destino dos .zip
 * @param {(msg:string)=>void} [opts.progress]
 * @returns {Promise<{partes:Array, arquivos:Array, falhas:Array}>}
 */
async function gerarProjeto({ chat, pedido, tierLabel, maxTokens, pasta, progress = () => {} }) {
    progress('🧠 Planejando os arquivos do projeto...');
    const plano = await planejar({ chat, pedido });
    logInfo(`[Gerador] tier ${tierLabel}: plano com ${plano.length} arquivo(s): ${plano.map(a => a.nome).join(', ')}`);

    const { ok, falhas } = await gerarArquivos({ chat, pedido, plano, maxTokens, progress });

    if (!ok.length) {
        const erro = new Error(`nenhum dos ${plano.length} arquivos foi gerado: ${falhas.map(f => f.nome).join(', ')}`);
        erro.falhas = falhas;
        throw erro;
    }

    progress('📦 Zipando o projeto...');
    const nomeBase = `projeto-${tierLabel}-${Date.now()}`;
    const { partes } = ZipBuilder.gravar(
        ok.map(a => ({ nome: a.nome, conteudo: a.conteudo })),
        pasta,
        { nomeBase }
    );
    logInfo(`[Gerador] tier ${tierLabel}: ${ok.length} arquivo(s) em ${partes.length} zip(s)`);

    return { partes, arquivos: ok, falhas };
}

/**
 * Caminho do HTML: didatico, o modelo erra mais fechando tag.
 * @param {object} opts
 * @param {(args:object)=>Promise<string>} opts.chat
 * @param {string} opts.pedido
 * @param {number} opts.maxTokens
 * @returns {Promise<string>} conteúdo completo do html
 */
async function gerarHtmlUnico({ chat, pedido, maxTokens }) {
    const bruto = await chat({
        messages: [{
            role: 'user',
            content: `Escreva UM arquivo HTML completo e autocontido para este pedido:

${String(pedido).slice(0, 800)}

REGRAS:
- O CSS vai dentro de <style> e o JavaScript dentro de <script> no MESMO arquivo
- Não cite arquivos externos de css/js: tudo inline
- Código completo e funcional, sem placeholder
- Responda SÓ com o HTML, do <!DOCTYPE html> ao </html>`,
        }],
        temperature: 0.4,
        max_tokens: maxTokens,
        contexto: 'gerador:html',
    });

    const texto = String(bruto || '');
    const fences = texto.match(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/);
    let html = fences ? fences[1] : texto.replace(/```[a-zA-Z0-9]*\n?/g, '');
    if (!/^\s*<!DOCTYPE/i.test(html)) {
        const dt = html.indexOf('<!DOCTYPE');
        if (dt > 0) html = html.slice(dt);
    }
    return html.trim();
}

module.exports = {
    planejar, gerarArquivos, gerarProjeto, gerarHtmlUnico,
    limparConteudo, extrairConteudo, extrairNome, extrairNomeMarcado,
    linguagemDe, seguro, MAX_ARQUIVOS, CHARS_POR_ARQUIVO,
};
