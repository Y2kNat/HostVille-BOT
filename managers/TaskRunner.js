const kilo = require('./KiloClient');
// com fallback de OUTRO MODELO no mesmo gateway do Kilo: sem isso, se o
// modelo principal cair o TaskRunner fica completamente mudo (nem classifica
// tarefa, nem gera arquivo)
const { cliente: clienteTarefa } = require('../utils/TaskIA');
const { safeContent } = require('../utils/messages');
const { logInfo, logError } = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

class TaskRunner {

    // Geração de código precisa de folga: uma landing page HTML passa de
    // 2.000 tokens. Antes era 3000 e a saída vinha cortada no meio.
    static maxTokens = parseInt(process.env.TASK_MAX_TOKENS) || 8000;

    // Indicadores de pedido de criação de arquivo/código (para rotear ao TaskRunner)
    static TASK_KEYWORDS = [
        'cria um', 'crie um', 'criar um', 'cria uma', 'crie uma', 'criar uma',
        'faça um', 'faca um', 'faz um', 'faça uma', 'faca uma', 'faz uma',
        'gere um', 'gera um', 'gere uma', 'gera uma',
        'escreva um', 'escreva uma', 'escreve um', 'escreve uma',
        'muta o', 'mute o', 'silencia o', 'expulsa o', 'bane o', 'banir o',
        'anuncia', 'anunciar', 'cria código', 'crie código', 'criar código',
        'criar arquivo', 'cria arquivo', 'crie arquivo', 'gera arquivo', 'gerar arquivo',
        'quero que você', 'quero que voce', 'quero que vc',
        'monta uma', 'monte uma', 'monta um', 'monte um',
        'script', 'me cria', 'me escreve', 'me monta', 'cria pra mim', 'faça pra mim', 'faz pra mim',
        'modulo', 'módulo', 'um bot'
    ];

    // Ações que o bot realmente executa. O prompt pede "[ACAO: tipo]" e o
    // modelo inventa tipos sem corresponding case no switch (create, delete,
    // install...). Se a checagem for por substring, um tipo inventado cai no
    // default: de executeAction, que devolvia o output inteiro como content.
    static ACOES_VALIDAS = [
        'mutar', 'mute', 'silenciar',
        'expulsar', 'kick',
        'banir', 'ban',
        'anunciar', 'anuncio',
        'responder_canal', 'enviar_canal', 'enviar',
        'avisar_todos', 'anunciar_todos', 'broadcast'
    ];

    // Palavra-chave de 1 palavra tem que casar como palavra inteira: sem isso
    // "javascript" casaria com "script" e o bot criaria arquivo numa pergunta normal.
    static _hasKeyword(lower) {
        return this.TASK_KEYWORDS.some(kw => {
            if (kw.includes(' ')) return lower.includes(kw);
            const safe = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp('(^|[^a-z0-9])' + safe + '([^a-z0-9]|$)').test(lower);
        });
    }

    // ============================================================
    // Rate limiting: só o TaskRunner é limitado
    // ============================================================
    static rateGate(userId) {
        if (!userId) return null;
        return require('./RateLimiter').gate('task', userId);
    }

    /**
     * Fecha cercas de código abertas.
     * Se a geração foi cortada no meio, a cerca ``` fica aberta: o arquivo
     * sai incompleto e o bloco invade o resto da mensagem.
     */
    static closeFences(text) {
        if (typeof text !== 'string' || !text.includes('```')) return text;
        const aberturas = (text.match(/```/g) || []).length;
        if (aberturas % 2 === 0) return text;
        const aviso = '\n\n_(o código acima foi cortado no limite de tokens; peça menos linhas ou divida em partes)_';
        return text.replace(/\s+$/, '') + '\n```' + aviso;
    }

    // Se a mensagem pede criação de código/arquivo (keywords rápidas + julgamento da IA)
    static async isTaskRequest(text) {
        const lower = (text || '').toLowerCase();

        // Continuação de conversa / dúvida → nunca é tarefa
        if (/(e se|mas se|seria|ainda|então|entao|depois|porque|por que|será|sera|o que acontec|e ai|e aí|não tiver|nao tiver|queria saber|quero saber|me explica|o que é|o que e|o que significa|pode ser|vai ser|como faço|como eu faço|consegue me ajudar)/.test(lower) && !/\b(cria|crie|ger(a|e)|monta|monte|escreve|escreva|arquivo|código|codigo|script)\b/.test(lower)) {
            return false;
        }

        if (this._hasKeyword(lower)) return true;

        // Sem keyword direta → perguntar à IA (rápido, temperatura 0)
        if (!this._looksLikeRequest(lower)) return false;
        try {
            const judge = await clienteTarefa.chat({
                messages: [
                    { role: 'system', content: 'Você classifica se um usuário PEDIU para o bot criar/executar algo (arquivo, código, modificação). Responda APENAS com "SIM" ou "NAO".\n\nExemplos:\nUsuário: "monta um site em html" -> SIM\nUsuário: "crie um script" -> SIM\nUsuário: "o que é uma api?" -> NAO\nUsuário: "qual teu nome?" -> NAO\nUsuário: "faz uma calculadora em js" -> SIM\nUsuário: "tu tá ai?" -> NAO\nUsuário: "preciso de um exemplo de query sql" -> SIM\nUsuário: "e se ele nao tiver nenhuma justificativa?" -> NAO\nUsuário: "mas e se o servidor cair?" -> NAO\nUsuário: "então a base não funciona?" -> NAO' },
                    { role: 'user', content: `Pedido: "${text || ''}"\nResponda SIM ou NAO.` }
                ],
                temperature: 0,
                max_tokens: 5,
                contexto: 'taskrunner:classificador'
            });
            const answer = (judge || '').trim().toUpperCase();
            return answer.includes('SIM') && !answer.includes('NAO');
        } catch (e) {
            return false;
        }
    }

    // Verbos/indícios que justificam perguntar à IA (evita custo em qualquer mensagem)
    static _looksLikeRequest(lower) {
        return /(cria|crie|criar|faça|faca|faz|fazer|monta|monte|gera|gere|gerar|escreve|escreva|escrever|código|codigo|arquivo|script|programa|bot\b|site|pagina|página|query|modula|instala|instale|implanta|implemente|adicion[a-z]*|configure|configura|preciso de um|me cria|peço que)/.test(lower);
    }

    // Detecta a linguagem pedida na tarefa (ex.: "em js", "em python", "em html")
static detectLanguage(text) {
        const lower = (text || '').toLowerCase();
        const langs = [
            { test: /(em c#|\.cs|csharp|em cs)(?=[\s,.;:])/, label: 'C#', ext: 'cs', langLabel: 'C#' },
            { test: /(rust|\.rs|em rs)(?=[\s,.;:])/, label: 'Rust', ext: 'rs', langLabel: 'Rust' },
            { test: /(javascript|\.js|em js|arquivo\s*js)(?=[\s,.;:])/, label: 'JavaScript', ext: 'js', langLabel: 'JavaScript' },
            { test: /(python|\.py|em py|arquivo\s*py)(?=[\s,.;:])/, label: 'Python', ext: 'py', langLabel: 'Python' },
            { test: /(typescript|em ts|\.ts)(?=[\s,.;:])/, label: 'TypeScript', ext: 'ts', langLabel: 'TypeScript' },
            { test: /(html|em html|arquivo\s*html)(?=[\s,.;:])/, label: 'HTML', ext: 'html', langLabel: 'HTML' },
            { test: /(css|em css)(?=[\s,.;:])/, label: 'CSS', ext: 'css', langLabel: 'CSS' },
            { test: /(java|\.java)(?=[\s,.;:])/, label: 'Java', ext: 'java', langLabel: 'Java' },
            { test: /(c\+\+|cpp|\.cpp)(?=[\s,.;:])/, label: 'C++', ext: 'cpp', langLabel: 'C++' },
            { test: /(em c\b|\.c|linguagem c|uso de c\b)/, label: 'C', ext: 'c', langLabel: 'C' },
            { test: /(php|\.php)(?=[\s,.;:])/, label: 'PHP', ext: 'php', langLabel: 'PHP' },
            { test: /(sql|\.sql)(?=[\s,.;:])/, label: 'SQL', ext: 'sql', langLabel: 'SQL' },
            { test: /(bash|shell|\.sh|em sh)(?=[\s,.;:])/, label: 'Bash', ext: 'sh', langLabel: 'Bash' },
            { test: /(em go\b|golang|\.go)/, label: 'Go', ext: 'go', langLabel: 'Go' },
            { test: /(json|\.json)(?=[\s,.;:])/, label: 'JSON', ext: 'json', langLabel: 'JSON' }
        ];
        for (const l of langs) {
            if (l.test.test(lower)) return l;
        }
        return null;
    }

    static _langMatches(blockLang, preferred) {
        if (!blockLang || !preferred) return false;
        const b = blockLang.toLowerCase();
        const aliases = {
            cs: ['cs', 'c#', 'csharp'],
            rs: ['rs', 'rust'],
            go: ['go', 'golang'],
            js: ['js', 'javascript', 'jsx'],
            py: ['py', 'python'],
            ts: ['ts', 'typescript'],
            sh: ['sh', 'bash', 'shell']
        };
        const accepted = aliases[preferred.ext] || [preferred.ext, preferred.label.toLowerCase(), preferred.langLabel.toLowerCase()];
        return accepted.includes(b);
    }

    /**
     * @param {import('discord.js').Message} message
     * @param {object} [ctx]
     * @param {import('discord.js').Message} [ctx.thinking] a mensagem "pensando..."
     *   que o ChatManager ja mandou: o seletor a EDITA em vez de criar uma
     *   segunda mensagem solta no canal.
     * @returns {Promise<string|null>} null = o bot ja respondeu sozinho
     */
    static async run(message, ctx = {}) {
        let task = message.content;
        const botMention = `<@${message.client.user.id}>`;
        const botName = message.client.user.username.toLowerCase();
        task = task.replace(botMention, '').replace(new RegExp(botName, 'gi'), '');
        task = task.replace(/hvbot/gi, '').replace(/hostbot/gi, '').trim();

        if (!task || task.length < 5) return null;

        // Guard de prompt injection ANTES do classificador: um pedido de
        // tarefa é justamente o formato que o modelo de resposta obedeceria
        // sem questionar ("crie um script que...").
        {
            const InjectionGuard = require('./InjectionGuard');
            const g = await InjectionGuard.check(message.content);
            if (g.blocked) {
                await message.reply({ content: InjectionGuard.BLOQUEIO }).catch(() => {});
                return null;
            }
        }

        // Rate limit: só tarefas. Cada task pode gastar 2 requests
        // (classificador + execução), então o limite é o mais apertivo.
        const espera = this.rateGate(message.author?.id);
        if (espera) {
            await message.reply({ content: `⏳ Calma, ${message.author.username}! Tô numa tarefa agora — tenta ${espera}.` }).catch(() => {});
            return null;
        }

        await message.react('🤔').catch(() => {});

        try {
            // =============================================
            // TIER DE GERAÇÃO (opcional)
            // =============================================
            // Só entra aqui se o pedido for um projeto E o seletor estiver
            // ligado. Para qualquer outra coisa segue o caminho antigo de
            // geração única, que é mais rápido e não vale interromper.
            const langHint = this.detectLanguage(task);
            const targetHint = langHint
                ? `\nLINGUAGEM OBRIGATÓRIA: ${langHint.langLabel} (extensão .${langHint.ext}). NÃO use outra linguagem. Gere o código COMPLETO em ${langHint.langLabel}.`
                : '';

            const systemPrompt = `EXECUTE A TAREFA DIRETAMENTE. NUNCA PEÇA PERMISSÃO.

TAREFA: ${task}${targetHint}

REGRAS:
- NUNCA diga "posso ajudar", "aqui está um exemplo", "vou te mostrar"
- NUNCA peça confirmação
- FAÇA DIRETO o que foi pedido
- Códigos 100% completos e funcionais
- Arquivos com conteúdo completo
- Respostas diretas, sem enrolação

FORMATO:
- ARQUIVO: [ARQUIVO: nome.ext] + conteúdo
- AÇÃO: [ACAO: tipo] + execute  
- CÓDIGO: \`\`\`linguagem ... \`\`\`
- TEXTO: resposta direta`;

            let result = await clienteTarefa.chat({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: task }
                ],
                temperature: 0.7,
                max_tokens: this.maxTokens,
                contexto: 'taskrunner:geracao'
            });

            if (!result) return '🤔 Não consegui...';

            // Geração de código longa é cortada no meio pelo limite de tokens.
            // Sem fechar a cerca, o arquivo sai truncado e o bloco fica aberto.
            result = this.closeFences(result);

            // LIMPAR FRASES CHATAS
            result = result
                .replace(/^(Claro!|Com certeza!|Posso ajudar|Vou te ajudar|Aqui está|Vou criar|Vou fazer|Certo!|Ok!|Entendido!|Perfeito!|Posso ajudar com isso!|Vou te mostrar como|Permita-me|Deixe-me|Vou explicar)[^]*?\n/i, '')
                .replace(/(Posso ajudar com isso!|Vou te mostrar como|Permita-me|Deixe-me|Vou explicar)[^]*?\n/gi, '')
                .replace(/^(Claro|Com certeza|Ok|Certo),?\s*/i, '')
                .replace(/^(Aqui está um exemplo|Vou criar um exemplo|Segue um exemplo)[^]*?\n/i, '')
                .trim();

            await message.reactions.removeAll().catch(() => {});

            // AÇÃO — só quando o tipo é mesmo uma ação. O modelo às vezes emite
            // [ACAO: create] junto com [ARQUIVO: nome.ext]; esse "create" não
            // existe no switch e caía no default:, que despejava o projeto
            // inteiro (10KB) como content e o Discord recusava com
            // content[BASE_TYPE_MAX_LENGTH]. Tipo desconhecido = texto normal.
            const tipoAcao = (result.match(/\[ACAO:\s*(.+?)\]/i)?.[1] || '').trim().toLowerCase();
            if (tipoAcao && this.ACOES_VALIDAS.includes(tipoAcao)) {
                await message.react('✅').catch(() => {});
                return await this.executeAction(message, result);
            }

            // ARQUIVO
            // Aceita [ARQUIVO:] e [FILE:]: o modelo alterna entre os dois no
            // mesmo formato. Com o includes() antigo, um "[FILE: x.tsx]" caia
            // no fluxo de código solto e perdia o nome que o modelo já tinha
            // escolhido.
            if (require('../utils/codeFile').extrairNomeMarcado(result)) {
                await message.react('📄').catch(() => {});
                return await this.createFile(message, result);
            }

            // Código sem tag [ARQUIVO:] → gerar arquivo automaticamente
            const hasCode = result.includes('```') || this.detectLanguage(message.content);
            if (hasCode) {
                const fileResult = await this.createFileFromCode(message, result);
                if (fileResult === null) return null; // arquivo enviado
                result = fileResult; // fallback: sem bloco utilizável, vira texto
            }

            await message.react('✅').catch(() => {});

            // Muito grande
            if (result.length > 1900) {
                return await this.sendAsFile(message, result, `resposta-${Date.now()}.txt`);
            }

            return result;

        } catch (error) {
            console.error('TaskRunner:', error.message);
            await message.reactions.removeAll().catch(() => {});
            return '❌ Erro ao executar. Tenta de novo!';
        }
    }

    // ============================================
    // TIER DE GERAÇÃO
    // ============================================

    /**
     * Descobre o override manual (!min !med !high !max) e, se não houver,
     * pergunta ao TierJudge + TierSelector.
     *
     * @returns {Promise<string|null|'CANCELADO'>} 'MIN'|'MED'|'HIGH'|'MAX',
     *   null = segue o caminho de geração única, 'CANCELADO' = o usuário
     *   deixou o seletor expirar e não quer mais nada.
     */
    static async resolverTier(message, ctx, task) {
        const config = require('../config');

        // 1. Override manual: pula o juiz e abre o seletor direto.
        const forcado = String(task || '').match(/(?:^|\s)!(min|med|high|max)\b/i);
        if (forcado) {
            const tier = forcado[1].toUpperCase();
            const cd = require('../utils/TierCooldown').get(message.author.id, tier);
            if (cd.bloqueado) {
                const texto = require('../utils/TierCooldown').formatar(cd.restanteMs);
                await message.reply({ content: `⏳ O tier **${tier.toLowerCase()}** está em cooldown: volta em ${texto}.` }).catch(() => {});
                return 'CANCELADO';
            }
            logInfo(`TaskRunner: tier forcado por !${tier.toLowerCase()} em "${String(task).substring(0, 40)}"`);
            return tier;
        }

        // 2. Seletor desligado: caminho antigo.
        if (config.GEN_TIER_SELECTOR === 'off') return null;

        // 3. O juiz decide se é projeto. NUNCA trava: no pior caso devolve
        //    'simples' e a gente segue como antes dos tiers existirem.
        const forcarSempre = config.GEN_TIER_SELECTOR === 'always';
        if (!forcarSempre) {
            const v = await require('./TierJudge').precisaTier(task);
            if (!v.projeto) return null;
        }

        const TierSelector = require('./TierSelector');
        const alvo = ctx.thinking || message;
        const { tier, expirou } = await TierSelector.perguntar({
            alvo,
            userId: message.author.id,
            pedido: task,
        });

        if (expirou || !tier) return 'CANCELADO';
        return tier;
    }

    /**
     * Gera o projeto no tier escolhido.
     *
     * Exceção pedida: pedido de HTML em tier que NÃO seja max vai em arquivo
     * único, com CSS e JS inline. O motivo é didático — o modelo erra mais
     * fechando tag e importando caminho, então um self-contained é mais
     * confiável. No max ele vira multi-arquivo mesmo.
     *
     * @returns {Promise<null>} sempre null: o zip ja foi enviado
     */
    static async gerarComTier(message, tier, task) {
        const config = require('../config');
        const cfg = config.GEN_TIERS[tier];
        const codeFile = require('../utils/codeFile');
        const dir = path.join(__dirname, '..', 'temp');
        const pedido = String(task).replace(/(?:^|\s)!(min|med|high|max)\b/i, '').trim();

        try {
            await message.reactions.removeAll().catch(() => {});

            const ehHtml = /\b(html|site|pagina|página|landing|web)\b/i.test(pedido) && !/\b(react|next|vue|angular|flutter|django|rails|spring|api rest)\b/i.test(pedido);
            const arquivoUnico = ehHtml && tier !== 'MAX';

            let resultado;
            if (arquivoUnico) {
                await message.react('📝').catch(() => {});
                await message.channel.send({ content: `📝 Gerando HTML único (tier ${cfg.label})…` }).catch(() => {});
                const html = await codeFile.gerarHtmlUnico({
                    chat: (args) => clienteTarefa.chat({ ...args, contexto: args.contexto }),
                    pedido,
                    maxTokens: cfg.tokens,
                });
                if (!html || html.length < 50) {
                    await message.reply({ content: '❌ O modelo devolveu HTML vazio. Tenta de novo!' }).catch(() => {});
                    return null;
                }
                const nome = require('../utils/codeFile').nomeDeArquivo('index.html');
                require('../utils/codeFile').garantirPasta(path.join(dir, nome));
                fs.writeFileSync(path.join(dir, nome), html, 'utf8');
                const embed = new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle('🌐 Página Gerada!')
                    .setDescription(`**${nome}** — HTML, CSS e JS no mesmo arquivo`)
                    .addFields(
                        { name: '📏 Tamanho', value: `${(html.length / 1024).toFixed(1)} KB`, inline: true },
                        { name: '📝 Linhas', value: `${html.split('\n').length}`, inline: true },
                        { name: '⚙️ Tier', value: `${cfg.label} (${(cfg.tokens / 1000).toFixed(0)}k)`, inline: true }
                    )
                    .setFooter({ text: `Por ${message.author.username}` })
                    .setTimestamp();
                await message.reply({ embeds: [embed], files: [{ attachment: path.join(dir, nome), name: nome }] });
                setTimeout(() => { try { fs.unlinkSync(path.join(dir, nome)); } catch (e) {} }, 120000);
                logInfo(`TaskRunner: HTML unico tier ${cfg.label}, ${html.length} chars`);
                return null;
            }

            // Multi-arquivo: o plano vai aparecendo no canal conforme gera.
            const enviado = await message.channel.send({ content: '🧠 Projetando o que precisa ser criado…' }).catch(() => null);
            let ultimo = '';
            resultado = await codeFile.gerarProjeto({
                chat: (args) => clienteTarefa.chat({ ...args, contexto: args.contexto }),
                pedido,
                tierLabel: cfg.label,
                maxTokens: cfg.tokens,
                pasta: dir,
                progress: async (msg) => {
                    if (enviado && msg !== ultimo) {
                        ultimo = msg;
                        await enviado.edit({ content: `⏳ ${msg}…` }).catch(() => {});
                    }
                },
            });

            await message.react('✅').catch(() => {});
            // Soma o tamanho dos arquivos, não dos zips: os números por
            // arquivo vinham do conteudo com o cabeçalho de contagem dentro,
            // o que lia como lixo no preview.
            const resumo = resultado.arquivos
                .map(a => `\`${a.nome}\` — ${(a.conteudo.length / 1024).toFixed(1)} KB`)
                .join('\n');
            const embed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle('📦 Projeto Gerado!')
                .setDescription(
                    `**${resultado.arquivos.length} arquivo(s)** no tier \`${cfg.label}\` (${(cfg.tokens / 1000).toFixed(0)}k tokens cada)\n\n${resumo}`
                )
                .setFooter({ text: `Por ${message.author.username}` })
                .setTimestamp();
            if (resultado.falhas.length) {
                embed.addFields({ name: '⚠️ Não gerados', value: resultado.falhas.map(f => `\`${f.nome}\``).join(', ') });
            }
            const anexos = resultado.partes.map(p => ({ attachment: p.caminho, name: p.nome }));
            await message.reply({ embeds: [embed], files: anexos });

            const limpar = () => resultado.partes.forEach(p => { try { fs.unlinkSync(p.caminho); } catch (e) {} });
            setTimeout(limpar, 300000);

            logInfo(`TaskRunner: projeto tier ${cfg.label}, ${resultado.arquivos.length} arquivo(s) em ${resultado.partes.length} zip(s)`);
            return null;
        } catch (error) {
            logError(`TaskRunner: tier ${cfg.label} falhou: ${error.message}`);
            await message.reactions.removeAll().catch(() => {});
            await message.reply({ content: `❌ Erro na geração (${cfg.label}): ${error.message.substring(0, 200)}` }).catch(() => {});
            return null;
        }
    }

    static async createFileFromCode(message, result) {
        const preferred = this.detectLanguage(message.content);

        // 1º: procurar bloco fechado ```...```
        const blocks = result.match(/```(\w+)?\n?([\s\S]*?)```/g);
        let first = null;
        if (preferred) {
            const preferredBlock = blocks && blocks.find(b => {
                const m = b.match(/```(\w+)/);
                if (!m) return false;
                return this._langMatches(m[1].toLowerCase(), preferred);
            });
            if (preferredBlock) first = preferredBlock;
        }
        if (!first) first = blocks && blocks[0];

        let content = null;
        let lang = 'txt';

        if (first) {
            const langMatch = first.match(/```(\w+)/);
            lang = langMatch ? langMatch[1].toLowerCase() : 'txt';
            if (preferred && !this._langMatches(lang, preferred)) lang = preferred.ext;
            content = first.replace(/```\w*\n?/, '').replace(/```$/, '').trim();
        } else if (preferred) {
            // 2º: sem bloco fechado → extrair tudo que sobrou da resposta (código solto/cortado)
            const lines = result.split('\n');
            const codeStart = lines.findIndex(l => /^```/.test(l.trim()));
            content = (codeStart >= 0 ? lines.slice(codeStart + 1) : lines)
                .join('\n')
                .replace(/```/g, '')
                .replace(/^importação[\s\S]*?$/i, '')
                .trim();
            lang = preferred.ext;
            if (content.includes('#!') || /^(const|let|var|function|class|import|require|console\.)/m.test(content)) lang = 'js';
        }

        if (!content || content.length < 3) return result;

        // Limpar comentário de título que o modelo insere ("Calculadora simples em Python")
        content = content.replace(/^[A-Za-zÁ-ú][^;\n]{0,60}\n/i, '').trim();

        if (content.length < 3) return result;

        const nameMap = {
            js: 'script.js', javascript: 'script.js', jsx: 'script.jsx',
            py: 'script.py', python: 'script.py',
            html: 'index.html', css: 'style.css', json: 'data.json',
            md: 'README.md', markdown: 'README.md', sql: 'script.sql',
            sh: 'script.sh', bash: 'script.sh', bat: 'script.bat',
            java: 'Main.java', c: 'main.c', cpp: 'main.cpp',
            cs: 'Program.cs', 'c#': 'Program.cs', csharp: 'Program.cs',
            rust: 'main.rs', rs: 'main.rs',
            php: 'script.php', ts: 'script.ts', typescript: 'script.ts'
        };
        const extMap = { js: '.js', javascript: '.js', jsx: '.jsx', py: '.py', python: '.py', html: '.html', css: '.css', json: '.json', md: '.md', markdown: '.md', sql: '.sql', sh: '.sh', bash: '.sh', bat: '.bat', java: '.java', c: '.c', cpp: '.cpp', cs: '.cs', 'c#': '.cs', csharp: '.cs', rust: '.rs', rs: '.rs', php: '.php', ts: '.ts', typescript: '.ts', txt: '.txt' };

        const artificial = `[ARQUIVO: ${nameMap[lang] || 'arquivo' + (extMap[lang] || '.txt')}]\n${content}`;
        return await this.createFile(message, artificial);
    }

    static async createFile(message, result) {
        // O modelo alterna entre [ARQUIVO: x] e [FILE: x] na mesma sessão.
        // Aceitar só um fazia o arquivo cair no nome genérico
        // arquivo-<timestamp>.txt e perder a extensão .tsx/.html/etc.
        const codeFile = require('../utils/codeFile');
        const marcado = codeFile.extrairNomeMarcado(result);
        // O nome vem do MODELO, sem nenhuma garantia. "src/index.tsx" é um
        // pedido legítimo de subpasta, mas "../../../../tmp/EVIL.txt" sai de
        // temp/ e grava em qualquer lugar do sistema. nomeDeArquivo garante
        // que o resultado fique dentro de temp/; garantirPasta cria a
        // subpasta, que antes fazia o writeFileSync estourar ENOENT.
        const bruto = marcado || `arquivo-${Date.now()}.txt`;
        const fileName = require('../utils/codeFile').nomeDeArquivo(bruto);
        // O corpo NÃO é a resposta menos a tag [ARQUIVO:]. O modelo devolve
        // a resposta inteira no formato do prompt:
        //     FILE:  [ARQUIVO: src/Calculator.tsx]
        //     AÇÃO:  [ACAO: CREATE] + execute
        //     CODE:  ```tsx ... ```   <- o código
        //     <parágrafo de prosa no final>
        // Gravar isso como .tsx produzia um arquivo que não compila: tinha
        // "AÇÃO:", a cerca ``` e a prosa dentro do fonte. extrairConteudo
        // pega só o que é código.
        const fileContent = codeFile.extrairConteudo(result, fileName);

        const dir = path.join(__dirname, '..', 'temp');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const filePath = path.join(dir, fileName);
        require('../utils/codeFile').garantirPasta(filePath);
        fs.writeFileSync(filePath, fileContent, 'utf8');

        // O nome enviado ao Discord é só o basename: um anexo chamado
        // "src/index.tsx" é aceito, mas o cliente mostra só "index.tsx" e a
        // subpasta fica no embed, que é onde o usuário consegue ler.
        const nomeAnexo = path.basename(fileName);

        const ext = path.extname(fileName).toLowerCase();
        const emojiMap = { '.js': '💛', '.py': '🐍', '.html': '🌐', '.css': '🎨', '.json': '📋', '.csv': '📊', '.md': '📝', '.bat': '⚙️', '.sh': '🐧', '.java': '☕', '.cpp': '🔧', '.c': '⚡', '.php': '🐘', '.sql': '🗄️', '.txt': '📄' };
        const emoji = emojiMap[ext] || '📄';

        const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle(`${emoji} Arquivo Criado!`)
            .setDescription(fileName.includes('/') ? `\`\`\`${fileName}\`\`\`` : `**${fileName}**`)
            .addFields(
                { name: '📏 Tamanho', value: `${(fileContent.length / 1024).toFixed(1)} KB`, inline: true },
                { name: '📝 Linhas', value: `${fileContent.split('\n').length}`, inline: true },
                { name: '🏷️ Tipo', value: ext.replace('.', '').toUpperCase(), inline: true }
            )
            .setFooter({ text: `Criado por ${message.author.username}` })
            .setTimestamp();

        await message.reply({ embeds: [embed], files: [{ attachment: filePath, name: nomeAnexo }] });

        setTimeout(() => { try { fs.unlinkSync(filePath); } catch (e) {} }, 120000);
        return null;
    }

    static async sendAsFile(message, content, fileName) {
        const dir = path.join(__dirname, '..', 'temp');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        const filePath = path.join(dir, fileName);
        fs.writeFileSync(filePath, content, 'utf8');

        await message.reply({ content: '📄 Conteúdo grande, mandei como arquivo!', files: [{ attachment: filePath, name: fileName }] });

        setTimeout(() => { try { fs.unlinkSync(filePath); } catch (e) {} }, 120000);
        return null;
    }

    // Só DONO, admin ou quem tem a permissão de moderação pode pedir ações de punição
    static canModerate(message, actionType) {
        const member = message.member;
        if (!member) return false;
        if (message.author.id === process.env.OWNER_ID) return true;
        try {
            const { isAdmin } = require('../utils/permissions');
            if (isAdmin(member)) return true;
        } catch (e) {}
        const perms = member.permissions;
        if (['mutar', 'mute', 'silenciar'].includes(actionType)) return perms.has(PermissionFlagsBits.ModerateMembers);
        if (['expulsar', 'kick'].includes(actionType)) return perms.has(PermissionFlagsBits.KickMembers);
        if (['banir', 'ban'].includes(actionType)) return perms.has(PermissionFlagsBits.BanMembers);
        return false;
    }

    /**
     * B27: quem pode PUBLICAR em vários canais.
     *
     * Publicação em massa é uma ação destrutiva como punição: apaga o
     * sentido do canal e alcança todos que o leem. Por isso o mesmo peso de
     * `ManageMessages` que o Discord usa para apagar mensagem em massa.
     */
    static canPublish(message) {
        const member = message.member;
        if (!member) return false;
        if (message.author.id === process.env.OWNER_ID) return true;
        try {
            const { isAdmin } = require('../utils/permissions');
            if (isAdmin(member)) return true;
        } catch (e) {}
        return member.permissions.has(PermissionFlagsBits.ManageMessages);
    }

    static async executeAction(message, result) {
        const actionMatch = result.match(/\[ACAO:\s*(.+?)\]/i);
        const actionType = actionMatch ? actionMatch[1].trim().toLowerCase() : '';
        const mentionMatch = message.content.match(/<@!?(\d+)>/);
        const targetId = mentionMatch ? mentionMatch[1] : null;
        const targetUser = targetId ? await message.guild.members.fetch(targetId).catch(() => null) : null;

        // BLOQUEAR ações de punição sem permissão (ANTES de qualquer execução)
        if (['mutar', 'mute', 'silenciar', 'expulsar', 'kick', 'banir', 'ban'].includes(actionType) &&
            !this.canModerate(message, actionType)) {
            await message.reply({ content: '❌ Você não tem permissão para executar essa ação.' });
            return null;
        }

        // B27: PUBLICAR em vários canais é tão destrutivo quanto punir, e
        // estava fora da lista acima. Um membro comum podia pedir
        // broadcast em até 8 canais de texto do servidor com conteúdo
        // gerado pelo modelo. Publicação em massa pede ManageMessages.
        const PUBLICACAO = ['avisar_todos', 'anunciar_todos', 'broadcast', 'anunciar', 'anuncio'];
        if (PUBLICACAO.includes(actionType) && !this.canPublish(message)) {
            await message.reply({ content: '❌ Você não tem permissão para publicar em vários canais.' });
            return null;
        }

        if (!targetUser && ['mutar', 'mute', 'silenciar', 'expulsar', 'kick', 'banir', 'ban'].includes(actionType)) {
            await message.reply({ content: '❌ Mencione o usuário!' });
            return null;
        }

        switch (actionType) {
            case 'mutar': case 'mute': case 'silenciar':
                try {
                    const duration = this.extractDuration(message.content);
                    await targetUser.timeout(duration, `Silenciado por ${message.author.username}`);
                    
                    const muteEmbed = new EmbedBuilder()
                        .setColor(0xFFA500)
                        .setTitle('🔇 Silenciado')
                        .setDescription(`${targetUser.user.username} foi silenciado!`)
                        .addFields(
                            { name: '⏱️ Duração', value: this.formatDuration(duration), inline: true },
                            { name: '👮 Por', value: message.author.username, inline: true }
                        ).setTimestamp();

                    await message.reply({ embeds: [muteEmbed] });
                } catch (e) {
                    await message.reply({ content: '❌ Sem permissão para silenciar.' });
                }
                break;

            case 'expulsar': case 'kick':
                try {
                    await targetUser.kick('Expulso pelo HostBot');
                    await message.reply({ content: `👢 ${targetUser.user.username} foi expulso!` });
                } catch (e) {
                    await message.reply({ content: '❌ Sem permissão para expulsar.' });
                }
                break;

            case 'banir': case 'ban':
                try {
                    await targetUser.ban({ reason: 'Banido pelo HostBot' });
                    await message.reply({ content: `🔨 ${targetUser.user.username} foi banido!` });
                } catch (e) {
                    await message.reply({ content: '❌ Sem permissão para banir.' });
                }
                break;

            case 'anunciar': case 'anuncio':
                const announceText = result.replace(/\[ACAO:\s*.+?\]/i, '').trim();
                if (announceText) {
                    await message.channel.send({ 
                        embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📢 Anúncio').setDescription(announceText).setFooter({ text: `Por ${message.author.username}` }).setTimestamp()]
                    });
                }
                break;

            // Enviar uma resposta ENFILEIRADA para outro canal (async + persistente)
            case 'responder_canal': case 'enviar_canal': case 'enviar': {
                const QueueManager = require('./QueueManager');
                const chanMatch = message.content.match(/<#(\d+)>/) || result.match(/CANAL\s*:\s*<#(\d+)>/i);
                const chanId = chanMatch ? chanMatch[1] : null;
                const sendText = result.replace(/\[ACAO:\s*.+?\]/i, '').trim();
                if (chanId && sendText) {
                    // B25: a guild vai junto no item da fila. Sem ela,
                    // _resolveChannels não tem como provar que o canal é da
                    // nossa guild — e o filtro que exige prova rejeita.
                    const ch = message.guild?.channels?.cache?.get(chanId);
                    if (!ch || ch.guildId !== message.guild.id) {
                        await message.reply({ content: '❌ Esse canal não está neste servidor.' });
                        break;
                    }
                    QueueManager.enqueue({ guildId: message.guild.id, channelId: chanId, content: sendText });
                    await message.reply({ content: `📤 Mensagem enfileirada para <#${chanId}>.` });
                } else {
                    await message.reply({ content: '❌ Mencione o canal (<#id>) e o texto a enviar.' });
                }
                break;
            }

            // Broadcast ENFILEIRADO em todos os canais de texto da guild
            case 'avisar_todos': case 'anunciar_todos': case 'broadcast': {
                const QueueManager = require('./QueueManager');
                const broadcastText = result.replace(/\[ACAO:\s*.+?\]/i, '').trim();
                if (broadcastText && message.guild) {
                    // B27: o texto que o MODELO gerou passa pelo filtro de
                    // palavra antes de virar publicação.
                    //
                    // O filtro de messageCreate só roda na ENTRADA do
                    // usuário. Um broadcast é a SAÍDA do bot: se o modelo
                    // produzir texto ofensivo, ele é publicado em até 8
                    // canais de uma vez e o filtro de palavra nunca o vê.
                    // A entrada protegida (InjectionGuard + rate limit) não
                    // cobre isto: protege o pedido, não o conteúdo gerado.
                    const { analyze } = require('../utils/moderation/OffensiveEngine');
                    const mod = analyze(broadcastText);
                    if (mod.flagged) {
                        const termo = (mod.matched || [])[0]?.text || 'desconhecido';
                        logInfo(`[TaskRunner] broadcast barrado: ${termo} [${mod.category}/${mod.severity}]`);
                        await message.reply({
                            content: '❌ O texto do broadcast contém termo ofensivo e não foi publicado.'
                        });
                        break;
                    }
                    QueueManager.enqueue({ guildId: message.guild.id, broadcast: true, content: broadcastText });
                    await message.reply({ content: '📤 Broadcast enfileirado!' });
                } else {
                    await message.reply({ content: '❌ Texto do broadcast vazio.' });
                }
                break;
            }

            default:
                // safeContent: este default é alcançado quando o tipo da ação é
                // conhecido mas o switch não cobre o caso. O texto do modelo
                // pode passar de 2000 chars e o Discord recusa a mensagem
                // inteira — melhor cortar do que perder o envio.
                await message.reply({
                    content: safeContent(
                        result.replace(/\[ACAO:\s*.+?\]/i, '').trim() || `✅ Ação executada!`
                    )
                });
        }

        return null;
    }

    static extractDuration(text) {
        const patterns = [
            { regex: /(\d+)\s*(minutos?|mins?|m)\b/i, ms: 60000 },
            { regex: /(\d+)\s*(horas?|hrs?|h)\b/i, ms: 3600000 },
            { regex: /(\d+)\s*(segundos?|segs?|s)\b/i, ms: 1000 },
            { regex: /(\d+)\s*(dias?|d)\b/i, ms: 86400000 }
        ];
        for (const p of patterns) {
            const match = text.match(p.regex);
            if (match) return parseInt(match[1]) * p.ms;
        }
        return 600000;
    }

    static formatDuration(ms) {
        const minutes = Math.floor(ms / 60000);
        const hours = Math.floor(minutes / 60);
        if (hours > 0) return `${hours}h ${minutes % 60}min`;
        return `${minutes} minutos`;
    }
}

module.exports = TaskRunner;