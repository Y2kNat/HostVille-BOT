'use strict';

/**
 * Fila por canal de ticket com debounce/coalescência de mensagens.
 *
 * Várias mensagens seguidas do mesmo usuário são agrupadas em um único
 * lote e processadas com uma única chamada de IA. Cancela ao assumir/fechar.
 */
class TicketQueue {
    static DEBOUNCE_MS = 1200;
    static MAX_WAIT_MS = 4000;

    /** channelId -> { itens, timer, primeiraEm, processando, processar } */
    static filas = new Map();

    static enqueue(message, session, processar) {
        if (!message || !message.channelId) return;
        const channelId = message.channelId;
        if (!this.filas.has(channelId)) {
            this.filas.set(channelId, {
                itens: [],
                timer: null,
                primeiraEm: null,
                processando: false,
                processar: processar
            });
        }
        const fila = this.filas.get(channelId);
        if (processar) fila.processar = processar;
        fila.itens.push({ message, session });
        if (!fila.primeiraEm) fila.primeiraEm = Date.now();
        this._agendar(channelId);
    }

    static _agendar(channelId) {
        const fila = this.filas.get(channelId);
        if (!fila) return;
        if (fila.timer) {
            clearTimeout(fila.timer);
            fila.timer = null;
        }
        if (fila.processando) {
            // aguarda o lote atual terminar
            fila.timer = setTimeout(() => this._agendar(channelId), 200);
            return;
        }
        const elapsed = Date.now() - (fila.primeiraEm || Date.now());
        if (elapsed >= this.MAX_WAIT_MS) {
            this._flush(channelId);
            return;
        }
        const delay = Math.min(this.DEBOUNCE_MS, this.MAX_WAIT_MS - elapsed);
        fila.timer = setTimeout(() => this._flush(channelId), delay);
    }

    static async _flush(channelId) {
        const fila = this.filas.get(channelId);
        if (!fila) return;
        if (fila.timer) {
            clearTimeout(fila.timer);
            fila.timer = null;
        }
        if (fila.processando) return;
        if (!fila.itens.length) {
            this.filas.delete(channelId);
            return;
        }
        fila.processando = true;
        const lote = fila.itens.splice(0);
        const processar = fila.processar;
        fila.primeiraEm = fila.itens.length ? Date.now() : null;

        try {
            if (typeof processar === 'function') {
                await processar(lote);
            }
        } catch (e) {
            console.error('[TicketQueue] erro no processamento:', e && e.message);
        } finally {
            fila.processando = false;
            if (fila.itens.length) {
                this._agendar(channelId);
            } else {
                // mantém a entrada para cancel futuro? remove para limpar
                // mas cancel pode ser chamado depois; keep empty fila? remove
                this.filas.delete(channelId);
            }
        }
    }

    static cancel(channelId, { removerRefs = false } = {}) {
        const fila = this.filas.get(channelId);
        if (fila) {
            if (fila.timer) {
                clearTimeout(fila.timer);
                fila.timer = null;
            }
            if (removerRefs) {
                try {
                    const QM = require('./QueueManager');
                    for (const item of fila.itens) {
                        try { QM.removeRefByMessage(item.message.id); } catch (e) {}
                    }
                } catch (e) {}
            }
            this.filas.delete(channelId);
        }
    }

    static size(channelId) {
        const fila = this.filas.get(channelId);
        return fila ? fila.itens.length : 0;
    }
}

module.exports = TicketQueue;
