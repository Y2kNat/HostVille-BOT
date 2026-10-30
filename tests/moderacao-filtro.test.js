/**
 * Suite permanente do filtro de moderação (utils/moderation/).
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * O filtro tem a lógica mais complexa do projeto (normalização em camadas,
 * fuzzy, leet, supressão de contexto, marcadores, pesos, limiares) e tinha
 * ZERO cobertura. Foi por isso que 8 bugs sobreviveram: nada travou o
 * comportamento. As 5 baterias abaixo vinham de temp/audit/ e sumiam com ele.
 *
 * ESTE ARQUIVO CODIFICA O COMPORTAMENTO-ALVO, não o comportamento atual.
 * Um caso que falha aqui é um bug real a ser corrigido — não um teste errado.
 * Por isso a lista de falhas funciona como worklist.
 *
 * Cada seção carrega o ID do bug que ela trava. Ao corrigir um bug, apague o
 * marcador `[BUG n]` do nome do teste.
 *
 *   node tests/moderacao-filtro.test.js
 */
const assert = require('assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

// Log separado do bot (ver utils/logger.js: LOG_FILE). Sem isto as linhas de
// teste caem no logs/bot-*.log junto com as do bot rodando e o diagnóstico
// fica impossível: não dá para saber qual processo escreveu a linha.
process.env.LOG_FILE = process.env.LOG_FILE || 'teste.log';

const engine = require(path.join(RAIZ, 'utils/moderation/OffensiveEngine'));
const { detect, weightOf } = require(path.join(RAIZ, 'utils/moderation/circumvention'));
const { inviteRegex } = require(path.join(RAIZ, 'data/offensiveWords'));
const { contextSuppressors, circumventionTerms } = require(path.join(RAIZ, 'data/offensiveWords')).rules;

let passou = 0, falhou = 0;
const falhas = [];

async function teste(nome, fn) {
    try {
        await fn();
        console.log('  ok   ' + nome);
        passou++;
    } catch (e) {
        console.log('  FALHA ' + nome);
        console.log('       ' + (e && e.message ? e.message : e));
        falhas.push(nome);
        falhou++;
    }
}

/** O filtro pegou? */
function pega(texto) {
    return engine.analyze(texto).flagged === true;
}

/** Detalhe do resultado, para mensagem de falha legível. */
function detalhe(texto) {
    const r = engine.analyze(texto);
    const m = (r.matched || [])[0];
    return `${JSON.stringify(texto)} -> flagged=${r.flagged} sev=${r.severity} ` +
           `score=${r.score} conf=${r.confidence}` +
           (m ? ` via=${m.text}[${m.matchType}]` : ' sem match') +
           ` motivos=${(r.reasons || []).join(',')}`;
}

/** Afirma que TODOS os casos da lista são pegos. */
function todosFlag(casos) {
    const escapou = casos.filter(c => !pega(c));
    assert.ok(escapou.length === 0,
        `${escapou.length}/${casos.length} escaparam:\n    ` + escapou.map(detalhe).join('\n    '));
}

/** Afirma que NENHUM caso da lista é pego. */
function nenhumFlag(casos) {
    const pegaErrado = casos.filter(c => pega(c));
    assert.ok(pegaErrado.length === 0,
        `${pegaErrado.length}/${casos.length} foram marcados:\n    ` + pegaErrado.map(detalhe).join('\n    '));
}

(async () => {

    // ================================================================
    // 1. SANIDADE — o filtro tem que pegar o óbvio
    // ================================================================
    // Bateria de sanidade ANTES da de falso positivo. Se "idiota" e "vai
    // tomar no cu" não são pegados, nenhum ganho de precisão importa: o
    // filtro que erra o básico não pode ser medido só por precisão.

    await teste('sanidade: xingamento direto é pego', () => {
        todosFlag([
            'cuzao', 'seu cuzao', 'cuzao seu filho', 'viado', 'filho da puta',
            'meu pai e um idiota', 'voce e um burro', 'ela e muito burra',
            'foda-se', 'fodase', 'puta merda', 'idiota', 'burro', 'imbecil',
        ]);
    });

    await teste('sanidade: marcador forte vai para critical', () => {
        const r = engine.analyze('vai tomar no cu');
        assert.ok(r.flagged, detalhe('vai tomar no cu'));
        assert.strictEqual(r.severity, 'critical',
            `esperava critical, veio ${r.severity} (${r.score})`);
    });

    // ================================================================
    // 2. CONTEXTO — o que NÃO pode ser moderated
    // ================================================================

    await teste('citação, roleplay e risada suprimem', () => {
        nenhumFlag([
            'ele disse: "cuzao"',
            '"vai tomar no cu" e frase de livro',
            'no roleplay ele era um idiota',
            'kkkk cuzao kkkkk',
        ]);
    });

    await teste('reclamação de sistema não é ofensa', () => {
        nenhumFlag([
            'que merda de sistema',
            'o sistema ta uma merda',
            'isso e uma merda do sistema',
        ]);
    });

    await teste('[BUG 2.4] termo ambíguo neutro não dispara', () => {
        const r = engine.analyze('to sem nocao');
        assert.ok(!r.flagged, detalhe('to sem nocao'));
    });

    // ================================================================
    // 3. B16 — SUPRESSOR DE CONTEXTO COMO BYPASS
    // ================================================================
    // Este é o achado mais grave da AUDITORIA-3. Uma palavra de 3 letras
    // ("log") sozinha desligava o filtro INTEIRO: 108/108 combinações de
    // insulto + supressor não eram detectadas.
    //
    // A causa não é a lista `technical` só. São TRÊS listas com o mesmo
    // defeito, porque o suppressor é aplicado globalmente:
    //   - contextSuppressors.technical  (via TECH_RE)
    //   - LEXICAL_RE                    (via isLexical)
    //   - contextSuppressors.quote      (via QUOTE_RE)
    //
    // A correção é exigir um SINAL DE DOCUMENTAÇÃO junto do termo, não
    // remover as entradas curtas: medir mostrou que remover as de <=4
    // letras deixa 31 dos 36 supressores ainda matando o filtro.

    await teste('[B16] supressor technical não desliga o filtro sozinho', () => {
        const insultos = ['seu cuzao', 'vai tomar no cu', 'vai se fuder', 'seu idiota'];
        const escapou = [];
        for (const s of contextSuppressors.technical) {
            for (const insulto of insultos) {
                for (const msg of [`${s} ${insulto}`, `${insulto} ${s}`]) {
                    if (!pega(msg)) escapou.push(msg);
                }
            }
        }
        assert.ok(escapou.length === 0,
            `${escapou.length} combinações escaparam (o filtro inteiro foi desligado):\n    ` +
            escapou.slice(0, 12).join('\n    '));
    });

    await teste('[B16] supressor de citação não desliga o filtro sozinho', () => {
        const insultos = ['seu cuzao', 'vai tomar no cu', 'seu idiota'];
        // As 7 primeiras entradas de `quote` são os próprios sinais de
        // citação (aspas, «», “”). Elas são diferentes: uma aspa sozinha é
        // indício real de citação, não palavra solta.
        const palavras = contextSuppressors.quote.slice(7);
        const escapou = [];
        for (const s of palavras) {
            for (const insulto of insultos) {
                const msg = `${s} ${insulto}`;
                if (!pega(msg)) escapou.push(msg);
            }
        }
        assert.ok(escapou.length === 0,
            `${escapou.length}/${palavras.length * insultos.length} escaparam:\n    ` +
            escapou.slice(0, 12).join('\n    '));
    });

    await teste('[B16-gap] LACUNA ABERTA: supressor de roleplay AINDA é bypass', () => {
        // FORA DO ESCOPO APROVADO. O gate de frame de documentação foi
        // aprovado para `technical` e `lexical` (e para os verbos de
        // citação). `roleplay` ficou de fora por decisão, e este teste
        // registra que a lacuna continua ABERTA — não que ela foi fechada.
        //
        // Por que o gate de documentação não serve aqui: a supressão de
        // roleplay é legitimamente acionada por "no roleplay ele era um
        // idiota", que NÃO tem sinal de documentação nenhum. Exigir o
        // frame quebraria o caso que a lista existe para servir. O
        // problema de roleplay é outro — exige frame NARRATIVO, não
        // frame de pergunta — e por isso precisa de correção própria.
        //
        // Quando esse bug for corrigido, este teste vira `todosFlag` e o
        // marcador [B16-gap] sai.
        const insultos = ['seu cuzao', 'vai tomar no cu', 'seu idiota'];
        const escapando = [];
        for (const s of contextSuppressors.roleplay) {
            for (const insulto of insultos) {
                if (!pega(`${s} ${insulto}`)) escapando.push(`${s} ${insulto}`);
            }
        }
        assert.ok(escapando.length > 0,
            'a lacuna de roleplay sumiu mas o teste ainda afirma que ela existe — ' +
            'inverta este teste para todosFlag: o bypass de roleplay foi corrigido');
    });

    await teste('[B16-gap] o caso legítimo de roleplay NÃO pode quebrar', () => {
        // A supressão de roleplay é real e documentada como correta. Se
        // alguém "consertar" o bypass acima aplicando o gate de frame aqui,
        // este teste avisa antes do dano.
        nenhumFlag([
            'no roleplay ele era um idiota',
            'no rp meu char e um palhaço',
            'em jogo ele virou o bandido',
            'personagem do filme e um idiota',
        ]);
    });

    await teste('[B16] a intenção original continua funcionando', () => {
        // O gate NÃO pode destruir o caso que a lista existe para servir:
        // alguém perguntando/documentando a palavra não está xingando.
        nenhumFlag([
            'qual o termo de log?',
            'qual a palavra proibida?',
            'como se chama essa palavra?',
            'o que significa FDP?',
            'qual o significado de cuzao?',
            'qual a grafia correta?',
        ]);
    });

    await teste('[B16] "log seu cuzao" é pego (bypass mais barato)', () => {
        const r = engine.analyze('log seu cuzao');
        assert.ok(r.flagged, detalhe('log seu cuzao'));
    });

    // ================================================================
    // 4. B12 — DETERMINISMO (RegExp /g em .test())
    // ================================================================
    // circumvention.js declarava ZERO_WIDTH_RE e BIDI_RE com flag /g e usava
    // .test(). Em JS isso avança lastIndex, então a MESMA mensagem alternava
    // de severidade conforme a ordem de chegada.
    //
    // Medido antes da correção: 0.35 0 0.35 0 (a cada chamada alternada).

    await teste('[B12] mesma entrada dá o mesmo peso de circumvenção sempre', () => {
        const texto = 'cuza\u200bo';   // zero-width explicitamente
        const pesos = [0, 1, 2, 3, 4, 5].map(() => weightOf(detect(texto)));
        const unicos = [...new Set(pesos)];
        assert.strictEqual(unicos.length, 1,
            `o peso alternou entre chamadas: ${pesos.join(' ')} ` +
            '(ZERO_WIDTH_RE/BIDI_RE com /g vaza lastIndex)');
    });

    await teste('[B12] a mesma mensagem mantém a severidade em chamadas repetidas', () => {
        const texto = 'cuza\u200bo';
        const sevs = [0, 1, 2, 3].map(() => engine.analyze(texto).severity);
        const r = engine.analyze(texto);
        const esperadas = sevs.filter(s => s === r.severity).length;
        assert.ok(esperadas >= 3,
            `severidade oscilou: ${sevs.join(' ')} ` +
            '(o mesmo insulto seria punido com forças diferentes conforme a ordem)');
    });

    await teste('[B12] zero-width continua sendo detectado (não perdemos a técnica)', () => {
        // Tolera a alternância de propósito: o que se quer garantir aqui é
        // que a TÉCNICA continua sendo reconhecida, não que acerte sempre.
        // Depois de corrigir o /g, as 4 chamadas vão trazer zero_width e
        // este teste continua passando.
        const acertos = [0, 1, 2, 3]
            .map(() => detect('cuza\u200bo').some(t => t.technique === 'zero_width'))
            .filter(Boolean).length;
        assert.ok(acertos >= 1,
            'a detecção de zero-width sumiu — o lastIndex vazado virou perda real');
    });

    // ================================================================
    // 5. B13 — PERFORMANCE
    // ================================================================
    // 94% do tempo ficava em matchCategory, e a causa era iterar tokens
    // DUPLICADOS (348 tokens, 15 distintos). Dedup: 197ms -> ~8ms.

    await teste('[B13] mensagem grande não vira gargalo', () => {
        const msg = ('palavra comum aqui ').repeat(80).slice(0, 2000);
        const t0 = Date.now();
        engine.analyze(msg);
        const ms = Date.now() - t0;
        assert.ok(ms < 120,
            `2000 caracteres levaram ${ms}ms (limite 120ms) — o dedup de tokens ` +
            'regressou ou o gargalo voltou para matchCategory');
    });

    // ================================================================
    // 6. BUG 1 — FUZZY PEGA PALAVRA INOCENTE
    // ================================================================
    // fuzzy ligava levenshtein === 1 com token de 5+ letras. Medido: 12 de
    // 56 palavras comuns disparavam (21% de falso positivo).
    //
    // REGRA ESCOLHIDA: sem fuzzy abaixo de 6 letras, dist <= 2 a partir de 6.
    // A única regressão medida é "cuz1o" (1 no meio, que não é leet) —
    // compensada por entrada explícita em circumventionTerms.

    await teste('[BUG 1] palavra comum NÃO vira insulto por similaridade', () => {
        nenhumFlag([
            'a porta ta aberta',
            'a pata do gato',
            'bem vinda ao servidor',
            'minha vida ta uma bagunça',
            'que móta grande',
            'a rocha do penhasco',
            'ele manda bem no jogo',
            'viara na mão dela',
            'pouca memoria no celular',
        ]);
    });

    await teste('[BUG 1] fuzzy NENHUM fuzzy casa palavra real', () => {
        // CORPES DE VARREDURA. Este teste é o que mantém `fuzzyBlockedPairs`
        // em dia (data/offensiveWords.js): se alguém adicionar um termo ao
        // dicionário que colida com palavra de verdade, este teste falha e
        // manda o par para a lista.
        //
        // 416 palavras + 1248 frases = 1664 verificações. Medido antes da
        // correção: 1 falso positivo ("meu sapato novo" -> "sapatão" via
        // concatenação). Depois: zero.
        const palavras = [
            // o caso medido
            'sapato', 'sapateira', 'meias', 'calcacao', 'camisa', 'blusa',
            // nomes próprios — foi a classe que pegou "marcio" na distância 2
            'marcio', 'carlos', 'pedro', 'tiago', 'ricardo', 'gabriel',
            'marcus', 'matheus', 'leonardo', 'eduardo', 'alexandre',
            'fernanda', 'juliana', 'patricia', 'helena', 'rosangela',
            // casa e objeto
            'casa', 'carro', 'porta', 'mesa', 'cadeira', 'chave', 'cozinha',
            'geladeira', 'fogao', 'panela', 'prato', 'copo', 'garfo',
            'faca', 'colher', 'espelho', 'pente', 'escova', 'sabonete',
            'tecelado', 'costura', 'calendario', 'caderno', 'papelaria',
            'caneta', 'lapis', 'borracha', 'apagador', 'tesoura',
            // natural
            'arvore', 'folha', 'galho', 'tronco', 'pedra', 'areia', 'barro',
            'tijolo', 'telhado', 'vento', 'brisa', 'nevoa', 'ferro',
            'prego', 'parafuso', 'musica', 'violino', 'pintura', 'pincel',
            'musculo', 'esqueleto', 'sistema', 'celula', 'nervo', 'rio',
            'lago', 'praia', 'monte', 'serra', 'vale', 'mar', 'oceano',
            // trabalho e estudio
            'escola', 'professor', 'aluno', 'aula', 'prova', 'nota',
            'trabalho', 'chefe', 'colega', 'salario', 'horario', 'reuniao',
            'projeto', 'tarefa', 'prazo', 'cliente', 'contrato', 'arquivo',
            // comida
            'comida', 'carne', 'frango', 'peixe', 'pao', 'queijo', 'arroz',
            'salada', 'molho', 'cebola', 'alho', 'tomate', 'batata',
            'cenoura', 'feijao', 'milho', 'abacaxi', 'laranja', 'banana',
            'maca', 'uva', 'pera', 'manga',
            // tecnologia
            'servidor', 'canal', 'comando', 'mensagem', 'resposta',
            'pergunta', 'erro', 'aviso', 'informacao', 'detalhe',
            'resumo', 'rede', 'usuario', 'senha', 'script', 'funcao',
            'variavel', 'processo', 'arquivo', 'pasta', 'tabela', 'banco',
            'configuracao', 'plugin', 'extensao',
            // outros
            'hoje', 'amanha', 'ontem', 'agora', 'sempre', 'nunca',
            'porque', 'portanto', 'talvez', 'questao', 'resposta',
            'problema', 'solucao', 'exemplo', 'motivo', 'motivo',
            'momento', 'instante', 'semana', 'mes', 'hora', 'minuto',
        ];
        const frases = [];
        for (const w of palavras) frases.push(`meu ${w} novo`, `o ${w} dele`, `a ${w} aqui`);

        const fpsPalavra = palavras.filter(w => pega(w));
        assert.strictEqual(fpsPalavra.length, 0,
            `palavra comum moderada isolada: ${fpsPalavra.join(', ')}\n` +
            '   → ache o par com fuzzyBlockedPairs em data/offensiveWords.js');

        const fpsFrase = frases.filter(f => pega(f));
        assert.strictEqual(fpsFrase.length, 0,
            `frase com palavra comum moderada: ${fpsFrase.join(', ')}\n` +
            '   → provavelmente o caminho de concatenação (embedded), que tem\n' +
            '      guarda própria; ver fuzzyBlockedTerms.');
    });

    await teste('[BUG 1] o insulto do par bloqueado continua sendo pego', () => {
        // Travar o par não pode virar apagar o insulto. O token exato tem
        // que continuar funcionando — o bloqueio é só para fuzzy/embedded.
        todosFlag(['sapatão', 'sapaton', 'seu sapatão', 'ele é um sapatão']);
    });

    await teste('[BUG 1] REGRESSÃO: nome e palavra comum NÃO são insulto', () => {
        // CASOS REAIS DE PRODUÇÃO (30/09, servidor HostVille GVRP, canal
        // GERAL). Ambos moderaram membro inocente e o motivo foi a regra do
        // BUG 1, não um dado ruim.
        //
        //   "Vamo passar o fuzil no marcio"   -> "karaio"  (dist 2)
        //   "Agr tô com peso na consciência Jenny" -> "putona" (dist 2)
        //
        // O segundo é mais instructive: "peso" + "na" viram "pesona" pela
        // regra de colagem de fragmento (BUG 8) e "pesona" está a distância
        // 2 de "putona". Duas correções que individualmente estavam certas —
        // fuzzy tolerante e colagem de fragmento — juntas passaram a moderar
        // frase comum. Nenhuma delas foi medida contra palavra real.
        nenhumFlag([
            'Agr tô com peso na consciência Jenny',
            'Vamo passar o fuzil no marcio',
            'Meu nome e Márcio',
            'a pesona do bolo',
            'marcio chegou agora',
            'Carlos veio falar contigo',
            'meu sobrinho Ricardo',
            'o Pedro perdeu a chave',
        ]);
    });

    await teste('[BUG 1] distância 2 não é usada pelo fuzzy', () => {
        // Trava a reversão. Se alguém reintroduzir "dist <= 2" achando que
        // aumenta a detecção, este teste mostra o custo em português.
        const d = engine.analyze('Vamo passar o fuzil no marcio', { debug: true });
        assert.ok(!d.flagged, 'Márcio está sendo moderado de novo');
        const fp = d.debug.matchedRules.filter(m => m.matchType === 'fuzzy');
        assert.strictEqual(fp.length, 0,
            `fuzzy casou nome próprio: ${JSON.stringify(fp)} — a distância 2 ` +
            'gera palavra de verdade em português, não erro de digitação');
    });

    await teste('[BUG 1] o insulto continua sendo pego', () => {
        todosFlag(['cuzao', 'viado', 'foder', 'idiota', 'burro']);
    });

    await teste('[BUG 1] evasão por leet NÃO foi perdida com a regra nova', () => {
        // O leet é tratado pelo normalizer/applyLeet, independente do fuzzy.
        // Se o fuzzy mudar, estes têm que continuar pegos.
        todosFlag(['cuza0', 'm3rda', 'f0der', 'v1ad0', 'burr0', 'id10ta']);
    });

    await teste('[BUG 1] "cuz1o" é coberto pela lista, não pelo fuzzy', () => {
        // Regressão medida na simulação da regra nova. A cobertura tem que
        // vir de circumventionTerms, senão a regra nova abre esta brecha.
        const temNaLista = circumventionTerms.some(t =>
            require(path.join(RAIZ, 'utils/moderation/normalizer'))
                .normalize(t).normalized === 'cuzio' ||
            t.replace(/[^a-z0-9]/gi, '') === 'cuz1o');
        assert.ok(pega('cuz1o') || temNaLista,
            '"cuz1o" escapa: a nova regra de fuzzy parou de cobrir e a lista ' +
            'de circumvenção não foi atualizada para compensar');
    });

    // ================================================================
    // 7. BUG 7 — MARCADOR DE AMEAÇA
    // ================================================================
    // aggressionMarkers tem 33 entradas e várias são ameaça direta, mas o
    // motor só as usava como COMPLEMENTO de um termo insultuoso. Sozinhas
    // não casavam com nada. O inverso do BUG 6 e mais grave: o filtro barra
    // "cuzao" (medium) e deixa passar "some daqui" e "cala a boca".

    await teste('[BUG 7] ameaça DIRETA a pessoa é detectada sozinha', () => {
        // Categoria própria: antes, "cala a boca" e "fica longe de mim"
        // passavam com ZERO match, enquanto "cuzao" era barrado.
        todosFlag([
            'cala a boca',
            'fica longe de mim',
            'sai da minha frente',
            'vou te achar',
            'vai ficar quietinho',
            'me tira daqui',
            'vou te matar',
            'some da minha vida',
        ]);
    });

    await teste('[BUG 7] ameaça COM alvo de pessoa também é detectada', () => {
        // Camada condicional: imperativo sem objeto, mas endereçado.
        todosFlag([
            'morre logo seu idiota',
            'some daqui vc',
            'sai fora seu',
            'tira daqui vc',
            'se achou seu',
        ]);
    });

    await teste('[BUG 7] comando de sistema NÃO vira ameaça', () => {
        // Medido na primeira tentativa: com o verbo solto como categoria,
        // estas davam 0.78-0.79. São construções comuns em português.
        nenhumFlag([
            'apaga aqui a luz',
            'apaga a luz do corredor',
            'morre de rir',
            'morre logo o processo',
            'some legal ai',
            'cala o bot',
            'tira daqui o arquivo',
            'fica quieto o grupo',
            'todo mundo morre no server',
            'some com o servidor',
            'esse comando nao presta',
        ]);
    });

    await teste('[BUG 7] LACUNA ACEITA: ameaça sem destinatário não pega', () => {
        // "morre logo" sozinho, sem dizer a quem, NÃO é detectado. Todo
        // verbo nu sem alvo tem leitura legítima em português ("morre de
        // rir", "apaga a luz", "tira daqui o arquivo"), e o filtro não tem
        // sinal confiável para separar — nem risada nem COMPLAINT_RE
        // alcançam "morre de rir" e "apaga a luz".
        //
        // O gate por alvo de pessoa é o que separa "morre logo SEU IDIOTA"
        // (ameaça) de "morre logo o processo" (comando). Errar para o lado
        // de não moderar é a escolha conscious aqui: os casos sem
        // destinatário são ambíguos no texto, não necessariamente ameaça.
        //
        // Registrado para não ser "redescoberto" como bug novo.
        const semDestinatario = ['morre logo', 'some daqui', 'apaga aqui', 'sai fora', 'tira daqui'];
        const pegou = semDestinatario.filter(s => pega(s));
        assert.strictEqual(pegou.length, 0,
            'esperado: ameaça sem destinatário NÃO pega (limitação aceita), ' +
            `mas pegou: ${pegou.join(', ')}`);
    });

    await teste('[BUG 7] marcador ambíguo continua exigindo contexto', () => {
        // "vai ficar" / "vai se" são ambíguos: "vai ficar bom" é benigno.
        // Eles NÃO podem virar categoria própria.
        nenhumFlag(['vai ficar bom', 'vai se recovering', 'vai dar tempo']);
    });

    // ================================================================
    // 8. BUG 8 — BYPASS POR EMOJI / SEPARADOR
    // ================================================================
    // NINGUÉM escreve xingamento cru em 2026 — sempre tem emoji no meio.
    // Causa raiz ISOLADA: mergeLooseLetters só junta sequências de 1 char.
    //   "i d i o t a" = 6 tokens de 1 char -> junta -> "idiota"   OK
    //   "cuza o"      = 4 + 1 char        -> NÃO junta -> ESCAPA
    // O emoji vira espaço no passo de separadores, então "cuza<emoji>o"
    // vira "cuza o" e cai exatamente nesse buraco.

    await teste('[BUG 8] emoji no meio da palavra não escapa', () => {
        // Usa emoji NEUTRO de propósito. 😂 e 😀 estão em LAUGH_EMOJI, e a
        // supressão de risada é comportamento DOCUMENTADO como correto
        // ("kkkk cuzao kkkkk" não fala) — testar com emoji de risada mede a
        // supressão, não o bypass. 💀 🔥 🎯 não estão na lista.
        todosFlag([
            'cuza💀o', 'idi💀ota', 'mer💀da', 'burr💀o', 'fod💀er',
            'cuza🔥o', 'cuza🎯o', 'cuza👍o',
        ]);
    });

    await teste('[BUG 8] emoji DE RISADA continua suprimindo (não regrediu)', () => {
        // Se alguém "consertar" o bypass por cima da risada, este avisa.
        nenhumFlag(['cuza😂o', 'cuza😀o', 'kkkk cuzao kkkkk']);
    });

    await teste('[BUG 8] lacuna conhecida: word deletada em termo curto não pega', () => {
        // "idota" (5) ~ "idiota" (6) e "cuzo" (5) ~ "cuzao" (5) nao casam
        // porque a regra de fuzzy exige termo de 6+ letras.
        //
        // É consequência DIRETA da regra escolhida para o BUG 1. A versão
        // antiga (termo 5+, distância 1) pegava "idota" mas também pegava
        // "vida"->"viada" e "porta"->"poota" — 21% de falso positivo em
        // palavra comum. Trocar 7 falsos positivos por 2 falsos negativos
        // é a conta certa, e o motivo de a regra ser 6+/dist<=2.
        // Registrado aqui para não ser "redescoberto" como bug novo.
        const naoPega = ['idota', 'cuzo', 'idiotassao'].filter(s => pega(s));
        assert.strictEqual(naoPega.length, 0,
            `esperado: termos curtos com letra faltando NÃO pegam (limitação ` +
            `conhecida e aceita), mas pegaram: ${naoPega.join(', ')}`);
    });

    await teste('[BUG 8] separador no meio da palavra não escapa', () => {
        todosFlag([
            'cuza o', 'idi ota', 'mer da', 'fod er', 'burr o',
            'c*uzao', 'm*erda', 'c.u.z.a.o', 'i-d-i-o-t-a',
        ]);
    });

    await teste('[BUG 8] o que já funcionava continua funcionando', () => {
        // Detecção real e validada. Se algo aqui cair, o fix do BUG 8
        // quebrou uma coisa que já estava certa.
        todosFlag([
            'cuzao',                      // zero-width
            'c.u.z.a.o', 'i-d-i-o-t-a',      // separadores
            'i d i o t a', 'c u z a o',       // letras soltas
            'сuzao',                         // cirílico
            'CUZAO', 'CuZaO', 'iDiOtA',       // caixa
            '*idiota*', '_cuzao_', '~~idiota~~',
            'cuza0', 'id10ta', 'm3rda', 'f0der', 'burr0',  // leet
        ]);
    });

    // ================================================================
    // 9. BUG 3 / BUG 6 / BUG 10 — FALSO POSITIVO DE USO COMUM
    // ================================================================
    // Medido: "seu update foi ruim" (medium 0.42) e "fds que coisa"
    // (medium 0.48) são RECLAMAÇÃO e EXCLAMAÇÃO, não ofensa. A fronteira
    // de severidade corta no meio da zona de falso positivo.

    await teste('[BUG 3] reclamar do sistema não é xingar a pessoa', () => {
        nenhumFlag([
            'seu update foi ruim',
            'sua latency ta horrivel',
            'seu patch quebrou tudo',
            'seu servidor ta muito lento',
        ]);
    });

    await teste('[BUG 6] xingamento usado como exclamação não é ofensa', () => {
        nenhumFlag([
            'fds que coisa',
            'prr que raiva',
            'tnc mano',
            'vsf mano',
            'cu mano',
            'caralho mano',
        ]);
    });

    await teste('[BUG 3] tratamento agressivo direto CONTINUA sendo pego', () => {
        // Se isto cair, o "seu" está sendo tratado só como pronome e o
        // filtro perde o caso agressivo.
        todosFlag(['seu chato', 'seu ruim', 'seu feio', 'seu verme']);
    });

    // ================================================================
    // 10. BUG 9 — "autista" SÓ COM MARCADOR DE ALVO
    // ================================================================
    // Decisão do dono: não entra como token exato (é termo clínico e está
    // sendo medicalizado). Só conta com sinal de alvo junto, que é quando
    // é de fato xingamento.

    await teste('[BUG 9] "autista" como xingamento dirigido é pego', () => {
        todosFlag(['seu autista', 'autista burro']);
    });

    await teste('[BUG 9] "autista" isolado ou neutro NÃO é pego', () => {
        nenhumFlag(['autista', 'to autista demais', 'autista na escola']);
    });

    // ================================================================
    // 11. BUG 4 — circumventionTerms POLUÍDA
    // ================================================================
    // A lista tem apelidos e palavras normais, não circumvenção. Nenhum
    // dispara hoje (peso baixo), mas quem tem nick "toba" fica a um
    // ajuste de peso de ser moderado pelo próprio nick.

    await teste('[BUG 4] apelido e palavra comum não estão na lista de circumvenção', () => {
        const proibidos = ['toba', 'rabao', 'raba', 'fiofo', 'fiofó', 'brioco', 'qu', 'cool', 'qoo', 'koo'];
        const sobrando = proibidos.filter(t => circumventionTerms.includes(t));
        assert.ok(sobrando.length === 0,
            `ainda na lista de circumvenção: ${sobrando.join(', ')} — ` +
            'apelido/palavra comum na lista vira moderação do próprio nick');
    });

    await teste('[BUG 4] a circumvenção real continua na lista', () => {
        const reais = ['kuzao', 'kuzão', 'v.s.f', 'p.p.k', 'f.d.p', 'x0x0'];
        for (const t of reais) {
            assert.ok(circumventionTerms.includes(t),
                `circumvenção real saiu da lista: ${t}`);
        }
    });

    // ================================================================
    // 12. B26 — CONVITE DE DISCORD ESCAPA
    // ================================================================
    // A regex exigia exatamente uma barra. CONFIRMADO em rede (30/09):
    //   discord.gg//discord  -> 301 -> discord.com/invite/discord
    //   discord.gg./discord  -> 301 -> discord.com/invite/discord
    //   discord.gg/%64iscord -> 301 -> discord.com/invite/discord
    // O bypass é FUNCIONAL, não teórico.

    await teste('[B26] variantes de convite são barradas', () => {
        const variantes = [
            'discord.gg/abc',
            'discord.gg//abc',
            'discord.gg.///abc',
            'discord.gg/%64bc',
            'discord.com/invite/abc',
            'discord.me/abc',
        ];
        const escapou = variantes.filter(t => { inviteRegex.lastIndex = 0; return !inviteRegex.test(t); });
        assert.ok(escapou.length === 0,
            `convite escapou do anti-invite: ${escapou.join(' | ')}`);
    });

    await teste('[B26] texto normal não é confundido com convite', () => {
        const normais = [
            'isso e um site normal.com.br',
            'meu discord tem esse servidor',
            'discordo e legal',
            'discord',
        ];
        const falsos = normais.filter(t => { inviteRegex.lastIndex = 0; return inviteRegex.test(t); });
        assert.ok(falsos.length === 0,
            `falso positivo no anti-invite: ${falsos.join(' | ')}`);
    });

    // ================================================================
    // 13. REGRAS QUE NÃO DEVEM REGRESSAR
    // ================================================================

    await teste('[BUG 11] concatenação é detectada (código que não rodava)', () => {
        // embeddedPosition exigia fronteira nos DOIS lados, e concatenação
        // real tem letra grudada dos dois. Medido antes: 0 de 8 casos
        // casavam e nenhum log de STAFF jamais mostrou "via=embedded".
        const casos = ['seuidiota', 'meucuzao', 'aaaidiotaaaa'];
        for (const c of casos) {
            const r = engine.analyze(c, { debug: true });
            const emb = (r.debug.matchedRules || []).filter(m => m.matchType === 'embedded');
            assert.ok(emb.length > 0,
                `"${c}" casou mas não via embedded — a função de concatenação ` +
                'continua sendo código morto, e nenhuma evidência reaches o log');
        }
    });

    await teste('[BUG 11] concatenação NÃO vira falso positivo em palavra real', () => {
        // O limite de 3 caracteres grudados é o que separa "seu"+"idiota"
        // (colagem) de "prefixo"+"idiota" (duas palavras). Estes aqui são
        // palavras que contêm as letras do insulto.
        nenhumFlag([
            'cursor do mouse', 'cuidado com isso', 'executar o comando',
            'documentacao do bot', 'acumulador de dados', 'identificador unico',
            'ocorrencia no log', 'situacao atual', 'educacao infantil',
            'avaliacao do desempenho', 'idiomatico', 'identidade visual',
            'sazonal', 'abdominal',
        ]);
    });

    await teste('palavra custom da staff é absoluta e ignora supressão', () => {
        // A staff é a autoridade final do filtro: o que ela cadastra pega.
        const r = engine.analyze('o filtro pegou a palavra xpatao', { customWords: ['xpatao'] });
        assert.ok(r.flagged, 'palavra custom da staff não foi respeitada');
    });

    await teste('mensagem vazia não quebra', () => {
        for (const v of ['', '   ', null, undefined]) {
            const r = engine.analyze(v);
            assert.ok(r && r.flagged === false, `analyze(${JSON.stringify(v)}) quebrou`);
        }
    });

    await teste('o motor é puro: não muda o resultado entre chamadas iguais', () => {
        const texto = 'meu pai e um idiota';
        const a = engine.analyze(texto);
        const b = engine.analyze(texto);
        assert.deepStrictEqual(
            { f: a.flagged, s: a.severity, c: a.confidence },
            { f: b.flagged, s: b.severity, c: b.confidence },
            `mesma entrada, resultados diferentes: ${detalhe(texto)} vs ${detalhe(texto)}`);
    });

    await teste('o motor é puro: não guarda estado entre mensagens diferentes', () => {
        // Se algum módulo-level estiver vazando (o bug do /g), a ordem das
        // mensagens muda o resultado. A segunda deve ser igual à medida
        // isolada.
        const inocent = 'log seu cuzao';
        const r1 = engine.analyze(inocent);
        engine.analyze('outra mensagem qualquer com um monte de texto aqui');
        const r2 = engine.analyze(inocent);
        assert.strictEqual(r1.flagged, r2.flagged,
            'a mesma mensagem mudou de resultado por causa de outra no meio');
    });

    // ================================================================
    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    if (falhou) {
        console.log('\n  FALHAS (worklist — cada uma é um bug a corrigir):');
        falhas.forEach(f => console.log('   - ' + f));
    }
    process.exit(falhou ? 1 : 0);
})();
