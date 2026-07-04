// Usuários aguardando contexto (userId -> pergunta original)
const pendingContext = new Map();

class ContextMemory {

    /**
     * Salvar que o usuário precisa responder um contexto
     */
    static setPending(userId, question) {
        pendingContext.set(userId, {
            question,
            timestamp: Date.now()
        });
    }

    /**
     * Verificar se usuário tem contexto pendente
     */
    static getPending(userId) {
        const data = pendingContext.get(userId);
        if (!data) return null;

        // Expira em 2 minutos
        if (Date.now() - data.timestamp > 2 * 60 * 1000) {
            pendingContext.delete(userId);
            return null;
        }

        return data;
    }

    /**
     * Limpar pendência
     */
    static clearPending(userId) {
        pendingContext.delete(userId);
    }
}

module.exports = ContextMemory;
