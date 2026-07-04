const db = require('../database/db');
const { logInfo, logError } = require('../utils/logger');

class WarningManager {
    static async getWarnings(userId) {
        return db.getWarnings(userId);
    }

    static async addWarning(userId, warnData) {
        return db.addWarning(userId, warnData);
    }

    static async clearWarnings(userId) {
        await db.clearWarnings(userId);
    }

    static async checkAutoPunishment(member) {
        const warns = await this.getWarnings(member.id);

        if (warns.length === 5) {
            try {
                await member.timeout(
                    3600000,
                    '5 avisos - mute automático de 1h (HostVille • BOT)'
                );

                logInfo(`${member.user.tag} foi silenciado por 1h (5 avisos)`);
                return '🔇 Usuário silenciado por 1h (5 avisos)';
            } catch (err) {
                logError(`Erro ao aplicar mute: ${err.message}`);
            }

        } else if (warns.length === 10) {
            try {
                await member.timeout(
                    21600000,
                    '10 avisos - mute automático de 6h (HostVille • BOT)'
                );

                logInfo(`${member.user.tag} foi silenciado por 6h (10 avisos)`);
                return '🔇 Usuário silenciado por 6h (10 avisos)';
            } catch (err) {
                logError(`Erro ao aplicar mute: ${err.message}`);
            }

        } else if (warns.length === 15) {
            try {
                await member.timeout(
                    86400000,
                    '15 avisos - mute automático de 24h (HostVille • BOT)'
                );

                logInfo(`${member.user.tag} foi silenciado por 24h (15 avisos)`);
                return '🔇 Usuário silenciado por 24h (15 avisos)';
            } catch (err) {
                logError(`Erro ao aplicar mute: ${err.message}`);
            }

        } else if (warns.length === 20) {
            try {
                await member.kick(
                    '20 avisos - expulsão automática (HostVille • BOT)'
                );

                logInfo(`${member.user.tag} foi expulso (20 avisos)`);
                return '👢 Usuário expulso (20 avisos)';
            } catch (err) {
                logError(`Erro ao expulsar: ${err.message}`);
            }

        } else if (warns.length >= 30) {
            try {
                await member.ban({
                    reason: '30 avisos - banimento automático (HostVille • BOT)'
                });

                logInfo(`${member.user.tag} foi banido (30 avisos)`);
                return '🔨 Usuário banido (30 avisos)';
            } catch (err) {
                logError(`Erro ao banir: ${err.message}`);
            }
        }

        return null;
    }
}

module.exports = WarningManager;