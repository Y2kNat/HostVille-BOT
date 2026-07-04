const db = require('../database/db');

const stats = {
    messagesDeleted: 0,
    warnsGiven: 0,
    membersJoined: 0,
    membersLeft: 0,
    commandsUsed: {},
    
    reset() {
        this.messagesDeleted = 0;
        this.warnsGiven = 0;
        this.membersJoined = 0;
        this.membersLeft = 0;
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
                stats.messagesDeleted = savedStats.messagesDeleted || 0;
                stats.warnsGiven = savedStats.warnsGiven || 0;
                stats.membersJoined = savedStats.membersJoined || 0;
                stats.membersLeft = savedStats.membersLeft || 0;
            }
        } catch (e) {}
    }

    static async saveStats() {
        await db.saveStats({
            messagesDeleted: stats.messagesDeleted,
            warnsGiven: stats.warnsGiven,
            membersJoined: stats.membersJoined,
            membersLeft: stats.membersLeft
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
}

module.exports = StatsManager;