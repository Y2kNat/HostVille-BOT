const db = require('../database/db');

/**
 * Contadores do painel.
 *
 * ERRO D (corrigido): `commandsUsed` não era gravado por `saveStats` nem lido
 * por `loadStats`. O mapa vivia só no objeto em memória, e o `/adm` é
 * justamente o comando que se usa muito — então ele voltava a zero a cada
 * restart, sem que ninguém percebesse.
 *
 * ERRO E (corrigido): os contadores eram globais e não diziam DE ONDE veio a
 * infração. Um servidor podia banir um usuário que já tinha sido avisado oito
 * vezes em outro lugar, e o painel não tinha como mostrar isso.
 */

const stats = {
    messagesDeleted: 0,
    warnsGiven: 0,
    membersJoined: 0,
    membersLeft: 0,
    // Novos: o painel precisa deles para responder "o que está acontecendo".
    xingamentos: 0,
    xingamentosStaff: 0,
    needsReview: 0,
    spamBloqueado: 0,
    linkBloqueado: 0,
    commandsUsed: {},

    reset() {
        this.messagesDeleted = 0;
        this.warnsGiven = 0;
        this.membersJoined = 0;
        this.membersLeft = 0;
        this.xingamentos = 0;
        this.xingamentosStaff = 0;
        this.needsReview = 0;
        this.spamBloqueado = 0;
        this.linkBloqueado = 0;
        this.commandsUsed = {};
    }
};

class StatsManager {
    static getStats() {
        return stats;
    }

    static async loadStats() {
        try {
            const savedStats = await db.getStats();
            if (savedStats) {
                for (const campo of Object.keys(stats)) {
                    if (campo === 'commandsUsed') continue;
                    if (typeof savedStats[campo] === 'number' && Number.isFinite(savedStats[campo])) {
                        stats[campo] = savedStats[campo];
                    }
                }
                stats.commandsUsed = (savedStats.commandsUsed && typeof savedStats.commandsUsed === 'object')
                    ? savedStats.commandsUsed
                    : {};
            }
        } catch (e) {}
    }

    static async saveStats() {
        await db.saveStats({
            messagesDeleted: stats.messagesDeleted,
            warnsGiven: stats.warnsGiven,
            membersJoined: stats.membersJoined,
            membersLeft: stats.membersLeft,
            xingamentos: stats.xingamentos,
            xingamentosStaff: stats.xingamentosStaff,
            needsReview: stats.needsReview,
            spamBloqueado: stats.spamBloqueado,
            linkBloqueado: stats.linkBloqueado,
            commandsUsed: stats.commandsUsed
        });
    }

    static trackCommand(commandName) {
        stats.commandsUsed[commandName] = (stats.commandsUsed[commandName] || 0) + 1;
    }

    static incrementMessagesDeleted(amount = 1) {
        stats.messagesDeleted += amount;
    }

    static incrementWarns() {
        stats.warnsGiven++;
    }

    static incrementMembersJoined() {
        stats.membersJoined++;
    }

    static incrementMembersLeft() {
        stats.membersLeft++;
    }

    /**
     * Uma mensagem foi classificada como offendida.
     *
     * @param {object} [opts]
     * @param {boolean} [opts.staff]    staff/admin: logado mas NÃO punido
     * @param {boolean} [opts.review]   a IA caiu e o caso ficou needs_review
     */
    static incrementXingamento(opts = {}) {
        if (opts.staff) stats.xingamentosStaff++;
        else if (!opts.review) stats.xingamentos++;
        if (opts.review) stats.needsReview++;
    }

    static incrementSpam() {
        stats.spamBloqueado++;
    }

    static incrementLink() {
        stats.linkBloqueado++;
    }
}

module.exports = StatsManager;
