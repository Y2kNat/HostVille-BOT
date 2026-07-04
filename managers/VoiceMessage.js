const gTTS = require('gtts');
const fs = require('fs');
const path = require('path');
const db = require('../database/db');

class VoiceMessage {

    static VOICE_NAMES = {
        default: 'Padrão (Google)',
        antonio: 'Antonio (Homem Adulto)',
        francisca: 'Francisca (Mulher Adulta)',
        thalita: 'Thalita (Mulher Jovem)',
        giovanna: 'Giovanna (Jovem)',
        fabio: 'Fabio (Homem)',
        humberto: 'Humberto (Homem)',
        leticia: 'Leticia (Mulher)',
        manuela: 'Manuela (Mulher)',
        donato: 'Donato (Homem)',
        brenda: 'Brenda (Mulher)',
        julio: 'Julio (Homem)',
        yara: 'Yara (Mulher)',
    };

    static async send(message, text, forceVoice = null) {
        if (!text || text.length < 3) return null;

        const dir = path.join(__dirname, '..', 'temp');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const fileName = `voz-${Date.now()}.mp3`;
        const filePath = path.join(dir, fileName);

        const guildConfig = db.getConnection(message.guild?.id) || {};
        const selectedVoice = forceVoice || guildConfig.selectedVoice || 'default';
        const voiceName = this.VOICE_NAMES[selectedVoice] || 'Padrão';

        let cleanText = text
            .replace(/fala|diga|em voz|por áudio|por audio|mensagem de voz/gi, '')
            .replace(/[""]/g, '')
            .trim();

        if (cleanText.length < 3) cleanText = text;

        return new Promise((resolve) => {
            const gtts = new gTTS(cleanText, 'pt-br');
            
            gtts.save(filePath, async (err) => {
                if (err) {
                    console.error('Erro TTS:', err.message);
                    resolve(null);
                    return;
                }

                try {
                    await message.reply({
                        content: `🔊 **Mensagem de voz**`,
                        files: [{ attachment: filePath, name: 'mensagem-de-voz.mp3' }]
                    });

                    setTimeout(() => {
                        try { fs.unlinkSync(filePath); } catch (e) {}
                    }, 120000);

                    resolve(true);
                } catch (e) {
                    resolve(null);
                }
            });
        });
    }
}

module.exports = VoiceMessage;