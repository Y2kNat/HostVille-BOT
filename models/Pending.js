const mongoose = require('../database/mongo');

const PendingSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['aprender', 'corrigir', 'comando', 'acao', 'responder', 'modo'],
        required: true
    },
    data: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    done: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    executedAt: Date,
    result: String
});

module.exports = mongoose.model('Pending', PendingSchema);
