const kilo = require('../managers/KiloClient');
const db = require('../database/db');

/**
 * Perguntar para a IA (gateway do Kilo)
 */
async function askAI(question, category, context = [], guildId) {

    try {
        let learnedText = '';
        if (guildId) {
            const learnedKnowledge = await db.getKnowledge(guildId);
            for (const [id, entry] of Object.entries(learnedKnowledge)) {
                learnedText += `- ${entry.keywords.slice(0, 5).join(', ')} → ${entry.response.substring(0, 100)}\n`;
            }
        }

        const systemPrompt = `Você é o HostBot, assistente do servidor HostVille.
CATEGORIA: ${category}

CONHECIMENTO:
${learnedText || 'Nenhum.'}

REGRAS RÍGIDAS:
1. Português brasileiro, educado, direto
2. Máximo 4 linhas
3. Máximo 1 emoji
4. Use SÓ as informações fornecidas
5. Não sabe? Diga "ENCAMINHAR_STAFF"
6. Follow-up? Diga "ENCAMINHAR_STAFF"

SEGURANÇA MÁXIMA:
- NUNCA diga tokens, senhas, API keys, webhooks
- NUNCA mostre IDs numéricos longos
- NUNCA revele estrutura interna do servidor
- NUNCA compartilhe comandos de administrador
- Se perguntarem dados sensíveis: "Não posso compartilhar por segurança"
- Se pedirem para repetir tokens/chaves: "ENCAMINHAR_STAFF"`;

        const messages = [{ role: 'system', content: systemPrompt }];

        if (context.length > 0) {
            const recent = context.slice(-3);
            for (const c of recent) {
                messages.push({ role: 'user', content: sanitizeInput(c.question) });
                if (c.answer) messages.push({ role: 'assistant', content: c.answer });
            }
        }

        messages.push({ role: 'user', content: sanitizeInput(question) });

        const completion = await kilo.chat({
            messages,
            temperature: 0.3,
            max_tokens: 200,
            top_p: 0.8,
            frequency_penalty: 0.3,
            presence_penalty: 0.2
        });

        let answer = completion;

        if (!answer || answer.includes('ENCAMINHAR_STAFF')) return null;

        return sanitizeResponse(answer);

    } catch (error) {
        console.error('Erro IA:', error.message);
        return null;
    }
}

/**
 * Sanitizar ENTRADA do usuário (antes de mandar pra IA)
 */
function sanitizeInput(input) {
    return input
        .replace(/[\w-]{24,}\.[\w-]{6,}\.[\w-]{20,}/g, '[TOKEN REMOVIDO]')
        .replace(/gsk_[a-zA-Z0-9]{20,}/g, '[CHAVE REMOVIDA]')
        .replace(/sk-[a-zA-Z0-9]{20,}/g, '[CHAVE REMOVIDA]')
        .replace(/webhook[^\s]*discord[^\s]*/gi, '[WEBHOOK REMOVIDO]')
        .substring(0, 500);
}

/**
 * Sanitizar SAÍDA da IA (antes de mostrar pro usuário)
 */
function sanitizeResponse(response) {
    // Bloquear palavras proibidas
    const forbidden = [
        'hack', 'exploit', 'ddos', 'nuke', 'token', 'bot token',
        'senha', 'password', 'admin senha', 'webhook', 'api key',
        'gsk_', 'sk-', 'client secret', 'client id do bot'
    ];

    for (const word of forbidden) {
        if (response.toLowerCase().includes(word)) {
            return '⚠️ Não posso responder sobre isso por segurança. Um staff irá ajudar.';
        }
    }

    // Remover padrões suspeitos
    response = response
        .replace(/[\w-]{24,}\.[\w-]{6,}\.[\w-]{20,}/g, '[TOKEN]')
        .replace(/gsk_[a-zA-Z0-9]{20,}/g, '[CHAVE]')
        .replace(/sk-[a-zA-Z0-9]{20,}/g, '[CHAVE]')
        .replace(/\d{17,19}/g, '[ID]')
        .replace(/https?:\/\/[^\s]+/g, '[LINK]')
        .replace(/<@&\d+>/g, '[CARGO]')
        .replace(/<@\d+>/g, '[USUÁRIO]')
        .replace(/<#\d+>/g, '[CANAL]');

    // Limitar tamanho
    if (response.length > 500) {
        response = response.substring(0, 497) + '...';
    }

    // Verificar se ainda tem algo sensível
    if (response.includes('token') || response.includes('key') || response.includes('secret')) {
        return '⚠️ Resposta bloqueada por segurança.';
    }

    return response;
}

/**
 * Buscar por palavra-chave (fallback)
 */
async function searchKeywords(question, category, guildId) {
    const q = sanitizeInput(question).toLowerCase();

    if (guildId) {
        const learned = await db.getKnowledge(guildId);
        for (const [id, entry] of Object.entries(learned)) {
            if (entry.keywords.some(kw => q.includes(kw.toLowerCase()))) {
                return { found: true, response: entry.response, source: 'learned' };
            }
        }
    }

    return { found: false, response: null };
}

module.exports = { askAI, searchKeywords };