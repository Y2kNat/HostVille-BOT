const store = require('../utils/warnStore');
const { logInfo, logError } = require('../utils/logger');
const { sendLog } = require('../utils/realtime');

/**
 * Avisos (warnings) — ARQUIVO LOCAL, data/warnings.json
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POR QUE ARQUIVO E NÃO MONGODB
 * ═══════════════════════════════════════════════════════════════════════
 * Decisão do dono: o histórico de avisos vem do Termux. Ver o cabeçalho de
 * `utils/warnStore.js` para o argumento completo — em resumo:
 *
 *   1. O Mongo é remoto e a rede do Termux já falhou (AbortError e DNS
 *      falhando duas vezes seguidas na auditoria; "rota alternativa do
 *      gateway também falhou (fetch failed)" aparece no `npm test`). Se a
 *      gravação do aviso depende de rede, o aviso se perde na hora em que o
 *      filtro pegou alguém.
 *   2. O que se perde não é conforto do usuário, é a ESCADA de punição:
 *      mute de 1h → 6h → 24h → 7 dias → 28 dias zera, e quem tinha 19
 *      avisos volta a 0.
 *   3. O processo morre o tempo todo (RestartManager chama process.exit(0),
 *      watchdog, low-memory killer do Android) e o ARQUIVO atravessa isso.
 *
 * O QUE NÃO PROTEGE: desinstalar o Termux ou limpar o storage do app. Para
 * isso só um backup remoto serviria.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ESCOPO
 * ═══════════════════════════════════════════════════════════════════════
 * Todo aviso carrega a guild de origem, e a escada conta só o aviso do
 * servidor onde a infração aconteceu. Antes não havia escopo: um usuário
 * com 19 avisos no servidor A era BANIDO no B por avisos que não houve lá,
 * e o /clearwarns de um admin do B apagava o histórico do A.
 *
 * Aviso vindo do Mongo antigo (sem guild) continua contável em qualquer
 * servidor — são infrações reais de origem irrecuperável, e descartá-las
 * daria reset grátis de punição.
 */
class WarningManager {
    /**
     * @param {string} userId
     * @param {string} [guildId] servidor atual; sem ele, conta todos
     */
    static async getWarnings(userId, guildId) {
        return store.get(userId, guildId);
    }

    /**
     * @param {string} userId
     * @param {object} warnData { reason, guildId } + moderator/auto/timestamp
     */
    static async addWarning(userId, warnData) {
        const ok = store.add(userId, warnData);
        if (!ok) {
            // Falha de disco NÃO pode ser silenciosa: o aviso perdido é
            // punição perdida. Registra e avisa, senão a staff acha que
            // aplicou aviso e não aplicou.
            logError(`Falha ao gravar aviso de ${userId} — punição NÃO contabilizada`);
            sendLog('❌ Falha ao gravar aviso em disco (data/warnings.json) — aviso NÃO foi registrado', 'error', 'system');
        }
        sendLog('⚠️ Warn aplicado em ' + userId + ' | Motivo: ' + (warnData.reason || 'Não informado'), 'warn', 'moderation');
        return this.getWarnings(userId, warnData.guildId);
    }

    /**
     * @param {string} userId
     * @param {string} [guildId] limpa só deste servidor; sem argumento, limpa tudo
     */
    static async clearWarnings(userId, guildId) {
        store.clear(userId, guildId);
        sendLog('🧹 Warnings limpos para ' + userId, 'info', 'moderation');
    }

    /**
     * Escada de punição automática.
     *
     * Usa `>=` e não `===`. Com igualdade exata, qualquer pulo de degrau
     * desligava a punição inteira daquele degrau: o usuário ia de 4 para 7
     * avisos e nunca passava pelo mute de 1h, indo direto ao de 6h. Como
     * `addWarning` pode ser chamado em rajada (filtro pegando duas
     * mensagens da mesma pessoa no mesmo segundo), o pulo é reachable.
     *
     * @param {import('discord.js').GuildMember} member
     * @param {string} guildId
     */
    static async checkAutoPunishment(member, guildId) {
        const warns = await this.getWarnings(member.id, guildId);
        const n = warns.length;

        if (n >= 30) {
            try {
                await member.timeout(2419200000, '30 avisos - mute automático de 28 dias (HostVille • BOT)');
                logInfo(`${member.user.tag} foi silenciado por 28 dias (30 avisos)`);
                sendLog('🔇 ' + member.user.tag + ' silenciado por 28 dias (30 avisos)', 'warn', 'moderation');
                return '🔇 Usuário silenciado por 28 dias (30 avisos)';
            } catch (err) {
                logError(`Erro ao aplicar mute: ${err.message}`);
                sendLog('❌ Erro ao aplicar mute em ' + member.user.tag + ': ' + err.message, 'error', 'system');
            }
            return null;
        }

        if (n >= 25) {
            try {
                await member.timeout(604800000, '25 avisos - mute automático de 7 dias (HostVille • BOT)');
                logInfo(`${member.user.tag} foi silenciado por 7 dias (25 avisos)`);
                sendLog('🔇 ' + member.user.tag + ' silenciado por 7 dias (25 avisos)', 'warn', 'moderation');
                return '🔇 Usuário silenciado por 7 dias (25 avisos)';
            } catch (err) {
                logError(`Erro ao aplicar mute: ${err.message}`);
                sendLog('❌ Erro ao aplicar mute em ' + member.user.tag + ': ' + err.message, 'error', 'system');
            }
            return null;
        }

        if (n >= 20) {
            try {
                await member.timeout(86400000, '20 avisos - mute automático de 24h (HostVille • BOT)');
                logInfo(`${member.user.tag} foi silenciado por 24h (20 avisos)`);
                sendLog('🔇 ' + member.user.tag + ' silenciado por 24h (20 avisos)', 'warn', 'moderation');
                return '🔇 Usuário silenciado por 24h (20 avisos)';
            } catch (err) {
                logError(`Erro ao aplicar mute: ${err.message}`);
                sendLog('❌ Erro ao aplicar mute em ' + member.user.tag + ': ' + err.message, 'error', 'system');
            }
            return null;
        }

        if (n >= 15) {
            try {
                await member.timeout(21600000, '15 avisos - mute automático de 6h (HostVille • BOT)');
                logInfo(`${member.user.tag} foi silenciado por 6h (15 avisos)`);
                sendLog('🔇 ' + member.user.tag + ' silenciado por 6h (15 avisos)', 'warn', 'moderation');
                return '🔇 Usuário silenciado por 6h (15 avisos)';
            } catch (err) {
                logError(`Erro ao aplicar mute: ${err.message}`);
                sendLog('❌ Erro ao aplicar mute em ' + member.user.tag + ': ' + err.message, 'error', 'system');
            }
            return null;
        }

        if (n >= 10) {
            try {
                await member.timeout(3600000, '10 avisos - mute automático de 1h (HostVille • BOT)');
                logInfo(`${member.user.tag} foi silenciado por 1h (10 avisos)`);
                sendLog('🔇 ' + member.user.tag + ' silenciado por 1h (10 avisos)', 'warn', 'moderation');
                return '🔇 Usuário silenciado por 1h (10 avisos)';
            } catch (err) {
                logError(`Erro ao aplicar mute: ${err.message}`);
                sendLog('❌ Erro ao aplicar mute em ' + member.user.tag + ': ' + err.message, 'error', 'system');
            }
            return null;
        }

        return null;
    }
}

module.exports = WarningManager;