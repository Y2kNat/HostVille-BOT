// Usuários aguardando contexto (userId+guildId -> pergunta original)
//
// B23: a chave era só `userId`. Guild não aparecia nem na chave nem no
// valor, e o consumidor (events/messageCreate.js) montava o prompt com o
// conhecimento do guild ATUAL:
//
//   const knowledge = await db.getKnowledge(message.guild.id);
//   const systemPrompt = `O usuário tinha perguntou: "${question}" ...
//                          ${conhecimentoTexto}`   <- guild ATUAL
//   REGRA ABSOLUTA: COPIE EXATAMENTE a resposta
//
// Ou seja: a pergunta vinha do servidor A e a resposta saía com a
// informação do servidor B. Dois servidores que dividem o bot compartilham
// o mesmo estado de conversa por 2 minutos.
//
// A correção tem duas metades, e as duas importam:
//   1. a chave passa a ser userId+guildId (isolamento de armazenamento)
//   2. o consumidor valida a origem antes de montar o prompt (isolamento de
//      uso) — mesmo com a chave correta, um getPending sem guild não pode
//      devolver pendência de outro servidor.
const pendingContext = new Map();

/** Chave composta: o mesmo usuário em dois servidores são duas pendências. */
function chaveDe(userId, guildId) {
    return `${guildId || 'sem-guild'}:${userId}`;
}

class ContextMemory {

    /**
     * Salvar que o usuário precisa responder um contexto
     * @param {string} userId
     * @param {string} question
     * @param {{guildId?: string}} [ctx]
     */
    static setPending(userId, question, ctx = {}) {
        pendingContext.set(chaveDe(userId, ctx.guildId), {
            question,
            guildId: ctx.guildId || null,
            timestamp: Date.now()
        });
    }

    /**
     * Verificar se usuário tem contexto pendente
     * @param {string} userId
     * @param {{guildId?: string}} [ctx]
     */
    static getPending(userId, ctx = {}) {
        const data = pendingContext.get(chaveDe(userId, ctx.guildId));
        if (!data) return null;

        // Expira em 2 minutos
        if (Date.now() - data.timestamp > 2 * 60 * 1000) {
            pendingContext.delete(chaveDe(userId, ctx.guildId));
            return null;
        }

        return data;
    }

    /** Limpar pendência */
    static clearPending(userId, ctx = {}) {
        pendingContext.delete(chaveDe(userId, ctx.guildId));
    }

    /**
     * Apaga toda pendência de um usuário, em qualquer guild.
     *
     * Usado quando a origem é duvidosa e não vale a pena adivinhar a guild:
     * melhor perder o contexto de conversa do que responder com o
     * conhecimento de outro servidor.
     */
    static clearPendingForUser(userId) {
        const sufixo = `:${userId}`;
        for (const k of [...pendingContext.keys()]) {
            if (k.endsWith(sufixo)) pendingContext.delete(k);
        }
    }
}

module.exports = ContextMemory;
