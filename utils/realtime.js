const Pusher = require('pusher');

const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER || 'us2',
    useTLS: true
});

function sendLog(message, type, source) {
    try {
        pusher.trigger('bot-logs', 'new-log', {
            message: message,
            type: type || 'info',
            source: source || 'bot',
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        console.error('Erro Pusher:', e.message);
    }
}

module.exports = { sendLog };
