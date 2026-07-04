const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class ImageAnalyzer {

    static async analyze(message) {
        if (message.attachments.size === 0) return null;
        const attachment = message.attachments.first();
        const isImage = attachment.contentType?.startsWith('image/');
        if (!isImage) return null;
        return { type: 'image', url: attachment.url, name: attachment.name, contentType: attachment.contentType };
    }

    /**
     * Analisar imagem com IA
     */
    static async analyzeWithAI(message, imageUrl = null) {
        try {
            let url = imageUrl;
            let question = message.content || 'O que você vê nesta imagem?';

            // Se não tem URL, verifica anexos na mensagem atual
            if (!url && message.attachments.size > 0) {
                const attachment = message.attachments.first();
                if (attachment.contentType?.startsWith('image/')) {
                    url = attachment.url;
                }
            }

            // Se respondeu uma mensagem que tem imagem
            if (!url && message.reference) {
                try {
                    const referenced = await message.channel.messages.fetch(message.reference.messageId);
                    if (referenced && referenced.attachments.size > 0) {
                        const refAttachment = referenced.attachments.first();
                        if (refAttachment.contentType?.startsWith('image/')) {
                            url = refAttachment.url;
                        }
                    }
                } catch (e) {}
            }

            // Se ainda não tem URL, busca a última imagem do canal
            if (!url) {
                try {
                    const recentMessages = await message.channel.messages.fetch({ limit: 20 });
                    const lastImage = recentMessages.find(msg => 
                        msg.attachments.size > 0 && 
                        msg.attachments.first().contentType?.startsWith('image/')
                    );
                    if (lastImage) {
                        url = lastImage.attachments.first().url;
                    }
                } catch (e) {}
            }

            if (!url) return null;

            const completion = await groq.chat.completions.create({
                model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: `Analise esta imagem e responda de forma descontraída e engraçada. A pergunta do usuário foi: "${question}". Máximo 3 linhas. Português brasileiro.` },
                        { type: 'image_url', image_url: { url } }
                    ]
                }],
                temperature: 0.8,
                max_tokens: 200
            });

            const response = completion.choices[0]?.message?.content?.trim();
            return response || '📸 Não consegui analisar essa imagem...';

        } catch (error) {
            console.error('Erro ao analisar imagem:', error.message);
            return '📸 Não consegui processar essa imagem agora. Tenta de novo!';
        }
    }
}

module.exports = ImageAnalyzer;