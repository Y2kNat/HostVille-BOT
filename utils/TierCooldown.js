const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'tierCooldowns.json');

/**
 * Cooldown dos tiers caros (high 12h, max 24h).
 *
 * Por que NAO usar o RateLimiter para isso: o bucket dele vive num Map em
 * memoria, e o bot tem RestartManager. Um cooldown de 24h que evapora no
 * restart nao é cooldown. Aqui o estado vai para data/tierCooldowns.json,
 * mesmo padrao de data/maintenance.json.
 *
 * O RateLimiter continua cuidando da rajada curta (ver POLICIES 'gen:*').
 * As duas camadas sao independentes: pode passar a janela curta e ainda
 * estar dentro do cooldown longo.
 *
 * Formato do arquivo: { "123456789": { "HIGH": 1756464000000, ... } }
 * O valor e o timestamp (ms) ate quando o tier volta a ficar disponivel.
 */
class TierCooldown {

    /** Lê o arquivo inteiro. Arquivo ausente ou corrompido = sem cooldowns. */
    static _load() {
        try {
            const raw = fs.readFileSync(FILE, 'utf-8');
            const d = JSON.parse(raw);
            return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
        } catch {
            return {};
        }
    }

    static _save(dados) {
        try {
            if (!fs.existsSync(path.dirname(FILE))) fs.mkdirSync(path.dirname(FILE), { recursive: true });
            fs.writeFileSync(FILE, JSON.stringify(dados, null, 2), 'utf-8');
            return true;
        } catch {
            // Falha de disco não pode derrubar a geração: o usuário perde o
            // cooldown, não o bot.
            return false;
        }
    }

    /**
     * @param {string} userId
     * @param {string} tier 'HIGH' | 'MAX' (min/med não têm cooldown)
     * @returns {{ bloqueado: boolean, restanteMs: number }}
     */
    static get(userId, tier) {
        const dados = this._load();
        const alvo = dados[String(userId)];
        if (!alvo) return { bloqueado: false, restanteMs: 0 };

        const ate = Number(alvo[String(tier).toUpperCase()]) || 0;
        const restanteMs = ate - Date.now();
        if (restanteMs <= 0) return { bloqueado: false, restanteMs: 0 };
        return { bloqueado: true, restanteMs };
    }

    /**
     * @param {string} userId
     * @param {string} tier
     * @param {number} cooldownH horas de bloqueio
     * @returns {boolean} true se gravou
     */
    static set(userId, tier, cooldownH) {
        const h = Number(cooldownH) || 0;
        if (h <= 0) return false;
        const dados = this._load();
        const chave = String(userId);
        dados[chave] = dados[chave] || {};
        dados[chave][String(tier).toUpperCase()] = Date.now() + h * 3600 * 1000;
        return this._save(dados);
    }

    /** Libera o tier de um usuário (usado pelo admin e pelos testes). */
    static clear(userId, tier) {
        const dados = this._load();
        const chave = String(userId);
        if (!dados[chave]) return false;
        if (tier) {
            delete dados[chave][String(tier).toUpperCase()];
            if (!Object.keys(dados[chave]).length) delete dados[chave];
        } else {
            delete dados[chave];
        }
        return this._save(dados);
    }

    /** Remove timestamps vencidos para o arquivo não crescer sem parar. */
    static prune() {
        const dados = this._load();
        const agora = Date.now();
        let mudou = false;
        for (const user of Object.keys(dados)) {
            for (const tier of Object.keys(dados[user])) {
                if (Number(dados[user][tier]) <= agora) {
                    delete dados[user][tier];
                    mudou = true;
                }
            }
            if (!Object.keys(dados[user]).length) {
                delete dados[user];
                mudou = true;
            }
        }
        if (mudou) this._save(dados);
        return mudou;
    }

    /** "11h23" / "22min" / "agora". Para o embed e para o botão desabilitado. */
    static formatar(restanteMs) {
        const ms = Math.max(0, Math.floor(restanteMs));
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        if (h) return m ? `${h}h${m}` : `${h}h`;
        if (m) return `${m}min`;
        return 'agora';
    }
}

module.exports = TierCooldown;
module.exports.FILE = FILE;
