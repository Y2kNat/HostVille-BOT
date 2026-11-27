require('dotenv').config();
const { parseKeys } = require('./utils/apiKeyPool');
const KILO_API_KEYS = parseKeys([
    process.env.KILO_API_KEY,
    process.env.KILO_API_KEYS,
    ...[1, 2, 3, 4, 5].map(n => process.env[`KILO_API_${n}`]),
    ...[1, 2, 3, 4, 5].map(n => process.env[`KILO_API_KEY${n}`])
]);
const MODERATION_API_KEYS = parseKeys([
    process.env.MODERATION_API_KEY,
    process.env.MODERATION_API_KEYS,
    ...[1, 2, 3, 4, 5].map(n => process.env[`MODERATION_API_${n}`]),
    ...[1, 2, 3, 4, 5].map(n => process.env[`MODERATION_API_KEY${n}`])
]);

module.exports = {
    // Bot
    TOKEN: process.env.TOKEN,
    BOT_NAME: 'HostVille • BOT',
    BOT_VERSION: '6.3.1',
    BOT_COLOR: '#341539',

    // Canais
    LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID,

    // Staff
    ADMIN_ROLES: process.env.ADMIN_ROLES ? process.env.ADMIN_ROLES.split(',') : [],
    STAFF_USER_ID: process.env.STAFF_USER_ID ? process.env.STAFF_USER_ID.split(',').map(id => id.trim().replace(/[<@>]/g, '')) : [],
    OWNER_ID: process.env.OWNER_ID,
    // Cargo extra que pode aprovar aprendizado de KB. Vazio = so o dono.
    APPROVE_ROLE: process.env.APPROVE_ROLE
        ? process.env.APPROVE_ROLE.split(',').map(r => r.trim().replace(/[<@&>]/g, '')).filter(Boolean)
        : [],

    // Aprendizado automatico da KB
    AUTO_KB: {
        ENABLED: process.env.AUTO_KB_ENABLED !== 'false',
        GUILD: process.env.AUTO_KB_GUILD,
        CANAL: process.env.AUTO_KB_CANAL,
        INTERVAL_MIN: parseInt(process.env.AUTO_KB_INTERVAL_MIN || '30', 10),
        MIN_REPEATS: parseInt(process.env.AUTO_KB_MIN_REPEATS || '2', 10),
        DAYS: parseInt(process.env.AUTO_KB_DAYS || '60', 10),
    },

    // Segurança
    ACCESS_CODE: process.env.ACCESS_CODE,

    // Relatório
    DAILY_REPORT_TIME: process.env.DAILY_REPORT_TIME || '00:00',

    // Anti-Spam
    SPAM: {
        MAX_MESSAGES: 5,
        TIME_WINDOW: 5000,
        MUTE_DURATION: 60000,
        SIMILAR_CONTENT_THRESHOLD: 0.8
    },

    // Cache
    CACHE_TTL: 300000,

    // ============================================================
    // KILO CODE (AI Gateway) — provedor ÚNICO de IA do bot
    // ============================================================
    // O Gateway do Kilo fala o protocolo OpenAI (POST /chat/completions) e
    // autentica com `Authorization: Bearer <KILO_API_KEY>`. Os modelos são
    // identificados no formato `provedor/nome-do-modelo` (ex.:
    // `anthropic/claude-sonnet-4.6`, `openai/gpt-5.4`).
    //
    // TRÊS VARIÁVEIS SOBRAM PARA O USUÁRIO CONFIGURAR:
    //   KILO_API_KEY      -> a chave do gateway
    //   KILO_BASE_URL     -> a base da API (default: gateway oficial)
    //   KILO_DEFAULT_MODEL-> o modelo usado pelo bot
    //
    // TODO O RESTO É OPCIONAL: tem default aqui e só existe para afinar
    // tempo/orçamento quando o modelo escolhido pedir.
    KILO_API_KEY: KILO_API_KEYS[0] || '',
    KILO_API_KEYS,
    KILO_BASE_URL: (process.env.KILO_BASE_URL || 'https://ai-gateway.kilo.ai/api/v1').replace(/\/+$/, ''),
    KILO_DEFAULT_MODEL: process.env.KILO_DEFAULT_MODEL || '',

    // TEMPO DE TCP (handshake TLS), não o tempo total da chamada. O undici
    // aborta o connect em 10s e, medido daqui, o TLS com um host lento leva
    // 15s: a rota morria com UND_ERR_CONNECT_TIMEOUT mesmo com a chave
    // certa. 45s cobre a latência real sem segurar chamada morta.
    KILO_CONNECT_TIMEOUT_MS: parseInt(process.env.KILO_CONNECT_TIMEOUT_MS) || 45000,
    // Timeout total de uma chamada ao gateway.
    // 300s: o tier MAX pede 32000 tokens por arquivo e um modelo de nuvem
    // pode passar de 50 tokens/s. O watchdog do TaskRunner (que troca de
    // modelo) dispara antes disso — TASK_FALLBACK_APOS_MS=240000 — então o
    // abort brusco é só a rede de segurança final.
    KILO_TIMEOUT_MS: parseInt(process.env.KILO_TIMEOUT_MS) || 300000,
    // Semáforo de concorrência: quantas chamadas ao gateway saem ao mesmo
    // tempo. O judge de tier e o guard são rápidos e não devem esperar.
    KILO_MAX_CONCURRENCY: parseInt(process.env.KILO_MAX_CONCURRENCY) || 2,
    KILO_MAX_RETRIES: parseInt(process.env.KILO_MAX_RETRIES) || 1,

    // Config da IA (tokens e parâmetros de geração)
    KILO_MAX_TOKENS: parseInt(process.env.KILO_MAX_TOKENS) || 1500,
    KILO_TEMPERATURE: parseFloat(process.env.KILO_TEMPERATURE) || 0.7,
    KILO_TOP_P: parseFloat(process.env.KILO_TOP_P) || 0.9,

    // ============================================================
    // HONEYPOT (canal-armadilha)
    // ============================================================
    // Um canal isca: o bot fixa um aviso de "não mande mensagem aqui". Quem
    // mandar (e não for isento: dono/staff/admin) é banido na hora, tem as
    // mensagens apagadas, recebe DM e o staff recebe um alerta com o que foi
    // enviado (texto + mídia salva para não expirar).
    HONEYPOT: {
        ENABLED: process.env.HONEYPOT_ENABLED !== 'false',
        CHANNEL_ID: process.env.HONEYPOT_CHANNEL_ID || '1573807154291548322',
        // Canal do ALERTA (embed do "o que aconteceu" + @everyone) + DM ao dono.
        ALERT_CHANNEL_ID: process.env.HONEYPOT_ALERT_CHANNEL_ID || '1521666605887656148',
        // Canal onde a MÍDIA é salva para não expirar (fica separado do alerta).
        MEDIA_CHANNEL_ID: process.env.HONEYPOT_MEDIA_CHANNEL_ID || '1521717074240602262',
        GUILD_ID: process.env.HONEYPOT_GUILD_ID || '1519076712413925416',
        // Dias de mensagem apagados pelo ban (0..7). 7 = máximo do Discord.
        DELETE_DAYS: Math.min(7, Math.max(0, parseInt(process.env.HONEYPOT_DELETE_DAYS) || 7)),
        // Varredura extra de mensagens antigas (best-effort) além do ban.
        EXTRA_SCAN: process.env.HONEYPOT_EXTRA_SCAN !== 'false',
        // Usuário de TESTE: quando ele posta no honeypot, o bot roda o fluxo
        // completo como demonstração, mas NÃO bane e NÃO apaga mensagens em
        // outros canais (só a mensagem do honeypot + alerta marcado como teste).
        // Vazio = usa o OWNER_ID. É isento de punição real, serve só pra testar.
        TEST_USER_ID: (process.env.HONEYPOT_TEST_USER_ID || process.env.OWNER_ID || '').trim(),
        // Watchdog: verifica periodicamente se o canal-armadilha ainda existe
        // (alguém pode deletar). Se sumir, avisa no canal de alerta. O evento
        // channelDelete cobre o caso em tempo real; isto é o backup.
        CHECK_ENABLED: process.env.HONEYPOT_CHECK_ENABLED !== 'false',
        // Intervalo da checagem, em SEGUNDOS (cache-first: so faz REST quando o canal some do cache).
        CHECK_INTERVAL_SEC: parseInt(process.env.HONEYPOT_CHECK_INTERVAL_SEC) || 10,
    },

    // ============================================================
    // ANTI-RAID (Protect)
    // ============================================================
    // Detecta raids em andamento (delete/ban em massa, @everyone spam) e
    // bane o executor automaticamente. Só executa se ANTI_RAID_ENABLED !==
    // 'false'. Se o bot não tiver permissão View Audit Log, a feature
    // desativa com aviso no boot.
    ANTI_RAID: {
        ENABLED: process.env.ANTI_RAID_ENABLED !== 'false',
        WINDOW_MS: parseInt(process.env.ANTI_RAID_WINDOW_MS) || 180000,
        DELETE_THRESHOLD: parseInt(process.env.ANTI_RAID_CHANNEL_DELETE_THRESHOLD) || 3,
        CREATE_THRESHOLD: parseInt(process.env.ANTI_RAID_CHANNEL_CREATE_THRESHOLD) || 3,
        BAN_THRESHOLD: parseInt(process.env.ANTI_RAID_BAN_THRESHOLD) || 3,
        EVERYONE_THRESHOLD: parseInt(process.env.ANTI_RAID_EVERYONE_THRESHOLD) || 3,
        ALERT_CHANNEL_ID: process.env.ANTI_RAID_ALERT_CHANNEL_ID || '',
        GUILD_ID: process.env.ANTI_RAID_GUILD_ID || '',
        TRUSTED: process.env.ANTI_RAID_TRUSTED
            ? process.env.ANTI_RAID_TRUSTED.split(',').map(id => id.trim().replace(/[<@>]/g, '')).filter(Boolean)
            : [],
    },

    // Piso de max_tokens. Modelos de raciocínio consomem o mesmo orçamento
    // antes de responder; abaixo disso a resposta volta vazia.
    KILO_MIN_TOKENS: parseInt(process.env.KILO_MIN_TOKENS) || 1200,

    // Esforço de raciocínio: none (não envia) | low | medium | high.
    // 'none' é o padrão DE PROPÓSITO: o campo `reasoning_effort` não está
    // no contrato do Gateway e dependendo do modelo pode dar 400. Só envie
    // se o modelo escolhido realmente precisar dele.
    KILO_REASONING: process.env.KILO_REASONING || 'none',

    // ============================================================
    // ROTA ALTERNATIVA DA IA (mesmo gateway, outro modelo)
    // ============================================================
    // Só entra em ação por erro de TRANSPORTE ou AUTENTICAÇÃO (sem conexão,
    // 5xx, 429, 408, 401/403). Erro de conteúdo (resposta vazia) NÃO aciona:
    // repetir no mesmo servidor devolve o mesmo e só gasta cota duas vezes.
    //
    // Vazio = rota desligada. É a 2a camada do bot: a 1a é o IAFallback,
    // que troca de modelo conforme o contexto (ticket / tarefa).
    KILO_FALLBACK_MODEL: process.env.KILO_FALLBACK_MODEL || '',
    KILO_FALLBACK_TIMEOUT_MS: parseInt(process.env.KILO_FALLBACK_TIMEOUT_MS) || 90000,

    // ============================================================
    // GERAÇÃO POR TIER (TaskRunner)
    // ============================================================
    // Um site completo numa geração única de 16k pode parar em ~2.400 tokens
    // com finish_reason "stop" — o modelo acha que terminou. Por isso os
    // tiers geram ARQUIVO POR ARQUIVO: cada um com o orçamento inteiro do tier.
    GEN_TIERS: {
        MIN: {
            tokens: parseInt(process.env.GEN_MIN_TOKENS) || 4000,
            cooldownH: 0,
            label: 'min', descricao: '1 arquivo, rapido'
        },
        MED: {
            tokens: parseInt(process.env.GEN_MED_TOKENS) || 8000,
            cooldownH: 0,
            label: 'med', descricao: '2-3 arquivos'
        },
        HIGH: {
            tokens: parseInt(process.env.GEN_HIGH_TOKENS) || 16000,
            cooldownH: parseInt(process.env.GEN_HIGH_COOLDOWN_H) || 12,
            label: 'high', descricao: '4-7 arquivos'
        },
        MAX: {
            tokens: parseInt(process.env.GEN_MAX_TOKENS) || 32000,
            cooldownH: parseInt(process.env.GEN_MAX_COOLDOWN_H) || 24,
            label: 'max', descricao: 'ate 12 arquivos, projeto inteiro'
        }
    },
    // Ordem de exibicao no seletor: do mais barato pro mais caro.
    GEN_TIER_ORDEM: ['MIN', 'MED', 'HIGH', 'MAX'],
    // Quando abrir o seletor: 'auto' (funil + juiz), 'always', 'off'.
    GEN_TIER_SELECTOR: String(process.env.GEN_TIER_SELECTOR || 'auto').toLowerCase(),
    // Orcamento da chamada barato que so lista os arquivos do projeto.
    GEN_PLANNER_TOKENS: parseInt(process.env.GEN_PLANNER_TOKENS) || 600,
    // Tempo que o seletor espera pelo clique.
    GEN_TIER_TIMEOUT_MS: parseInt(process.env.GEN_TIER_TIMEOUT_MS) || 60000,
    // Teto de arquivos por projeto (protege o zip e o tempo total).
    GEN_MAX_FILES: parseInt(process.env.GEN_MAX_FILES) || 12,

    // ============================================================
    // JUIZ DE TIER (Kilo, mesmo gateway)
    // ============================================================
    // Roda SO no caso ambiguo do funil (ver managers/TierJudge.js).
    // O modelo e a base sao os do Kilo: um juiz dedicated sao caro e
    // nao justificado quando o gateway ja entrega o mesmo modelo.
    TIER_JUDGE: String(process.env.TIER_JUDGE ?? 'true').toLowerCase() !== 'false',
    TIER_JUDGE_MODEL: process.env.TIER_JUDGE_MODEL || process.env.KILO_DEFAULT_MODEL || '',
    TIER_JUDGE_BASE_URL: (process.env.TIER_JUDGE_BASE_URL || process.env.KILO_BASE_URL || 'https://ai-gateway.kilo.ai/api/v1').replace(/\/+$/, ''),
    TIER_JUDGE_API_KEY: process.env.TIER_JUDGE_API_KEY || process.env.KILO_API_KEY || '',
    TIER_JUDGE_API_KEYS: parseKeys(process.env.TIER_JUDGE_API_KEY || process.env.TIER_JUDGE_API_KEYS || process.env.KILO_API_KEY),
    // Timeout do juiz. MEDIDO: ~17s no gateway (free tier é lento). Com
    // 2500ms o juiz estourava SEMPRE e o seletor de tier nunca abria.
    TIER_JUDGE_TIMEOUT_MS: parseInt(process.env.TIER_JUDGE_TIMEOUT_MS) || 30000,
    TIER_JUDGE_MAX_TOKENS: parseInt(process.env.TIER_JUDGE_MAX_TOKENS) || 64,
    // 'none' = juiz sem raciocínio: responde "PROJETO"/"SIMPLES" direto.
    TIER_JUDGE_REASONING_EFFORT: process.env.TIER_JUDGE_REASONING_EFFORT || 'none',

    // Guard de prompt injection: mesmo gateway, modelo dedicado quando
    // definido (um classificador pequeno e barato responde melhor).
    GUARD_ENABLED: String(process.env.GUARD_ENABLED ?? 'true').toLowerCase() !== 'false',
    GUARD_MODEL: process.env.GUARD_MODEL || process.env.KILO_DEFAULT_MODEL || '',
    GUARD_BASE_URL: (process.env.GUARD_BASE_URL || process.env.KILO_BASE_URL || 'https://ai-gateway.kilo.ai/api/v1').replace(/\/+$/, ''),
    GUARD_API_KEY: process.env.GUARD_API_KEY || process.env.KILO_API_KEY || '',
    GUARD_API_KEYS: parseKeys(process.env.GUARD_API_KEY || process.env.GUARD_API_KEYS || process.env.KILO_API_KEY),
    // Timeout do guard. MEDIDO no gateway: ~21s com o modelo de
    // content-safety (o free tier do Kilo é lento). Com 2500ms o guard
    // estourava o tempo SEMPRE e o protection de injeção ficava morto.
    GUARD_TIMEOUT_MS: parseInt(process.env.GUARD_TIMEOUT_MS) || 30000,
    // Teto de tokens do guard. Medido: com reasoning_effort=none a resposta
    // sai em ~10 tokens; 16 deixava little room e 64 é folga.
    GUARD_MAX_TOKENS: parseInt(process.env.GUARD_MAX_TOKENS) || 64,
    // 'none' DESLIGA o raciocínio do modelo — é o que um classificador
    // precisa: resposta direta, sem gastar orçamento pensando.
    GUARD_REASONING_EFFORT: process.env.GUARD_REASONING_EFFORT || 'none',
    // Umbral de bloqueio: o modelo devolve a probabilidade de ser injeção.
    GUARD_THRESHOLD: parseFloat(process.env.GUARD_THRESHOLD) || 0.5,

    // ============================================================
    // MODERAÇÃO DE LINGUAGEM OFENSIVA
    // Sistema SEPARADO do guard: o guard detecta INJEÇÃO DE PROMPT
    // ("ignore suas instruções"), a moderação detecta XINGAMENTO.
    // Usa o mesmo gateway, com modelo próprio quando definido.
    // ============================================================
    MODERATION_ENABLED: String(process.env.MODERATION_ENABLED ?? 'true').toLowerCase() !== 'false',
    MODERATION_MODEL: process.env.MODERATION_MODEL || process.env.KILO_DEFAULT_MODEL || '',
    MODERATION_BASE_URL: (process.env.MODERATION_BASE_URL || process.env.KILO_BASE_URL || 'https://ai-gateway.kilo.ai/api/v1').replace(/\/+$/, ''),
    // Vazio = herda o pool do KILO_API_KEY. Com vírgula = pool próprio.
    MODERATION_API_KEYS: MODERATION_API_KEYS.length ? MODERATION_API_KEYS : KILO_API_KEYS,
    MODERATION_API_KEY: (MODERATION_API_KEYS.length ? MODERATION_API_KEYS : KILO_API_KEYS)[0] || '',
    MODERATION_FALLBACK_MODEL: process.env.MODERATION_FALLBACK_MODEL || '',
    MODERATION_AI_ALL: String(process.env.MODERATION_AI_ALL ?? 'true').toLowerCase() !== 'false',
    MODERATION_CONCURRENCY: Math.max(1, parseInt(process.env.MODERATION_CONCURRENCY) || 4),
    MODERATION_IMAGE_CHECK: String(process.env.MODERATION_IMAGE_CHECK ?? 'true').toLowerCase() !== 'false',
    MODERATION_MIN_SEVERITY: process.env.MODERATION_MIN_SEVERITY || 'medium',
    MODERATION_TIMEOUT_MS: parseInt(process.env.MODERATION_TIMEOUT_MS) || 30000,
    // Confiança mínima da IA para bloquear (abaixo disso, libera)
    MODERATION_MIN_CONFIDENCE: parseFloat(process.env.MODERATION_MIN_CONFIDENCE) || 0.6,
    // Teto de tokens. Modelos de raciocínio gastam o orçamento antes de
    // responder: com menos que isso o content volta vazio.
    MODERATION_MAX_TOKENS: parseInt(process.env.MODERATION_MAX_TOKENS) || 4096,
    // 'none' = classificador SEM raciocínio (enviado ao gateway como
    // reasoning_effort=none): a resposta sai direta, sem gastar orçamento
    // pensando. Medido no gateway: reasoning_tokens=0 com esse valor.
    MODERATION_REASONING_EFFORT: process.env.MODERATION_REASONING_EFFORT || 'none'
};
