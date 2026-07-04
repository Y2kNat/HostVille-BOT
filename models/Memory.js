const mongoose = require('../database/mongo');

const MemorySchema = new mongoose.Schema({
    user: String,
    userId: String,
    question: String,
    answer: String,
    understood: Boolean,
    category: String,
    guildId: String,
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Memory', MemorySchema);
