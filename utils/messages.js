// Discord recusa message content acima de 2000 caracteres com
// content[BASE_TYPE_MAX_LENGTH]. O erro aparece como "Must be 4000 or fewer"
// porque é o teto do tipo base, mas o que estoura no message é o de 2000.
// 1900 deixa folga para o sufixo de corte.
const LIMITE_PADRAO = 1900;

/**
 * Corta o texto para caber no limite do Discord, preferindo quebrar em
 * quebra de linha para não cortar um bloco de código no meio da linha.
 * Idempotente: texto já dentro do limite passa intacto.
 * @param {string} texto
 * @param {{limite?:number, sufixo?:string}} [opts]
 * @returns {string}
 */
function safeContent(texto, { limite = LIMITE_PADRAO, sufixo = '' } = {}) {
    const t = String(texto == null ? '' : texto).trim();
    if (t.length <= limite) return t;

    const aviso = sufixo || '… *(conteúdo cortado)*';
    const espaco = limite - aviso.length - 1;
    if (espaco <= 0) return t.slice(0, limite);

    let corte = t.slice(0, espaco);
    const quebra = corte.lastIndexOf('\n');
    if (quebra > espaco * 0.5) corte = corte.slice(0, quebra);
    return corte + '\n' + aviso;
}

// Responde editando a mensagem "Pensando..." ou, se ela não existir/falhar, envia nova
async function replyOrEdit(thinking, channel, payload) {
    if (thinking) {
        try {
            return await thinking.edit(payload);
        } catch (e) {
            try { return await channel.send(payload); } catch {}
            return null;
        }
    }
    try { return await channel.send(payload); } catch (e) { return null; }
}

module.exports = { replyOrEdit, safeContent, LIMITE_PADRAO };
