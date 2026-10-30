/**
 * Regressão da Fase 0: o registro de tickets não pode ser apagado por
 * cache frio do Discord (bug que zerou o ticketChannels.json no restart).
 *
 *   node tests/registry-ticket.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = path.join(os.tmpdir(), 'ticketChannels-reg-' + process.pid + '.json');
process.env.TICKET_CHANNELS_FILE = TMP;
const RAIZ = path.join(__dirname, '..');

// Log separado do bot (ver utils/logger.js: LOG_FILE). Sem isto as linhas
// de teste caem no logs/bot-*.log junto com as do bot rodando, e o
// diagnostico fica impossivel: nao da para saber qual processo escreveu.
process.env.LOG_FILE = process.env.LOG_FILE || 'teste.log';

const ENTRADA = (id, guild) => ({
    [id]: { status: 'ativo', category: 'suporte', number: 27, guildId: guild, userId: 'u1', createdAt: 1, closedAt: null },
});
const gravar = (o) => fs.writeFileSync(TMP, JSON.stringify(o, null, 2));
const ler = () => JSON.parse(fs.readFileSync(TMP, 'utf8'));

function carregar() {
    for (const k of Object.keys(require.cache)) if (k.includes('TicketManager')) delete require.cache[k];
    return require(path.join(RAIZ, 'managers/TicketManager'));
}

/** Guild fake. `cache` simula o cache do Discord; `fetch` simula a API. */
function guildFake({ cache = new Map(), fetch }, id = 'g1') {
    return { id, name: 'Guild Teste', channels: { cache, fetch } };
}

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
    try {
        // 1) cache VAZIO não pode apagar nada (o bug original)
        await teste('cache vazio não apaga registro nenhum', async () => {
            gravar(ENTRADA('c1', 'g1'));
            const TM = carregar();
            const g = guildFake({ cache: new Map(), fetch: async () => { throw new Error('não deveria consultar a API'); } });
            await TM.restoreSessionsForGuild(g);
            assert.ok(ler()['c1'], 'o registro foi apagado com cache frio — é o bug');
        });

        // 2) canal ausente no cache, mas presente na API -> mantém
        await teste('canal fora do cache mas vivo na API é mantido', async () => {
            gravar(ENTRADA('c1', 'g1'));
            const TM = carregar();
            const g = guildFake({
                cache: new Map([['outro', {}]]),
                fetch: async () => ({ id: 'c1' }), // existe de verdade
            });
            await TM.restoreSessionsForGuild(g);
            assert.ok(ler()['c1'], 'o registro foi apagado although o canal existe');
        });

        // 3) canal realmente deletado (404) -> aí sim remove e libera o número
        await teste('canal 404 confirmado é removido', async () => {
            gravar(ENTRADA('c1', 'g1'));
            const TM = carregar();
            const g = guildFake({
                cache: new Map([['outro', {}]]),
                fetch: async () => { const e = new Error('Unknown Channel'); e.code = 10003; throw e; },
            });
            await TM.restoreSessionsForGuild(g);
            assert.strictEqual(ler()['c1'], undefined, 'canal deletado deveria sair do registro');
        });

        // 4) erro de API (sem permissão / fora) NÃO pode apagar
        await teste('erro de API desconhecido mantém o registro', async () => {
            gravar(ENTRADA('c1', 'g1'));
            const TM = carregar();
            const g = guildFake({
                cache: new Map([['outro', {}]]),
                fetch: async () => { const e = new Error('Missing Access'); e.code = 50001; throw e; },
            });
            await TM.restoreSessionsForGuild(g);
            assert.ok(ler()['c1'], 'erro de API não pode ser tratado como canal deletado');
        });

        // 5) sessão é restaurada quando o canal está no cache
        await teste('canal no cache restaura a sessão ativa', async () => {
            gravar(ENTRADA('c1', 'g1'));
            const TM = carregar();
            const ch = { id: 'c1', name: '🎫・suporte-0027' };
            const g = guildFake({ cache: new Map([['c1', ch]]), fetch: async () => ch });
            await TM.restoreSessionsForGuild(g);
            assert.ok(ler()['c1'], 'o registro deveria continuar');
        });

        // 6) restoreSessions é async de verdade (antes o await não esperava)
        await teste('restoreSessions retorna promise que resolve com a contagem', async () => {
            gravar(ENTRADA('c1', 'g1'));
            const TM = carregar();
            const ch = { id: 'c1', name: 'x' };
            const g = guildFake({ cache: new Map([['c1', ch]]), fetch: async () => ch });
            const client = { guilds: { cache: new Map([['g1', g]]) } };
            const r = TM.restoreSessions(client);
            assert.ok(r && typeof r.then === 'function', 'restoreSessions precisa ser async');
            const n = await r;
            assert.strictEqual(typeof n, 'number', 'deveria devolver a contagem');
        });
    } finally {
        try { fs.unlinkSync(TMP); } catch (e) {}
    }

    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou ? 1 : 0);
})();
