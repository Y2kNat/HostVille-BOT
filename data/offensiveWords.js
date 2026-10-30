/**
 * CONHECIMENTO do filtro de moderação.
 *
 * Este arquivo é SÓ DADOS. Nenhuma lógica aqui: as regras de decisão
 * (pesos, limiares) ficam em utils/moderation/rules.js e a execução em
 * utils/moderation/OffensiveEngine.js.
 *
 * Cada lista carrega a SEMÂNTICA com que deve ser tratada. Isso importa
 * porque em PT-BR a mesma palavra muda de sentido conforme o resto da frase
 * ("pedo" = dinheiro, "bandido" = personagem de RP, "merda" = xingamento ou
 * reclamação).
 *
 * ── Categorias e o que cada uma significa ─────────────────────────────────
 *
 *  illegalTerms        Absolutos. Nunca são suprimidos por contexto.
 *                      Usar só para conteúdo que não admite contexto
 *                      (ex term child abuse). EXCEÇÃO histórica: 'pedo',
 *                      que em português é "dinheiro" — foi para
 *                      ambiguousTerms para não punir quem escreve "tô sem
 *                      pedo".
 *
 *  hardBlockTerms      Xingamento direto que o filtro já bloqueava, mas que
 *                      aceita supressão por citação/técnico/humor.
 *
 *  directInsults       Insulto direto a pessoa. Não é suprimido por humor
 *                      (xingar de idiota e rir junto continua sendo xingar),
 *                      mas é suprimido por citação ou contexto técnico.
 *
 *  profanities         Expletivo. Depende do resto da frase: "MERDA" é
 *                      xingamento, "isso é uma merda do sistema" é
 *                      reclamação.
 *
 *  contextualTerms     Palavra de uso comum em RP. Só vira ofensa com
 *                      marcador de agressão junto.
 *
 *  circumventionTerms  Escrita alternativa de Terms ofensivos ("cool"=cu,
 *                      "raba"=porra). Exige contexto: "cool" sozinho é
 *                      palavra normal em inglês.
 *
 *  shortSensitiveTerms Termos muito curtos (cu, fdp, pqp). Exigem match como
 *                      token inteiro E contexto, senão "cursor" e "cuidado"
 *                      seriam ofensivos.
 *
 *  ambiguousTerms      Termo cuja.ofensividade depende do contexto e que NÃO
 *                      dá para resolver só com regras.
 *
 *  aggressionMarkers   Evidência de que existe alvo/mordida na frase.
 *
 *  contextSuppressors  Evidência de que o termo aparece citado, técnico,
 *                      humor ou risada.
 */

// ===========================================================================
// ABSOLUTOS
// ===========================================================================
const illegalTerms = [
    'child porn', 'childporn', 'children porn', 'childpornography',
    'pedophile', 'pedófilo', 'pedofilia', 'pedofilia',
    'loli', 'l0li', 'lol1', 'shota', 'sh0ta', 'sh0t4',
    'minor', 'underage', 'und3rage', 'under age',
    'rape', 'r4pe', 'r4p3', 'rap3', 'ra9e',
    'abuse', 'abus3', 'abus0', '4buse', 'abüs',
    'groom', 'gr00m', 'gr0oming', 'groming',
    'incest', 'inc3st', 'incesto', 'inçest',
    'zoofilia', 'z00filia', 'zoophilia', 'necrophilia', 'n3cr0', 'necrofilia',
    'child abuse', 'childabuse', 'c h i l d a b u s e'
];

// ===========================================================================
// AMBIGUOS — o problema é a SEQUÊNCIA, não a palavra
// ===========================================================================
// 'pedo' = "dinheiro" em português. Bloquear por token exato apagava
// "tô sem pedo, não comprei o carro" e ainda dava warn. Vai para o motor
// ambíguo: contexto determinístico primeiro, IA só se continuar ambíguo.
const ambiguousTerms = [
    'pedo', 'ped0', 'p3do', 'pèdo', 'pêdo'
];

// ===========================================================================
// XINGAMENTO DIRETO (supressível por citação/técnico/humor) — comportamento
// já existente no FilterManager, preservado exatamente.
// ===========================================================================
const hardBlockTerms = [
    'puta', 'puita', 'put0', 'poota', 'putta',
    'caralho', 'car4lho', 'c4ralho', 'karalho',
    'carai', 'carãi', 'karaio', 'karai', 'crá',
    'buceta', 'buc3ta', 'buseta',
    'bct', 'bcta',
    'foda se', 'foda-se', 'fodase', 'fod4se',
    'vai se foder', 'vai tomar no cu', 'vtnc', 'tmnc', 'vsf',
    'arrombado', 'arromb4do', 'arombado',
    'filho da puta', 'filha da puta',
    'estupro', 'estupr0', '3stupro'
];

// ===========================================================================
// PALAVRAS DO BANCO ANTIGO (eram regras; viram conhecimento)
// ===========================================================================
const directInsults = [
    'arombado', 'arrombado', 'arrumbao', 'babaca', 'bichinha', 'burra',
    'burrinho', 'burro', 'canalha', 'chifrudo', 'corninho', 'corno',
    'cretina', 'cretino', 'cu', 'cuzao', 'cuzinho', 'cuzuda', 'cuzudo',
    'cuzão', 'desgracado', 'desgraça', 'desgraçado', 'estupida', 'estupido',
    'fdp', 'fodado', 'fodasse', 'fodassi', 'foder', 'fodidao', 'fudendo',
    'fudeu', 'fudido', 'idiota', 'idiotinha', 'imbecil', 'inutel', 'inutil',
    'krl', 'krlh', 'lixo', 'maldita', 'maldito', 'mnda', 'otaria', 'otario',
    'perereca', 'piranha', 'piriguete', 'ppk', 'pqp', 'pqpz', 'puta',
    'putaria', 'puteiro', 'putinho', 'puto', 'putona', 'retardada',
    'retardado', 'sapaton', 'sapatão', 'tmnc', 'tnc', 'trouxa', 'trouxinha',
    'vagaba', 'vagabunda', 'vagabundo', 'verminoso', 'viada', 'viadinho',
    'viado', 'vsf', 'vsfd', 'vtnc',
];

// ===========================================================================
// EXPLETIVO — depende do resto da frase
// ===========================================================================
const profanities = [
    'merda', 'merdinha', 'm3rda', 'merd4', 'merrda',
    'porra', 'porã', 'porrã', 'porr4', 'p0rra',
    'caralho', 'cacete', 'c4cete',
    'foda', 'fodase', 'foda-se', 'f0da', 'fodo', 'f0do', 'foder', 'fuder', 'fder',
    'bosta', 'bostinha', 'buceta', 'xota', 'xoxota',
    'polla', 'rola', 'piroca', 'pica', 'pika',
    'carai', 'karaio', 'poha', 'fds', 'prr', 'pqpz', 'crl', 'crlh', 'mrd',
    'fdp', 'fdps', 'pdpc',
    'fuck', 'fck', 'fuk', 'shit', 'sh1t', 'bitch', 'b1tch', 'dick', 'd1ck',
    'cunt', 'kunt', 'bastard', 'whore', 'slut'
];

// ===========================================================================
// CONTEXTUAIS — uso comum em RP
// ===========================================================================
const contextualTerms = [
    'abominavel', 'aborto', 'abusado', 'abusador', 'analfabeto', 'anta',
    'arrogante', 'asqueroso', 'assaltante', 'atrevido', 'bandido', 'besta',
    'bichao', 'bicho', 'bichão', 'birrento', 'bobo', 'bocó', 'boçal',
    'bronco', 'bunda', 'burro da pads', 'cabeça dura', 'capeta', 'chata',
    'chato', 'convencido', 'criminoso', 'crápula', 'danado', 'delinquente',
    'demonio', 'depravado', 'diabo', 'enfadonho', 'enganador', 'fedorento',
    'feia', 'feio', 'folgado', 'futil', 'golpista', 'horrivel', 'horrível',
    'intolerante', 'irritante', 'ladrão', 'lixinho', 'loucura', 'lucifer',
    'malandro', 'manipulador', 'marginal', 'maçante', 'mendigo', 'metido',
    'miseravel', 'miserável', 'nojenta', 'nojento', 'nulo', 'pateta',
    'pentelho', 'pervertido', 'peste', 'pestinha', 'pilantra', 'praga',
    'preguicoso', 'preguiçoso', 'pretensioso', 'repugnante', 'ruim',
    'safado', 'satanás', 'sem noçao', 'sem noção', 'soberbo', 'tarado',
    'trapaceiro', 'traste', 'vaidoso', 'verme',
    // BUG 9: "autista" entra como CONTEXTUAL, não como insulto direto.
    // Decisão do dono: a palavra é termo clínico legítimo e está sendo
    // medicalizada, então token solto moderaria conversa sobre
    // neurodiversidade. Em `contextual` ela só vira ofensa com marcador de
    // agressão junto — que é quando é de fato xingamento.
    // Medido o comportamento de `contextual`: "chato" sozinho = low 0.24
    // (não dispara), "seu chato" = high 0.59 (dispara). É a semântica pedida.
    'autista', 'autistico', 'autistica',
];

// ===========================================================================
// CIRCUMVENÇÃO — escrita alternativa. Sempre exige contexto.
// ===========================================================================
// BUG 4: esta lista tinha apelido e palavra comum misturados com circumvenção
// real. "toba", "fiofó", "rabao", "raba" e "brioco" são apelidos brasileiros;
// "qu" é abreviação de "que" (e também o "qu" francês); "cool", "koo" e
// "qoo" são palavra normal. Medido: nenhum deles dispara hoje — o peso de
// `circumvention` é igual ao de `contextual` e sozinho não passa do
// limiar. O risco não é o de hoje, é o de amanhã: quem tem nick "toba"
// fica a UM ajuste de peso de ser moderado por usar o próprio nick, sem
// ter feito nada de errado.
//
// Fica aqui só o que é escrita alternativa de fato: pontuação, número e
// símbolo no lugar de letra, e a forma com dígito no meio.
const circumventionTerms = [
    'kuzão', 'kuzao', 'kuzinho',
    'v.s.f', 'v.s.t', 'v5f', 'p.p.k', 'f.d.p', 'f d p', 'p.r.r', 't.n.c',
    'c.r.l', 'b.o.s.t.a', 'x0x0', 'xoxo',
    // BUG 1: a regra nova de fuzzy (6 letras, dist<=2) deixa de cobrir a
    // variante com dígito no meio. O leet não pega: 1->i é conversion de
    // LETRA, não de dígito solto no meio. Medido na simulação como a única
    // regressão da regra nova, e coberto aqui explicitamente.
    'cuz1o', 'cuz1ão', 'id1ota', 'm3rd4',
    'filho d a puta', 'filha d a puta',
    'pqpz', 'fdpz', 'fdps', 'krlh', 'crlh'
];

// ===========================================================================
// CURTOS — boundary rígido + contexto
// ===========================================================================
const shortSensitiveTerms = [
    'cu', 'ku', 'bct', 'ppk', 'fdp', 'vsf', 'tnc', 'pqp', 'prr', 'fds',
    'pqpz', 'crl', 'qu', 'mrd', 'carai', 'karai', 'pica', 'fck', 'shit'
];

// ===========================================================================
// MARCADORES DE AGRESSÃO — EVIDÊNCIA, não categoria
// ===========================================================================
// Uso: peso +0.20 em contextAnalyzer, aplicado a um match que JÁ aconteceu.
// Ou seja, marcador sozinho não pega nada. Foi por isso que as ameaças
// diretas desta lista viraram categoria própria (threatTerms, abaixo).
//
// Os ambíguos ficam aqui de propósito: "vai ficar bom", "vai se recuperar"
// e "seu servidor" são benignos e só devem pesar quando há insulto junto.
const aggressionMarkers = [
    'vai tomar', 'vai se', 'vai ficar', 'vai ficar quietinho',
    'seu', 'sua', 'seus', 'suas',
    'nada alem', 'so um', 'merda de', 'pior que', 'pqp de',
    'se achou', 'sabe de nada', 'nao serve', 'nao presta',
    'sai fora', 'some daqui', 'some', 'morre', 'cala', 'cala a boca',
    'fica longe', 'pode guardar', 'engra', 'apaga', 'some com isso',
    'idota do', 'otario do', 'burrinho do', 'inutil do', 'lixo do'
];

// ===========================================================================
// AMEAÇA DIRETA — categoria própria
// ===========================================================================
// BUG 7: `aggressionMarkers` tem 33 entradas e várias são ameaça direta
// ("some daqui", "cala a boca", "apaga"). A INTENÇÃO era pegar, mas o motor
// só usava aggressionMarkers como COMPLEMENTO de um termo insultuoso
// (peso +0.20 em contextAnalyzer, aplicado a um match que já aconteceu).
// Sozinho, não casava com nada.
//
// Medido antes: "morre logo", "apaga daqui", "some daqui", "cala a boca",
// "fica longe de mim", "sai fora daqui" — TODOS passavam, com ZERO match.
// O filtro barra "cuzao" (medium) e deixa passar "some daqui", que é pior.
//
// Por que lista própria e não continuar em aggressionMarkers
// Um marcador é evidência de que existe alvo; uma ameaça é o fato em si.
// Tratar as duas coisas no mesmo peso é o que produziu o buraco.
//
// O que NÃO entra aqui, e por quê — medido, não estimado
//
// 1. "vai ficar", "vai se" e "vai tomar" são ambíguos: "vai ficar bom" e "vai
//    se recuperar" são benignos, e "vai tomar" já é testado como frase exata.
//
// 2. O VERBO SOLTO não entra. Com "morre", "apaga", "some" e "cala" como
//    termos, a categoria flagou "apaga a luz" (0.78), "morre de rir" (0.78),
//    "some legal ai" (0.79) e "cala o bot" (0.54). Construção comum em
//    português.
//
// 3. O COMPLEMENTO DIRECIONADO ("apaga aqui", "tira daqui", "fica quieto")
//    também não entra. Medido: "apaga aqui a luz" (0.78), "apaga aqui o
//    canal" (0.53), "tira daqui o arquivo" (0.66), "fica quieto o grupo"
//    (0.66), "fica calado o servidor" (0.41). Todos são comando de sistema,
//    não ameaça a pessoa.
//
// 4. RECLAMAÇÃO DE SISTEMA não entra. "esse comando nao presta" (0.53),
//    "esse bot nao serve pra nada" (0.53), "o app nao serve" (0.53),
//    "a rota nao presta mesmo" (0.78) — todos são reclamação legítima, e
//    COMPLAINT_RE já cobre o caso, mas não quando a frase contém "nao presta".
//
// A REGRA QUE SUBSTITUI TUDO ISSO
// Só entra o que aponta NO INTERLOCUTOR: complemento de pessoa explícito
// (de mim, te, contigo, minha frente, a boca) ou construção que só faz
// sentido dirigida a alguém. "apaga daqui" sozinho ficou de fora porque
// "tira daqui o arquivo" é comando comum; a ameaça genérica sem objeto
// continua coberta por aggressionMarkers quando vem com insulto junto.
// IMPERATIVO SEM OBJETO — camada condicional.
//
// "morre logo", "some daqui", "apaga aqui" SÃO ameaça quando dirigidas a
// alguém, e são comando de sistema quando não são. A diferença não está no
// verbo: "morre de rir" (risada) e "apaga aqui a luz" (objeto) usam a mesma
// forma. Por isso ficam numa camada separada, que só vira match quando o
// contexto NÃO é risada e NÃO é reclamação de sistema.
//
// Medido sem a camada: "morre de rir" 0.78, "apaga a luz" 0.78,
// "some legal ai" 0.79, "cala o bot" 0.54, "morre logo o processo" 0.78.
// Medido com a camada: os cinco caem para `none`/`low`, e "morre logo",
// "some daqui", "apaga aqui" continuam sendo ameaça quando sozinhos.
const threatAmbiguousTerms = [
    'morre', 'morre logo', 'apaga', 'apaga aqui', 'apaga daqui', 'some',
    'some daqui', 'sai fora', 'tira daqui', 'cala', 'se achou',
    'fica calado', 'fica quieto', 'vai sumir', 'vai embora',
];

// TERMOS QUE EM PORTUGUÊS BR SÃO MAIS EXCLAMAÇÃO QUE XINGAMENTO
//
// BUG 6: estes vivem em `directInsults`/`hardBlock` (peso 0.45), não em
// `profanity`, então um gate por categoria não os alcança. Medido como
// falso positivo antes da correção:
//   "fds que coisa"  medium 0.48    "tnc mano"     high 0.59
//   "prr que raiva" medium 0.48    "vsf mano"     high 0.75
//   "que fds"       medium 0.48    "cu mano"      high 0.59
//                                  "caralho mano" high 0.65
//
// A lista é DELIBERADAMENTE CURTA e medida. Não entram "puta", "foder",
// "bosta" nem "merda": o audit não mediu falso positivo para eles, e o
// peso de nunca errar aqui é asymmetrico — errar odiando por exclamação
// tira a palavra de quem estava reclamando, e errar odiando por xingamento
// deixa passar o insulto. Sem medição, a lista não cresce.
//
// O que continua valendo: com sinal de ALVO, estes são insulto.
// "seu vsf", "vsf seu", "cu vai tomar no cu" são barrados.
/**
 * PARES QUE O FUZZY NÃO PODE CASAR  [BUG 1]
 *
 * O que é
 * O fuzzy compara o token com distância de edição 1. Em português, isso
 * às vezes acerta uma palavra de verdade, porque o dicionário tem termos
 * que são uma palavra comum + uma letra.
 *
 * O caso medido
 *   "sapato" ~ "sapatão"   distância 1   → "sapato" era moderado
 *
 * Note que isto NÃO foi introduzido pela regra nova do BUG 1: o código
 * anterior (termo ≥5, distância 1) casava igual. A regra nova reduziu a
 * exposição porque derrubou o piso de 5 para 6 letras, mas o par continua
 * perigoso.
 *
 * Por que lista de PARES e não de palavras proibidas
 * Bloquear a palavra "sapato" inteiro exigiria um dicionário de português
 * no projeto — e a lista growe sem parar. Bloquear o par resolve o
 * problema medido sem criar uma dependência que ninguém vai manter.
 *
 * A cobertura NÃO depende desta lista: o teste
 * `tests/moderacao-filtro.test.js` ("fuzzy não casa palavra real") roda o
 * cálculo de colisão sobre um corpus de palavras e nomes comuns. Se alguém
 * adicionar um termo ao dicionário que colida com palavra real, o teste
 * falha e manda aqui. Esta lista é o resultado medido desse teste.
 *
 * COMO ADICIONAR: rode a colisão pelo teste, pegue o par que ele accusing e
 * acrescente como [palavra, termo]. Não acrescente por suspeita.
 */
const fuzzyBlockedPairs = [
    ['sapato', 'sapatao'],   // medido: "sapato" ~ "sapatão" (dist 1)
    ['sapato', 'sapaton'],   // mesma raiz, grafia alternativa
];

/**
 * Testados em runtime contra o índice normalizado.
 * Estrutura: chave `palavra|termo` -> true.
 */
const fuzzyBlocked = new Map();
const fuzzyBlockedTerms = new Set();
for (const [palavra, termo] of fuzzyBlockedPairs) {
    fuzzyBlocked.set(String(palavra).toLowerCase() + '|' + String(termo).toLowerCase(), true);
    // O lado do TERMO também é bloqueado no caminho de concatenação
    // (embedded). Medido: "meu sapato novo" colava em "sapaton"+"ovo" e
    // pegava por embedded, não por fuzzy — travar só o fuzzy não resolvia.
    // Perder a concatenação dessas duas grafias é barato: a palavra exata
    // "sapatão" continua sendo pega por token.
    fuzzyBlockedTerms.add(String(termo).toLowerCase());
}

const exclamationTerms = [
    'fds', 'prr', 'tnc', 'vtnc', 'vsf', 'vsfd', 'cu', 'caralho', 'crl', 'crlh',
];

const threatTerms = [
    // aponta no interlocutor
    'cala a boca', 'cala essa boca', 'cala a minha boca',
    'fica longe de mim', 'fica longe da gente', 'fica longe do cara',
    'sai da minha frente', 'sai da frente dele', 'tira daqui na hora',
    'me tira daqui', 'tira o olho de mim', 'para de me encher',
    'vou te achar', 'vou te encontrar', 'te encontro depois',
    'deixa eu te conhecer', 'me liga quando eu chegar',
    'vai ficar quietinho', 'vai ficar calado', 'fica calado na sua',
    'fica esperta', 'fica esperto', 'fica na sua', 'fica na sua area',
    'vai se fuder', 'se fudeu comigo',
    'morre pra mim', 'some pra mim', 'some da minha vida',
    'vou te matar', 'vou te destroy', 'te mato',
    'queria te ver aqui', 'te vejo depois',
];

// ===========================================================================
// SUPPRESSORES — evidência de uso não-ofensivo
// ===========================================================================
const contextSuppressors = {
    // está citando
    quote: [
        '"', "'", '`', '«', '»', '“', '”', 'disse que', 'escreveu que',
        'digitou', 'mandou', 'enviou', 'citou', 'citando', 'repassou',
        'disse:', 'falou:', 'escreveu:', 'mandou:'
    ],
    // contexto técnico/acadêmico
    technical: [
        'exemplo', 'exemplos', 'cita', 'citacao', 'citou', 'citando',
        'palavra', 'termo', 'termos', 'string', 'variavel', 'log', 'logs',
        'codigo', 'arquivo', 'classe', 'funcao', 'estudando', 'estudo',
        'pesquisa', 'analisa', 'artigo', 'musica', 'meme', 'memes',
        'linguagem', 'linguistica', 'portugues', 'insultos', 'ofensivas',
        'ofensivo', 'ofensa', 'moderacao', 'filtro', 'blacklist', 'dicionario'
    ],
    // contexto de RPG/ficcao: o termo nomeia um personagem, nao a pessoa
    roleplay: [
        'no rp', 'em rp', 'no roleplay', 'em roleplay', 'rp',
        'personagem', 'personagens', 'fictional', 'no jogo', 'em jogo',
        'do jogo', 'no server roleplay', 'na historia', 'na história',
        'no role', 'de rpg', 'em rpg', 'meu char', 'meu personagem'
    ],
    // humor / risada
    humor: [
        'kkkk', 'kkk', 'haha', 'hahaha', 'hehe', 'lol', 'rs', 'rss',
        'zoeira', 'brincadeira', 'brincando', 'de brincadeira',
        'troll', 'trolagem', 'fofo', 'fofa'
    ],
    // emoji de riso (tratados à parte, fora da lista de texto)
};

// ===========================================================================
// NORMALIZAÇÃO — mapa de leet. NÃO é substituidor: o motor só o aplica em
// camadas. Ver normalizer.js para a ordem correta. para a ordem correta de aplicação.
// ===========================================================================
const leetMap = {
    '0': 'o', '@': 'a', '1': 'i', '!': 'i', '|': 'l',
    '3': 'e', '€': 'e', '4': 'a', 'ª': 'a',
    '5': 's', '$': 's', '§': 's', '6': 'g', '7': 't', '+': 't',
    '8': 'b', '9': 'g', '(': 'c', '[': 'c', '¡': 'i'
};

// ===========================================================================
// REGEX anti-link — LinkManager depende destes. Não mover.
// ===========================================================================
// B26: o anti-invite aceitava SÓ a forma canônica (uma barra, código
// alfanumérico). Medido em rede em 30/09, o bypass era FUNCIONAL, não
// teórico:
//    discord.gg//discord  -> 301 -> discord.com/invite/discord
//    discord.gg./discord  -> 301 -> discord.com/invite/discord
//    discord.gg/%64iscord -> 301 -> discord.com/invite/discord
// A Discord normaliza o caminho antes de resolver o invite, então a
// variante com `//` é real (confirmado em rede). Cobre-se a DETECÇÃO, não a
// forma do link: o objetivo é nunca deixar o convite passar, e um invite é
// bloqueado com folga antes de a mensagem ser apagada.
const inviteRegex = /discord[\/._\-\s]*(gg|com[\/._\-\s]*invite|me)[\/._\-\s]*[a-z0-9%\-]+/gi;
const urlRegex = /(https?:\/\/[^\s]+)/gi;

// ===========================================================================
// API
// ===========================================================================
const rules = {
    illegalTerms,
    ambiguousTerms,
    hardBlockTerms,
    directInsults,
    profanities,
    contextualTerms,
    circumventionTerms,
    shortSensitiveTerms,
    aggressionMarkers,
    contextSuppressors,
    threatTerms, threatAmbiguousTerms, exclamationTerms,
    fuzzyBlocked, fuzzyBlockedPairs, fuzzyBlockedTerms,
    leetMap
};

/**
 * Índice invertido: termo normalizado -> categorias onde aparece.
 * Montado uma vez no load. O matcher consulta em O(1).
 */
function buildIndex() {
    const idx = new Map();
    const add = (term, category) => {
        const t = String(term).toLowerCase().trim();
        if (!t) return;
        if (!idx.has(t)) idx.set(t, new Set());
        idx.get(t).add(category);
    };
    for (const t of illegalTerms) add(t, 'illegal');
    for (const t of ambiguousTerms) add(t, 'ambiguous');
    for (const t of hardBlockTerms) add(t, 'hardBlock');
    for (const t of directInsults) add(t, 'directInsult');
    for (const t of profanities) add(t, 'profanity');
    for (const t of contextualTerms) add(t, 'contextual');
    for (const t of circumventionTerms) add(t, 'circumvention');
    for (const t of threatTerms) add(t, 'threat');
    for (const t of threatAmbiguousTerms) add(t, 'threatSoft');
    for (const t of shortSensitiveTerms) add(t, 'shortSensitive');
    return idx;
}

const index = buildIndex();

/** Lista plana, retrocompatível com o código antigo. */
const defaultOffensiveWords = [...new Set([
    ...illegalTerms, ...hardBlockTerms, ...directInsults, ...profanities,
    ...contextualTerms, ...circumventionTerms, ...shortSensitiveTerms
])];

module.exports = {
    rules,
    index,
    // exporta as listas também no topo, para import legado
    illegalTerms, ambiguousTerms, hardBlockTerms, directInsults, profanities,
    contextualTerms, circumventionTerms, shortSensitiveTerms,
    aggressionMarkers, contextSuppressors, threatTerms, threatAmbiguousTerms, exclamationTerms,
    fuzzyBlocked, fuzzyBlockedPairs, fuzzyBlockedTerms,
    leet: leetMap,
    // compatibilidade
    defaultOffensiveWords,
    shortSensitiveWords: shortSensitiveTerms,
    inviteRegex,
    urlRegex
};
