/**
 * Resumo do atendimento via Kilo Code (AI Gateway).
 *
 * Modelo: o do .env (TRADUCAO_MODEL ou KILO_DEFAULT_MODEL).
 * Recebe a transcricao do ticket e devolve duas frases:
 *   Problema relatado: ...
 *   Solucao aplicada: ...
 *
 * Independente do modelo principal: o resumo roda mesmo se a IA do chat
 * estiver fora do ar, e vice-versa.
 */
require('dotenv').config();

const { chat: kiloChat } = require('./kiloChat');

const BASE = (process.env.TRADUCAO_BASE_URL || process.env.KILO_BASE_URL || 'https://ai-gateway.kilo.ai/api/v1').replace(/\/+$/, '');
const MODELO = process.env.TRADUCAO_MODEL || process.env.KILO_DEFAULT_MODEL || '';

const SYSTEM = `Voce e um especialista em documentacao de suporte tecnico.

Le a transcricao de um ticket do Discord e escreva o resumo do atendimento.

Formato OBRIGATORIO, exatamente duas linhas, sem markdown e sem aspas:

Problema relatado: <uma frase identificando o que o usuario pediu ou o problema>
Solucao aplicada: <uma frase com o que a equipe fez, ou como o atendimento terminou>

Regras:
- Escreva em portugues do Brasil.
- Seja especifico: cite o comando, sistema ou arquivo envolvido quando houver.
- NAO invente informacao que nao esteja na transcricao.
- Ignore moderacao, filtro de linguagem e timestamps.
- Se nao houver solucao clara, escreva: Solucao aplicada: nao houve solucao registrada.
- Responda SOMENTE com as duas linhas.`;

const MAX_TOKENS_PADRAO = parseInt(process.env.TRADUCAO_MAX_TOKENS) || 200;
// PISO de tokens. MEDIDO no gateway: com reasoning=high o modelo queimou
// 1400-2200 tokens SÓ pensando e a resposta voltou VAZIA (finish_reason
// "length") — o resumo NUNCA saía. Com reasoning=none (o padrão aqui) a
// resposta sai em ~60 tokens; o piso cobre o formato pedido.
const MIN_TOKENS_PADRAO = parseInt(process.env.TRADUCAO_MIN_TOKENS) || 600;
// Timeout. MEDIDO: ~22-27s por chamada. Com 20s matava TODOS os resumos.
const TIMEOUT_MS_PADRAO = parseInt(process.env.TRADUCAO_TIMEOUT_MS) || 60000;
// Esforço de raciocínio do RESUMO. 'none' é o padrão DE PROPÓSITO: resumir
// uma transcrição é extração, não raciocínio. Com 'high' o modelo queima
// 1500-2200 tokens pensando e o orçamento acaba antes da resposta.
const REASONING_PADRAO = process.env.TRADUCAO_REASONING_EFFORT || 'none';

/**
 * Extrai as duas frases da resposta, venha como vier.
 *
 * O "Solução" do modelo pode vir sem acento ("Solucao") ou com ("Solução").
 * O ACENTO fica no C (ç), não no final — por isso o padrão precisa ser
 * `solu[cç][aã]o` e não `soluc[aã]o`: com o padrão errado, o modelo
 * escrevia "Solução aplicada:" e a linha NUNCA era extraída, o resumo
 * saía vazio e o ticket ficava sem resumo de IA.
 */
function parse(texto) {
    const t = String(texto || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    // O RÓTULO pode vir entre aspas: '"Solução aplicada: ..."'. O `["']?`
    // antes do rótulo existe por isso — sem ele, a aspa quebrava a
    // lookahead e o texto INTEIRO caía dentro do campo anterior.
    const p = t.match(/problema\s+relatado\s*:\s*([\s\S]*?)(?=\n["']?solu[cç][aã]o\s+aplicada\s*:|$)/i);
    const s = t.match(/solu[cç][aã]o\s+aplicada\s*:\s*([\s\S]*?)(?=\n["']?problema\s+relatado\s*:|$)/i);
    if (!p && !s) return null;
    return {
        problema: (p ? p[1] : '').trim().replace(/^["'`*_]+|["'`*_]+$/g, ''),
        solucao: (s ? s[1] : '').trim().replace(/^["'`*_]+|["'`*_]+$/g, ''),
    };
}

class ResumoIA {
    /** Chave: usa a do modenario e cai na principal. */
    static get apiKey() {
        return process.env.TRADUCAO_API_KEY || process.env.KILO_API_KEY || '';
    }

    static get enabled() {
        return !!this.apiKey && !!MODELO && process.env.TRADUCAO_IA !== 'false';
    }

    /**
     * @param {string} transcricao  texto ja formatado da conversa
     * @param {object} opts { temperatura, maxTokens, timeoutMs }
     * @returns {Promise<{problema,solucao}|null>}
     */
    static async gerar(transcricao, opts = {}) {
        if (!this.enabled) return null;
        if (!transcricao || !transcricao.trim()) return null;

        const {
            temperatura = 0.2,
            maxTokens = MAX_TOKENS_PADRAO,
            timeoutMs = TIMEOUT_MS_PADRAO,
        } = opts;

        // PISO: o que o chamador pede é o que o modelo DEVE escrever, mas o
        // modelo de raciocínio gasta tokens antes disso. Sem o piso, o
        // orçamento inteiro vira raciocínio e a resposta volta vazia.
        const teto = Math.max(MIN_TOKENS_PADRAO, maxTokens);

        try {
            const r = await kiloChat({
                model: MODELO,
                messages: [
                    { role: 'system', content: SYSTEM },
                    { role: 'user', content: `TRANSCRICAO DO TICKET:\n\n${transcricao}` },
                ],
                temperature: temperatura,
                max_tokens: teto,
                reasoning_effort: REASONING_PADRAO,
                timeoutMs,
                baseUrl: BASE,
            });

            const bruto = r.content || '';
            const out = parse(bruto);
            if (!out || (!out.problema && !out.solucao)) return null;
            return {
                problema: out.problema || 'Não registrado na transcrição',
                solucao: out.solucao || 'Não registrado na transcrição',
            };
        } catch (e) {
            // Falha = sem resumo de IA. O chamador cai no resumo heurístico.
            console.warn(`[Resumo] falhou (${e.message}) — sem resumo de IA`);
            return null;
        }
    }
}

module.exports = { ResumoIA, parse, get MODELO() { return MODELO; }, SYSTEM };
