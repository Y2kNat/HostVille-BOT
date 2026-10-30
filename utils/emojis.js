function findEmoji(client, name) {
    return client.emojis.cache.find(e => e.name === name) || null;
}

function emojiString(client, name, fallback = '') {
    const e = findEmoji(client, name);
    if (!e) return fallback;
    return e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`;
}

function loadingText(client) {
    const fallback = '[![Loading](https://cdn3.emoji.gg/emojis/190595-loading.gif)](https://emoji.gg/emoji/190595-loading)';
    return `-# Pensando ${emojiString(client, 'loading', fallback)}`;
}

module.exports = { findEmoji, emojiString, loadingText };
