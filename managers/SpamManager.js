const config = require('../config');
const { logModeration, logError } = require('../utils/logger');

/**
 * Anti-spam por volume e por conteúdo repetido.
 *
 * B21: ao detectar spam, `spamTracker.delete()` apagava TODO o histórico do
 * usuário. A próxima mensagem recomeçava do zero. Medido: 30 mensagens em
 * menos de 5 segundos passavam 25 limpas, no padrão `oooooXoooooXoooooX...`
 * — 5 de 30, 17%. O padrão é o que importa: manda 5, toma mute de 1 minuto,
 * as próximas 5 passam, e o ciclo reinicia. O filtro não impedia flood, só
 * o interrompia em janelas de 5.
 *
 * A intenção do `delete` era dar "segunda chance". O efeito foi apagar a
 * evidência da rajada em andamento — que é justamente o que o detector
 * precisa. Aqui o histórico é preservado e quem zera o contador é o mute,
 * que tem prazo próprio.
 *
 * B22: `delete()` só era chamado nos dois caminhos de `isSpam`. Um usuário
 * que mandasse 4 mensagens e saísse deixava a entrada para sempre: sem
 * `setInterval`, sem TTL, ao contrário do `RateLimiter` e do `ChatMemory`.
 * Há uma varredura abaixo.
 */
const spamTracker = new Map();

/** Tempo sem mensagem antes da entrada ser considerada abandonada. */
const TTL_MS = 10 * 60 * 1000;
/** Intervalo da varredura. Não precisa ser frequente: só evita crescimento. */
const SWEEP_MS = 5 * 60 * 1000;

// unref: a varredura não pode segurar o processo do bot aberto.
const sweepTimer = setInterval(() => SpamManager.sweep(), SWEEP_MS);
if (sweepTimer.unref) sweepTimer.unref();

class SpamManager {
    static checkSpam(message) {
        const now = Date.now();
        const userId = message.author.id;
        const userSpam = spamTracker.get(userId) || { timestamps: [], lastContent: '' };

        // IDEMPOTÊNCIA POR MENSAGEM.
        //
        // O mesmo `message` pode passar por checkSpam mais de uma vez: o
        // `execute()` do messageCreate chama o anti-spam no caminho do canal
        // de aprendizado e DEPOIS, no fim do arquivo, para quem não saiu por
        // nenhum return intermediário. Cada chamada soma no contador, então
        // a rajada contava o dobro e o mute disparava com 3 mensagens em vez
        // de 6.
        //
        // Medido antes da correção:
        //   1 chamada  -> oooooXXX    (muta na 6ª)
        //   2 chamadas -> oooooXX...  (muta na 3ª)
        //
        // A segunda opção é "mute por qualquer coisa", que foi o que aconteceu
        // em produção. A correção não é Tirar uma das chamadas — é tornar a
        // contagem honesta: a MESMA mensagem conta UMA vez, não importa
        // quantas vezes for consultada.
        if (message.id && userSpam.lastMessageId === message.id) {
            return { isSpam: userSpam.lastVerdict === true, type: userSpam.lastVerdictType };
        }

        // Janela deslizante: só conta o que está dentro de TIME_WINDOW.
        userSpam.timestamps = userSpam.timestamps.filter(t => now - t < config.SPAM.TIME_WINDOW);
        userSpam.lastSeen = now;
        userSpam.timestamps.push(now);

        let isSpam = false;
        let tipo = null;

        // Verificar spam por volume.
        // B21: NÃO apaga o histórico aqui. A rajada continua sendo contada
        // enquanto ela dura, então o mute de 1 minuto encerra o problema em
        // vez de abrir uma janela limpa atrás dele.
        if (userSpam.timestamps.length > config.SPAM.MAX_MESSAGES) {
            isSpam = true;
            tipo = 'volume';
        }

        // Verificar spam por conteúdo repetido.
        if (!isSpam && userSpam.lastContent && message.content.length > 5) {
            const similarity = message.content.toLowerCase() === userSpam.lastContent.toLowerCase() ? 1 : 0;
            if (similarity === 1) {
                isSpam = true;
                tipo = 'content';
            }
        }

        if (!isSpam) userSpam.lastContent = message.content;

        userSpam.lastMessageId = message.id || null;
        userSpam.lastVerdict = isSpam;
        userSpam.lastVerdictType = tipo;
        spamTracker.set(userId, userSpam);

        return { isSpam, type: tipo };
    }

    /**
     * B22: varre entradas abandonadas.
     *
     * Sem isto, cada usuário único que mandasse mensagens deixava uma
     * entrada permanente (~100 bytes) — vazamento lento, mas sem teto. Com
     * 50k usuários distintos ao longo de meses, são 50k entradas.
     */
    static sweep() {
        const now = Date.now();
        for (const [userId, entry] of spamTracker) {
            if (now - (entry.lastSeen || 0) > TTL_MS) spamTracker.delete(userId);
        }
    }

    /** Só para teste/diagnóstico. */
    static size() { return spamTracker.size; }

    static reset() { spamTracker.clear(); }

    static async handleSpam(message) {
        try {
            await message.delete().catch(() => {});
            await message.member.timeout(config.SPAM.MUTE_DURATION, 'Spam detectado (HostVille • BOT)');

            const spamMsg = await message.channel.send(`${message.author} foi silenciado por 1 minuto por spam.`);
            setTimeout(async () => { try { await spamMsg.delete(); } catch (e) {} }, 10000);

            logModeration('Anti-spam ativado', message.author, message.content, message.channel, 'spam');
        } catch (err) {
            logError(`Erro no anti-spam: ${err.message}`);
        }
    }
}

module.exports = SpamManager;
