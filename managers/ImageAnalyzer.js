const { logInfo, logWarn, logError } = require('../utils/logger');
const { chat } = require('../utils/kiloChat');
const config = require('../config');

const LIMITE = 4096;

class ImageAnalyzer {
    static async analyze(message) {
        if (!message.attachments || message.attachments.size === 0) return null;
        const a = message.attachments.first();
        if (!a.contentType?.startsWith('image/')) return null;
        return { type: 'image', url: a.url, name: a.name, contentType: a.contentType, size: a.size };
    }

    static async analyzeWithAI(message, instrucao = '') {
        const img = await this.analyze(message);
        if (!img) return null;
        const cfg = config.IMAGE_ANALYZER;
        if (!cfg.MODEL) return '📸 O modelo configurado não consegue analisar imagens.';
        const prompt = (instrucao || 'Descreva o que aparece nesta imagem.').slice(0, 500);
        try {
            const r = await chat({
                model: cfg.MODEL,
                messages: [{ role: 'user', content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: img.url } }
                ] }],
                temperature: 0.4,
                max_tokens: cfg.MAX_TOKENS,
                reasoning_effort: 'none',
                timeoutMs: cfg.TIMEOUT_MS,
                deadlineMs: cfg.TIMEOUT_MS,
                apiKey: config.KILO_API_KEYS
            });
            const texto = String(r.content || '').trim();
            if (!texto) return '📸 O modelo respondeu vazio para esta imagem.';
            logInfo(`ImageAnalyzer: analisou ${img.name}`);
            return texto.slice(0, LIMITE);
        } catch (e) {
            logError(`ImageAnalyzer: falha: ${e.message}`);
            return '📸 Não consegui analisar a imagem agora.';
        }
    }
    static async translateImage(message) {
        const img = await this.analyze(message);
        if (!img) return null;
        const cfg = config.IMAGE_ANALYZER;
        if (!cfg.MODEL) return '📸 O modelo configurado não consegue analisar imagens.';
        try {
            const r = await chat({
                model: cfg.MODEL,
                messages: [{ role: 'user', content: [
                    { type: 'text', text: 'Transcreva TODO o texto visível nesta imagem e traduza para português brasileiro. Responda em duas seções: Texto original e Tradução. Se não houver texto, responda "Nenhum texto encontrado na imagem."' },
                    { type: 'image_url', image_url: { url: img.url } }
                ] }],
                temperature: 0.2,
                max_tokens: cfg.MAX_TOKENS,
                reasoning_effort: 'none',
                timeoutMs: cfg.TIMEOUT_MS,
                deadlineMs: cfg.TIMEOUT_MS,
                apiKey: config.KILO_API_KEYS
            });
            const texto = String(r.content || '').trim();
            if (!texto) return '📸 O modelo respondeu vazio para esta imagem.';
            logInfo(`ImageAnalyzer: traduziu ${img.name}`);
            return texto.slice(0, LIMITE);
        } catch (e) {
            logError(`ImageAnalyzer: falha na tradução: ${e.message}`);
            return '📸 Não consegui traduzir a imagem agora.';
        }
    }
}

module.exports = ImageAnalyzer;
