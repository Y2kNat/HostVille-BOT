/**
 * Bypass de filtro de palavra para mensagem que é SÓ uma URL.
 *
 * POR QUE EXISTE
 * O tokenizador quebra a URL e produz tokens do SLUG. Um GIF de reação
 * com o insulto no endereço gera o token exato e toma warn de quem só
 * mandou uma reação. Log real de 30/09:
 *
 *   https://klipy.com/gifs/eita-cuzao -> "cuzao" [conf=0.916] -> warn
 *
 * O conteúdo visual de um link externo nunca foi moderável de qualquer
 * forma: o filtro só lê texto. Pegar a palavra no slug é pegar o nome do
 * arquivo, não o que a pessoa disse.
 *
 * DECISÃO DO DONO: bypass, só para URL isolada.
 *
 * O que este bypass NÃO faz:
 *   - não desliga o anti-invite: `https://discord.gg/abc` continua barrado
 *     pelo LinkManager, porque o bypass é do filtro de PALAVRA e o
 *     anti-invite é do filtro de LINK. São controles separados.
 *   - não vale com texto junto: "viada https://..." continua moderado,
 *     porque aí a pessoa escreveu o insulto.
 *
 * Onde é aplicado: events/messageCreate.js, ANTES de chamar
 * FilterManager.decide. Corta o caso antes de ele chegar ao motor.
 */

/** Mesma regex de URL que o LinkManager usa, para não divergir. */
const URL_RE = /(https?:\/\/[^\s]+)/gi;

/**
 * A mensagem é só uma URL?
 *
 * @param {string} texto  conteúdo bruto da mensagem
 * @returns {boolean}
 *
 * Regra: tem ao menos uma URL, e removendo as URLs sobra apenas
 * pontuação/espaço. "kkk https://x.com/a kkk" NÃO é só URL — o resto tem
 * letra, e letra é exatamente o que o filtro deveria estar lendo.
 */
function isSoUrl(texto) {
    const t = String(texto || '');
    if (!t.trim()) return false;

    URL_RE.lastIndex = 0;
    if (!URL_RE.test(t)) return false;

    // Remove as URLs e sobra só o que era dado em volta.
    const resto = t.replace(/https?:\/\/\S+/g, '').replace(/[\s.,!?*_~^\-—…"'`]/g, '');

    return resto.length === 0;
}

module.exports = { isSoUrl };
