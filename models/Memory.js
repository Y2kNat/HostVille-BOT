const mongoose = require('../database/mongo');

const MemorySchema = new mongoose.Schema({
    user: String,
    userId: String,
    question: String,
    answer: String,
    understood: Boolean,
    category: String,
    guildId: String,
    // Quem aplicou. Avisos migraram para data/warnings.json (utils/warnStore.js),
    // mas este campo foi declarada porque os 56 avisos do Mongo já gravados
    // não tinham autoria — o schema nunca declareu, e mongoose descarta o
    // que não está declarado. /warnings mostrava <@undefined> em todos.
    moderator: String,
    // Como o aviso nasceu: 'auto' (filtro de palavra) ou 'manual' (/warn).
    // Sem isto não dá para distinguir punição automática de decisão de
    // staff ao ler o histórico.
    auto: Boolean,
    timestamp: { type: Date, default: Date.now }
});

// O caminho quente é `getCustomWords`, que filtra por category e question.
// Avisos saíram do Mongo (agora são arquivo), então a checagem de punição
// não consulta mais esta coleção — mas o índice fica, porque palavras
// customizadas são lidas a cada mensagem que passa pelo filtro.
MemorySchema.index({ category: 1, userId: 1 });
MemorySchema.index({ category: 1, guildId: 1 });
MemorySchema.index({ category: 1, question: 1 });

module.exports = mongoose.model('Memory', MemorySchema);
