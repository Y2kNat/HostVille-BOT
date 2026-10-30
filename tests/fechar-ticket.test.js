/**
 * Testes do fechamento de ticket: motivo obrigatório e deleção imediata.
 *
 *   node tests/fechar-ticket.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

// Log separado do bot (ver utils/logger.js: LOG_FILE). Sem isto as linhas
// de teste caem no logs/bot-*.log junto com as do bot rodando, e o
// diagnostico fica impossivel: nao da para saber qual processo escreveu.
process.env.LOG_FILE = process.env.LOG_FILE || 'teste.log';
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

let passou = 0, falhou = 0;
async function teste(nome, fn) {
    try { await fn(); console.log('  ok   ' + nome); passou++; }
    catch (e) {
        console.log('  FALHA ' + nome);
        console.log('       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e));
        falhou++;
    }
}

(async () => {
    // 1) motivo vazio, em branco ou curto é recusado ANTES de qualquer trabalho
    await teste('motivo obrigatorio: vazio, branco e curto sao recusados', async () => {
        const TicketManager = require(path.join(RAIZ, 'managers/TicketManager'));
        for (const motivo of [undefined, null, '', '   ', 'ab']) {
            await assert.rejects(
                () => TicketManager.closeTicket({ id: 'x' }, { tag: 't', id: '1' }, motivo),
                /obrigat/,
                `motivo ${JSON.stringify(motivo)} deveria ser recusado`,
            );
        }
    });

    // 2) o motivo não tem mais valor padrão no código
    await teste('closeTicket nao tem mais motivo padrao', () => {
        const src = ler('managers/TicketManager.js');
        assert.ok(!/closeTicket\(channel, closer, motivo =/.test(src),
            'ainda existe um valor padrao para o motivo');
    });

    // 3) a deleção é imediata: sem setTimeout e sem os 5 segundos
    await teste('fechamento e imediato (sem setTimeout de 5s)', () => {
        const src = ler('managers/TicketManager.js');
        const inicio = src.indexOf('static async closeTicket');
        const corpo = src.slice(inicio, src.indexOf('static async claimTicket', inicio));
        assert.ok(corpo.includes('await channel.delete('), 'o canal nao e deletado com await');
        assert.ok(!/setTimeout\([^)]*5000/.test(corpo), 'ainda ha setTimeout de 5s no fechamento');
        assert.ok(!/5 segundos/.test(corpo), 'ainda ha texto de 5 segundos');
    });

    // 4) o marcador é gravado ANTES do delete (senão o channelDelete arquela 2x)
    await teste('marcador e gravado antes de deletar o canal', () => {
        const src = ler('managers/TicketManager.js');
        const inicio = src.indexOf('static async closeTicket');
        const corpo = src.slice(inicio, src.indexOf('static async claimTicket', inicio));
        const marca = corpo.indexOf('markClosedByBot');
        const deleta = corpo.indexOf('await channel.delete(');
        assert.ok(marca > 0 && deleta > 0, 'faltou marcar ou deletar');
        assert.ok(marca < deleta, 'o delete acontece antes do marker: o channelDelete arquivaria 2x');
    });

    // 5) o botão de fechar abre o modal em vez de fechar direto
    await teste('o botao de fechar abre um modal de motivo', () => {
        const src = ler('events/interactionCreate.js');
        // so o bloco do botao: ele termina onde comeca o handler do modal
        const bloco = src.slice(
            src.indexOf("customId === 'ticket_close'"),
            src.indexOf("isModalSubmit() && interaction.customId === 'ticket_close_motivo'"),
        );
        assert.ok(/showModal/.test(bloco), 'o botao nao abre modal');
        assert.ok(!/closeTicket\(/.test(bloco), 'o botao ainda fecha direto, sem pedir motivo');
        assert.ok(/ticket_close_motivo/.test(src), 'faltou o handler do modal de fechamento');
    });

    // 6) o modal tem o campo de motivo obrigatório
    await teste('o modal exige o motivo', () => {
        const src = ler('events/interactionCreate.js');
        const bloco = src.slice(src.indexOf("'ticket_close_motivo'"), src.indexOf("'ticket_close_motivo'") + 1200);
        assert.ok(/setCustomId\('motivo'\)/.test(bloco), 'faltou o campo de texto do motivo');
        assert.ok(/setRequired\(true\)/.test(bloco), 'o campo de motivo nao e obrigatorio');
    });

    // 7) o /close exige o motivo na definição do comando
    await teste('/close declara motivo obrigatorio', () => {
        const src = ler('commands/ticket/close.js');
        const bloco = src.slice(0, src.indexOf('async execute'));
        assert.ok(/setRequired\(true\)/.test(bloco), 'o motivo do /close continua opcional');
        assert.ok(!/getString\('motivo'\)\s*\|\|\s*'Sem motivo'/.test(src), 'ainda tem fallback "Sem motivo"');
    });

    // 8) todo caminho de fechamento passa um motivo real
    await teste('nenhum caminho de fechamento deixa o motivo de fora', () => {
        const chamadas = [
            ['events/interactionCreate.js', /closeTicket\([^)]*motivo\)/],
            ['commands/ticket/close.js', /closeTicket\([^)]*motivo\)/],
            ['managers/StaffLearner.js', /closeTicket\([^)]*'[^']+'\s*\)/],
        ];
        for (const [arquivo, regex] of chamadas) {
            const src = ler(arquivo);
            const achou = src.match(regex);
            assert.ok(achou, `${arquivo}: nenhuma chamada de closeTicket com motivo`);
        }
    });

    // 9) os embeds não escondem a falta de motivo
    await teste('os embeds sinalizam motivo ausente em vez de fingir', () => {
        const src = ler('managers/TicketManager.js');
        assert.ok(!/motivo \|\| 'Não informado'/.test(src), "ainda existe 'motivo || Não informado'");
        assert.ok(!/String\(motivo \|\| 'Não informado'\)/.test(src), "ainda existe fallback de Não informado");
    });

    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou ? 1 : 0);
})();
