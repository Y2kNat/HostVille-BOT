const fs = require('fs');
const path = require('path');

/**
 * Memória de conversa por canal, em data/chatMemory.json.
 *
 * Esta é a fonte que o Auto-KB minera para achar lacunas da KB, então ela
 * precisa sobreviver a qualquer acidente. Três defeitos do formato antigo:
 *
 *   1. save() reescrevia o arquivo inteiro a CADA mensagem (O(n) por msg);
 *   2. a escrita não era atômica — um crash no meio deixava JSON pela metade;
 *   3. load() fazia catch e devolvia {} — um arquivo corrompido apagava
 *      TODAS as memórias em silêncio, sem aviso e sem backup.
 *
 * Agora: escrita atômica (tmp + rename) com .bak, debounce, leitura com
 * fallback para o .bak e override de caminho por env (para teste).
 */
const memoryPath = process.env.CHAT_MEMORY_FILE
    || path.join(__dirname, '..', 'data', 'chatMemory.json');

const MAX_MSG_POR_CANAL = parseInt(process.env.CHAT_MEMORY_MAX_MSGS || '40', 10);
const DIAS_SEM_ATIVIDADE = parseInt(process.env.CHAT_MEMORY_DAYS || '30', 10);
const DEBOUNCE_MS = parseInt(process.env.CHAT_MEMORY_DEBOUNCE_MS || '2000', 10);

let cache = null;
let cacheMtime = null;
let sujo = false;
let timer = null;

/**
 * mtime sozinho nao identifica uma versao do arquivo.
 *
 * Medido neste filesystem (Termux/Android): duas escritas no mesmo tick
 * de mtime recebem o mtimeMs IDENTICO, e ai o cache devolvia memoria velha
 * mesmo com o arquivo ja corrompido por fora. O tamanho entra como segundo
 * criterio: duas escritas no mesmo tick quase sempre tem bytes diferentes,
 * e quando tem iguais, o conteudo e o mesmo e devolver o cache esta certo.
 */
function assinaturaAtual() {
    try {
        const st = fs.statSync(memoryPath);
        return `${st.mtimeMs}:${st.size}`;
    } catch (e) { return null; }
}

function atomicWrite(file, conteudo) {
    const tmp = file + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, conteudo);
    fs.renameSync(tmp, file);
}

class ChatMemory {

    static load() {
        // Se há escrita pendente, a memória É a verdade: reler o disco aqui
        // perderia o que o debounce ainda não gravou.
        // Sem pendência, o mtime decide: arquivo mudado por fora é relido.
        if (cache && (sujo || assinaturaAtual() === cacheMtime)) return cache;
        try {
            cache = JSON.parse(fs.readFileSync(memoryPath, 'utf8')) || {};
        } catch (e) {
            // arquivo principal ilegível: tenta o backup antes de desistir
            try {
                cache = JSON.parse(fs.readFileSync(memoryPath + '.bak', 'utf8')) || {};
                console.error('⚠️ chatMemory.json estava corrompido — recuperei do .bak');
            } catch (e2) {
                cache = {};
                if (e && e.code !== 'ENOENT') {
                    console.error('❌ chatMemory.json ilegível e sem .bak: ' + e.message);
                }
            }
        }
        cacheMtime = assinaturaAtual();
        return cache;
    }

    /** Escrita com debounce: agrupar várias mensagens em uma gravação só. */
    static save(data) {
        cache = data;
        sujo = true;
        if (timer) return;
        timer = setTimeout(() => {
            timer = null;
            ChatMemory.flush();
        }, DEBOUNCE_MS);
        if (timer.unref) timer.unref();
    }

    /** Grava agora. Chamado no shutdown para não perder o último turno. */
    static flush() {
        if (!sujo || !cache) return;
        try {
            const texto = JSON.stringify(cache, null, 2);
            // .bak primeiro: se o rename seguinte falhar, ainda há cópia boa
            try { fs.copyFileSync(memoryPath, memoryPath + '.bak'); } catch (e) {}
            atomicWrite(memoryPath, texto);
            sujo = false;
            cacheMtime = assinaturaAtual();
        } catch (e) {
            console.error('❌ Erro ao salvar chatMemory.json:', e.message);
        }
    }

    /**
     * Guarda a mensagem por CANAL (todos os usuários compartilham o contexto)
     */
    static remember(channelId, userName, message) {
        const memory = this.load();
        if (!memory[channelId]) memory[channelId] = { messages: [], lastSeen: null };
        memory[channelId].messages.push({
            user: (userName || 'alguém').substring(0, 32),
            content: String(message || '').substring(0, 200),
            timestamp: Date.now()
        });
        if (memory[channelId].messages.length > MAX_MSG_POR_CANAL) {
            memory[channelId].messages = memory[channelId].messages.slice(-MAX_MSG_POR_CANAL);
        }
        memory[channelId].lastSeen = Date.now();
        this.save(memory);
    }

    /** Canais sem conversa há muito tempo saem do arquivo (ele cresce sem parar). */
    static prune() {
        const memory = this.load();
        const limite = Date.now() - DIAS_SEM_ATIVIDADE * 24 * 60 * 60 * 1000;
        let removidos = 0;
        for (const [id, canal] of Object.entries(memory)) {
            if (!canal || !canal.lastSeen || canal.lastSeen < limite) {
                delete memory[id];
                removidos++;
            }
        }
        if (removidos) this.save(memory);
        return removidos;
    }

    /**
     * Histórico recente do canal (com autores), para dar contexto ao modelo
     */
    static getHistory(channelId, limit = 8) {
        const memory = this.load();
        const msgs = memory[channelId]?.messages || [];
        return msgs.slice(-limit).map(m => `${m.user}: ${m.content}`).join('\n');
    }

    static getPersonality(channelName) {
        const personalities = {
            'denuncia': 'SÉRIO e PROFISSIONAL. Sem gírias.',
            'suporte': 'ATENCIOSO e TÉCNICO. Gírias moderadas.',
            'duvida': 'AMIGÁVEL e DIDÁTICO. Gírias liberadas.',
            'bate-papo': 'ZOEIRO e CARISMÁTICO. Gírias pesadas.',
            'chat': 'ZOEIRO e CARISMÁTICO. Gírias pesadas.',
            'geral': 'ZOEIRO e CARISMÁTICO. Gírias pesadas.'
        };

        for (const [key, personality] of Object.entries(personalities)) {
            if (channelName.includes(key)) return personality;
        }
        return 'NATURAL e AMIGÁVEL. Gírias moderadas.';
    }
}

// Sem isto, o debounce pode segurar o último turno na memória e o processo
// sai sem gravar.
process.on('exit', () => { try { ChatMemory.flush(); } catch (e) {} });

module.exports = ChatMemory;
module.exports.memoryPath = memoryPath;
