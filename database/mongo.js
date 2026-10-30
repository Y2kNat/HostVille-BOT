require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { logSuccess, logError } = require('../utils/logger');

mongoose.connect(process.env.MONGO_URI)
    .then(() => logSuccess('MongoDB conectado'))
    .catch(err => logError('MongoDB: ' + err.message));

module.exports = mongoose;