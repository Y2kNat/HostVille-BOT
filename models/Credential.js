const mongoose = require('../database/mongo');

const CredentialSchema = new mongoose.Schema({
    user: { type: String, required: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['full', 'owner', 'admin'], required: true },
    guildId: { type: String, default: null },
    active: { type: Boolean, default: true },
    lastLogin: Date,
    createdBy: String,
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Credential', CredentialSchema);
