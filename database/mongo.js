require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { logSuccess, logError } = require('../utils/logger');
const { comRetry } = require('../utils/retry');

mongoose.set('strictQuery', true);

comRetry(() => mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    retryWrites: true,
    retryReads: true,
}), { tentativas: 5, baseMs: 2000, contexto: 'mongo' })
    .then(() => logSuccess('MongoDB conectado'))
    .catch(err => logError('MongoDB: ' + err.message));

module.exports = mongoose;