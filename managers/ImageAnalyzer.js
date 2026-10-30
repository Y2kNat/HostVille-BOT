class ImageAnalyzer {

    static async analyze(message) {
        if (message.attachments.size === 0) return null;
        const attachment = message.attachments.first();
        const isImage = attachment.contentType?.startsWith('image/');
        if (!isImage) return null;
        return { type: 'image', url: attachment.url, name: attachment.name, contentType: attachment.contentType };
    }

    /**
 * Analisar imagem com IA.
 *
 * NOTA: a análise multimodal está DESATIVADA no projeto
 * (ALLOWED_IMAGE_CHANNELS = [] em events/messageCreate.js) e o modelo
 * local configurado (qwen2.5-coder:1.5b) não é um modelo de visão.
 * Este método preserva a assinatura original para compatibilidade com
 * a chamada existente, mas retorna indisponibilidade em vez de chamar IA.
 */
static async analyzeWithAI(message, imageUrl = null) {
    return '📸 Análise de imagem não está disponível neste servidor.';
}
}

module.exports = ImageAnalyzer;