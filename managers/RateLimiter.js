/**
 * Rate limiting por usuário, só para o que gasta request.
 *
 * Escopo deliberado (pedido explícito):
 *   - TaskRunner  → mais restrito (gera até 2 requests: classificador + execução)
 *   - Menções     → chat livre, restrito
 *   - Tickets     → mais folgado, é atendimento e não pode ser travado
 *
 * Não existe limite aqui para comandos slash, moderação ou webhooks.
 */
class RateLimiter {
    constructor() {
        this.buckets = new Map();
        // limpeza periódica para não crescer infinito
        this._timer = setInterval(() => this.cleanup(), 10 * 60 * 1000);
        if (this._timer.unref) this._timer.unref();
    }

    /**
     * @param {string} key    identidade (ex.: userId)
     * @param {object} policy { windowMs, max }
     * @returns {{ ok: boolean, remaining: number, retryAfter: number }}
     */
    check(key, policy) {
        const { windowMs, max } = policy;
        const now = Date.now();
        const b = this.buckets.get(key) || { hits: [], janela: windowMs };
        b.hits = b.hits.filter(t => now - t < windowMs);

        if (b.hits.length >= max) {
            const oldest = b.hits[0];
            const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
            this.buckets.set(key, b);
            return { ok: false, remaining: 0, retryAfter };
        }

        b.hits.push(now);
        this.buckets.set(key, b);
        return { ok: true, remaining: max - b.hits.length, retryAfter: 0 };
    }

    /** Consome uma unidade e devolve o resultado. */
    take(key, policy) {
        const r = this.check(key, policy);
        return r;
    }

    reset(key) {
        this.buckets.delete(key);
    }

    /**
     * Limpa hits vencidos. Usa a janela do proprio bucket, nao um teto fixo:
     * com o piso de 1h, qualquer janela maior (a de 12h/24h dos tiers) perdia
     * o estado na proxima limpeza e o limite nao valia nada.
     */
    cleanup() {
        const now = Date.now();
        for (const [k, b] of this.buckets) {
            const janela = b.janela || 60 * 60 * 1000;
            b.hits = b.hits.filter(t => now - t < janela);
            if (!b.hits.length) this.buckets.delete(k);
        }
    }
}

// Políticas. Ajuste os números se o uso mudar.
const POLICIES = {
    // TaskRunner: classificador + execução podem ser 2 requests
    task: { windowMs: 30000, max: 2 },
    // Menção / chat livre
    mention: { windowMs: 10000, max: 3 },
    // Tickets: mais folgado, é atendimento
    ticket: { windowMs: 5000, max: 3 },
    // B20: painel de administração na DM. Este escopo não existia, e é o
    // mais crítico dos seis: o que está atrás dele é o código de acesso que
    // desliga a moderação de todos os servidores do bot.
    //
    // Por que o anti-spam não segurava: o caminho de DM faz `return` na
    // linha 82 do messageCreate, ANTES do checkSpam (linha 306) e antes do
    // anti-link. Nenhuma tentativa de senha passava por filtro nenhum.
    //
    // 5 tentativas por minuto: 10.000 combinações de um código de 4 dígitos
    // levariam mais de 33 horas em vez de minutos.
    dm: { windowMs: 60000, max: 5 },
    // Mesmo código de acesso, outra porta: o `/adm`. Entrou na mesma janela
    // porque os dois defendsem o mesmo segredo — um atacante que descobre o
    // painel de slash não pode ganhar tentativas de graça por trocar a porta.
    adm: { windowMs: 60000, max: 5 },
    // Ações do painel depois de autenticado: um `set` por vez. Sem isto, um
    // duplo clique (ou um retry do cliente do celular) vira duas gravações e
    // o segundo "toggle" DESLIGA o que o primeiro LIGOU.
    admwrite: { windowMs: 10000, max: 4 },
    // Geração por tier: cada tier tem sua própria janela curta, para segurar
    // rajada sem conflitar com os cooldowns longos (12h/24h), que ficam no
    // utils/TierCooldown.js porque precisam sobreviver a restart.
    'gen:MIN': { windowMs: 60000, max: 1 },
    'gen:MED': { windowMs: 300000, max: 2 },
    'gen:HIGH': { windowMs: 3600000, max: 1 },
    'gen:MAX': { windowMs: 3600000, max: 1 }
};

const limiter = new RateLimiter();

module.exports = {
    limiter,
    POLICIES,
    /**
     * @returns {null|string} null se pode seguir, ou a mensagem de aguardo
     */
    gate(scope, userId) {
        const policy = POLICIES[scope];
        if (!policy) return null;
        // A chave inclui o escopo: sem isso 'gen:max' e 'gen:high' cairiam no
        // MESMO bucket, porque o userId sozinho era a identidade.
        const r = limiter.take(`${scope}:${userId}`, policy);
        if (r.ok) return null;
        const s = r.retryAfter <= 1 ? 'em instantes' : `daqui ${duracaoCurta(r.retryAfter)}`;
        return s;
    }
};

/** 45s -> "45s", 3600s -> "1h", 7325s -> "2h3min". Janelas longas precisam de
 *  unidade maior, senão o tier 'max'(diria "volta daqui 79140s". */
function duracaoCurta(segundos) {
    if (segundos < 3600) return `${segundos}s`;
    const h = Math.floor(segundos / 3600);
    const m = Math.round((segundos % 3600) / 60);
    return m ? `${h}h${m}min` : `${h}h`;
}
