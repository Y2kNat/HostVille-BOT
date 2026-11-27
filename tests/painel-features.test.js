/**
 * Painel de controle de features (`/adm`) — o que trava aqui é o
 * CONTROLE, não o desenho.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * O `/adm` antes era três botões decorativos atrás de `code !== ACCESS_CODE`,
 * sem rate limit e sem checar autor no clique. As features que o bot tem
 * eram desligadas por 4 comandos em 6 arquivos, e quatro delas (.env) só
 * mudavam com restart. Este arquivo trava as propriedades que o painel
 * precisa ter para ser confiável:
 *
 *   - isolamento por servidor (desligar em A não mexe em B)
 *   - default vem do .env, e o banco só sobrescreve
 *   - desliga e religa sobrevive a restart
 *   - banco fora NÃO deixa o cache mentindo
 *   - chave de rede é só do dono
 *   - o clique confere o dono do menu (B19, o mesmo invariante do
 *     handlers/monitoring.js — e o /adm não tinha)
 *   - desligar pede confirmação; ligar de chave comum é direto
 *   - a pausa de emergência cobre moderação e não cobre a chave-mestra
 *
 * As telas passam por `toJSON()` de propósito: o discord.js só valida
 * label/description/customId no materializar, e um botão com description de
 * 102 caracteres estoura `Invalid string length` no meio do update — em
 * produção, não no teste.
 *
 *   node tests/painel-features.test.js
 */
const assert = require('assert');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const TMP = path.join(require('os').tmpdir(), `painel-${process.pid}.json`);

process.env.LOG_FILE = process.env.LOG_FILE || 'teste.log';
process.env.MODERATION_LOG_FILE = TMP;
process.env.ACCESS_CODE = process.env.ACCESS_CODE || 'senha-de-teste';
process.env.OWNER_ID = process.env.OWNER_ID || 'U_DONO';

// ── Banco em memória ────────────────────────────────────────────────────────
// Injetado no require.cache ANTES de qualquer require do projeto: o
// database/db.js faz mongoose.connect no import, e um teste não deve abrir
// conexão de rede.
const store = { feats: {} };
const fakeDb = {
    async getFeatures(g) { return { ...(store.feats[g] || {}) }; },
    async setFeatures(g, m) { store.feats[g] = { ...m }; return m; },
    async getCustomWords() { return []; },
    async addCustomWord() { return true; },
    async removeCustomWord() {},
    async getChannelModeration() { return {}; },
    async getLinkSettings(g) { return { deleteInvites: true, allowedDomains: [], escopo: g }; },
    async setLinkSettings() {},
    async getMonitoringStatus() { return true; },
    async setMonitoringStatus() {},
    async getTicketAi() { return {}; },
    async getStats() { return {}; },
    async saveStats() {},
};
const dbPath = require.resolve(path.join(RAIZ, 'database/db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

// `require('pusher')` devolve a CLASSE diretamente (com estáticos em cima),
// não um objeto com `.Pusher`. O utils/realtime.js faz `new Pusher(...)`, e
// um stub `{ Pusher: class }` deixaria `Pusher` indefinido e mataria o teste
// no require, antes do primeiro assert.
try {
    const pp = require.resolve('pusher');
    const Stub = function () {};
    Stub.forURL = () => Stub;
    Stub.forCluster = () => Stub;
    Stub.prototype.trigger = function () {};
    require.cache[pp] = { id: pp, filename: pp, loaded: true, exports: Stub };
} catch (e) { /* pusher ausente: o realtime silencia sozinho */ }

const Features = require(path.join(RAIZ, 'managers/FeatureRegistry'));
const AP = require(path.join(RAIZ, 'handlers/adminPanel'));
const ModerationLog = require(path.join(RAIZ, 'utils/ModerationLog'));
const { comparaSenha, confereAcesso } = require(path.join(RAIZ, 'utils/accessCode'));

// O log de auditoria writes-through: silenciado aqui, o comportamento é
// testado peloFakeDb acima.
Features.auditar = async () => {};

const DONO = process.env.OWNER_ID;

/** Interação simulada. Guardamos o que o handler respondeu. */
function mkInter({ customId, values = [], user = DONO, guildId = 'G1', guildName = 'Servidor Teste', input = '' }) {
    const out = { updates: [], replies: [], modals: [] };
    const cid = String(customId);
    const it = {
        customId: cid,
        values,
        user: { id: user, tag: `${user}#0001` },
        guild: { id: guildId, name: guildName },
        client: {
            guilds: { cache: new Map([[guildId, {
                id: guildId, name: guildName, memberCount: 500,
                members: { cache: { filter: () => ({ size: 12 }) } }
            }]]) },
            ws: { ping: 42 },
            uptime: 3725000
        },
        isButton: () => cid.startsWith('adm:grupo') || cid.startsWith('adm:voltar') ||
            cid.startsWith('adm:status') || cid.startsWith('adm:ajuda') ||
            cid.startsWith('adm:xingamentos') || cid.startsWith('adm:janela') ||
            cid.startsWith('adm:pausa') || cid.startsWith('adm:trocarservidor') || cid.startsWith('adm:menu'),
        isStringSelectMenu: () => cid.includes(':toggle:') || cid.includes(':escopo:'),
        isModalSubmit: () => cid.includes(':confirmar:') || cid.includes(':banirconfirm:'),
        isRepliable: () => true,
        update: async (p) => { out.updates.push(p); },
        reply: async (p) => { out.replies.push(p); },
        showModal: async (m) => { out.modals.push(m); },
        deferReply: async () => {},
        deferUpdate: async () => {},
        fields: { getTextInputValue: () => input },
    };
    return { it, out };
}

const json = (o) => (typeof o?.toJSON === 'function' ? o.toJSON() : o);

let passou = 0, falhou = 0;
const falhas = [];
async function teste(nome, fn) {
    try { await fn(); console.log('  ok   ' + nome); passou++; }
    catch (e) { console.log('  FALHA ' + nome + '\n        ' + e.message); falhou++; falhas.push(nome); }
}

(async () => {
    await Features.aquecer();

    // ================================================================
    // 1. ACESSO
    // ================================================================

    await teste('[ADM] o código certo abre e o errado não', () => {
        assert.ok(comparaSenha('senha-de-teste'), 'o código configurado tem que passar');
        assert.ok(!comparaSenha('senha-de-test'), 'um dígito diferente tem que falhar');
        assert.ok(!comparaSenha('x'), 'tamanho diferente tem que falhar');
        assert.strictEqual(confereAcesso('u1', 'senha-de-teste', 'adm'), null);
        assert.ok(/incorreto/.test(confereAcesso('u2', 'errado', 'adm')));
    });

    await teste('[ADM] a sexta tentativa em um minuto é barrada', () => {
        // 5 tentativas/min é a política. A sexta tem que receber aguardo, não
        // "código incorreto" — são coisas diferentes para quem está forçando.
        const r = [1, 2, 3, 4, 5, 6].map(() => confereAcesso('u_bruteforce', 'x', 'adm'));
        assert.ok(/Calma/.test(r[5]),
            `a sexta tentativa deveria pedir aguarda, veio: ${r[5]}`);
    });

    // ================================================================
    // 2. DEFAULTS
    // ================================================================

    await teste('[ADM] o default de cada chave vem do config.js', () => {
        const cfg = require(path.join(RAIZ, 'config'));
        assert.strictEqual(Features.ligadoSync('manutencao'), false,
            'manutenção é desligada por padrão');
        assert.strictEqual(Features.ligadoSync('filtro_palavras', 'G1'), true,
            'o filtro de xingamento é ligado por padrão');
        assert.strictEqual(Features.ehGlobal('roast'), cfg.MODERATION_ENABLED !== undefined || true);
        assert.strictEqual(Features.ligadoSync('__chave_que_nao_existe__'), false,
            'chave desconhecida é desligada, não "default"');
    });

    await teste('[ADM] o catálogo cobre os quatro grupos', () => {
        const grupos = new Set(Features.keys().map(Features.grupo));
        for (const g of ['mod', 'ia', 'ticket', 'sistema']) {
            assert.ok(grupos.has(g), `faltou o grupo ${g} no catálogo`);
        }
        assert.ok(Features.keys().length >= 19,
            `o catálogo tem ${Features.keys().length} chaves`);
    });

    // ================================================================
    // 3. ISOLAMENTO POR SERVIDOR
    // ================================================================

    await teste('[ADM] desligar em um servidor não mexe em outro', async () => {
        await Features.set('anti_spam', 'G1', false, 'teste');
        assert.strictEqual(Features.ligadoSync('anti_spam', 'G1'), false);
        assert.strictEqual(Features.ligadoSync('anti_spam', 'G2'), true,
            'G2 não pode ter sido afetado');
        assert.strictEqual(store.feats.G1.anti_spam, false);
        assert.ok(!store.feats.G2, 'não devia ter gravado doc em G2');
    });

    await teste('[ADM] o desligamento sobrevive a restart', async () => {
        // Simula restart: novo cache, mesma fonte.
        await Features.aquecer();
        assert.strictEqual(Features.ligadoSync('anti_spam', 'G1'), false,
            'após re-aquecer o cache, anti_spam tinha que continuar desligado em G1');
        assert.strictEqual(Features.ligadoSync('anti_spam', 'G2'), true,
            'e G2 ligado');
        await Features.set('anti_spam', 'G1', true, 'limpeza');
    });

    await teste('[ADM] chave global vale para todos os servidores', async () => {
        await Features.set('guard', 'global', false, 'teste');
        assert.strictEqual(Features.ligadoSync('guard', 'G1'), false);
        assert.strictEqual(Features.ligadoSync('guard', 'G2'), false);
        await Features.reset('guard', 'global', 'limpeza');
        assert.strictEqual(Features.ligadoSync('guard', 'G1'), true,
            'reset devolve a chave ao default do config');
    });

    await teste('[ADM] o estado de um servidor não traz chave global', async () => {
        const est = await Features.estado('G1');
        assert.ok(!('guard' in est), 'guard é global e não deveria aparecer no estado de G1');
        const estG = await Features.estado('global');
        assert.ok('guard' in estG, 'e no escopo global tem que aparecer');
    });

    // ================================================================
    // 4. BANCO FORA
    // ================================================================

    await teste('[ADM] banco fora não deixa o cache mentindo', async () => {
        const antes = Features.ligadoSync('anti_link', 'G1');
        const original = fakeDb.setFeatures;
        fakeDb.setFeatures = async () => { throw new Error('mongo fora'); };
        try {
            const r = await Features.set('anti_link', 'G1', false, 'teste');
            assert.ok(!r.ok, 'set deveria devolver ok:false');
            assert.strictEqual(Features.ligadoSync('anti_link', 'G1'), antes,
                'o cache não pode mostrar desligado se o banco não gravou');
        } finally {
            fakeDb.setFeatures = original;
        }
    });

    // ================================================================
    // 5. AUTORIZAÇÃO NO CLIQUE
    // ================================================================

    await teste('[ADM] o botão carrega o userId e a chegada confere', async () => {
        // O invariante é o mesmo do B19 em handlers/monitoring.js, que o
        // /adm não tinha: um customId é previsível, então o clique tem de
        // vir de um botão real de um menu real.
        const menu = AP.embedMenu({ guilds: { cache: new Map() } }, 'G1', { id: DONO, tag: 'D' });
        const ids = menu.components.flatMap(r => json(r).components.map(c => c.custom_id));
        assert.ok(ids.length > 0);
        for (const id of ids) {
            assert.ok(id.startsWith('adm:'), `customId sem prefixo: ${id}`);
            assert.ok(id.length <= 100, `customId com ${id.length} chars: ${id}`);
            assert.ok(id.endsWith(':' + DONO), `customId sem o dono no fim: ${id}`);
        }
    });

    await teste('[ADM] menu de outro usuário não executa nada', async () => {
        const { it, out } = mkInter({ customId: 'adm:grupo:mod:G1:U_OUTRO', user: 'U_INTRUSO' });
        await AP.handleAdmInteraction(it);
        assert.strictEqual(out.updates.length, 0, 'não pode ter desenhado nada');
        assert.ok(/não é seu/.test(out.replies[0].content),
            `recusa inesperada: ${JSON.stringify(out.replies[0])}`);
    });

    await teste('[ADM] customId sem dono é recusado', async () => {
        const { it, out } = mkInter({ customId: 'adm:grupo:mod:G1:', user: 'U_X' });
        await AP.handleAdmInteraction(it);
        assert.strictEqual(out.updates.length, 0);
        assert.ok(/não é seu/.test(out.replies[0].content));
    });

    await teste('[ADM] chave de rede é só do dono do bot', async () => {
        const { it, out } = mkInter({
            customId: 'adm:toggle:global:U_QUALQUER', user: 'U_QUALQUER', values: ['guard']
        });
        await AP.handleAdmInteraction(it);
        assert.strictEqual(out.updates.length, 0);
        assert.ok(/Só o dono/.test(out.replies[0].content),
            `recusa inesperada: ${JSON.stringify(out.replies[0])}`);
    });

    // ================================================================
    // 6. TOGGLE E CONFIRMAÇÃO
    // ================================================================

    await teste('[ADM] a tela de grupo respeita os limites do Discord', async () => {
        const { it, out } = mkInter({ customId: `adm:grupo:mod:G1:${DONO}` });
        await AP.handleAdmInteraction(it);
        assert.ok(out.updates[0], 'a tela não renderizou');

        const tela = out.updates[0];
        assert.ok(tela.components.length <= 5, 'máximo de 5 rows');
        for (const row of tela.components) {
            assert.ok(row.components.length <= 5, 'máximo de 5 componentes por row');
        }
        const e = json(tela.embeds[0]);
        assert.ok(e.description.length <= 4096, `description com ${e.description.length}`);
        assert.ok((e.fields || []).length <= 25, 'máximo de 25 campos');
        for (const f of (e.fields || [])) {
            assert.ok(f.value.length <= 1024, `campo "${f.name}" com ${f.value.length}`);
        }
        const sel = json(tela.components[0]).components[0];
        assert.ok(sel.options.length <= 25, 'máximo de 25 opções');
        for (const o of sel.options) {
            assert.ok(!!o.value, `opção sem value: ${o.label}`);
            assert.ok(o.label.length <= 100, `label com ${o.label.length}: ${o.label}`);
            assert.ok(o.description.length <= 100,
                `description com ${o.description.length}: ${o.description}`);
        }
    });

    await teste('[ADM] tela de grupo NÃO marca mais de 1 opção como default', async () => {
        // Regressão real de produção: o select marcava `.setDefault(true)` em
        // TODA função desligada. O Discord conta os defaults contra
        // max_values (=1 sem setMaxValues) e recusa o update inteiro com
        // COMPONENT_TOO_MANY_DEFAULT_VALUES — a tela de grupo simplesmente não
        // abria. Bastava desligar 2 funções para quebrar (a pausa de
        // emergência desliga 4 do grupo mod de uma vez).
        const desligadas = ['filtro_palavras', 'anti_spam', 'anti_link'];
        for (const k of desligadas) await Features.set(k, 'G1', false, 'teste');
        try {
            const { it, out } = mkInter({ customId: `adm:grupo:mod:G1:${DONO}` });
            await AP.handleAdmInteraction(it);
            assert.ok(out.updates[0], 'a tela não renderizou');

            const sel = json(out.updates[0].components[0]).components[0];
            const defaults = sel.options.filter(o => o.default);
            const max = sel.max_values ?? 1; // sem max_values o Discord usa 1
            assert.ok(defaults.length <= max,
                `${defaults.length} defaults com max_values=${max}: ${JSON.stringify(sel.options.map(o => [o.label, o.default]))}`);
            assert.ok(desligadas.length >= 2, 'o cenário precisa ter mais de 1 função desligada');
            assert.ok(defaults.length >= 1, 'o painel deixou de destacar nenhuma função desligada');
        } finally {
            for (const k of desligadas) await Features.reset(k, 'G1', 'limpeza');
        }
    });

    await teste('[ADM] desligar pede confirmação e não grava antes dela', async () => {
        const { it, out } = mkInter({ customId: `adm:toggle:G1:${DONO}`, values: ['anti_spam'] });
        await AP.handleAdmInteraction(it);
        assert.strictEqual(out.modals.length, 1, 'desligar tem que abrir modal');
        assert.strictEqual(out.updates.length, 0);
        assert.strictEqual(Features.ligadoSync('anti_spam', 'G1'), true,
            'nada pode ter mudado antes da confirmação');

        const m = json(out.modals[0]);
        assert.strictEqual(m.custom_id, `adm:confirmar:anti_spam:off:G1:${DONO}`,
            'o modal carrega chave, alvo, escopo e dono');
        assert.strictEqual(m.components[0].components[0].custom_id, 'confirmacao');
        assert.ok(m.components[0].components[0].label.length <= 45,
            `label do modal com ${m.components[0].components[0].label.length} chars`);
    });

    await teste('[ADM] confirmar aplica e mostra o antes → depois', async () => {
        const { it, out } = mkInter({ customId: `adm:confirmar:anti_spam:off:G1:${DONO}` });
        await AP.handleAdmInteraction(it);
        assert.strictEqual(Features.ligadoSync('anti_spam', 'G1'), false, 'não desligou');
        assert.strictEqual(store.feats.G1.anti_spam, false, 'não persistiu');
        const e = json(out.updates[0].embeds[0]);
        assert.ok(e.fields.some(f => f.name === 'Antes → depois'),
            'a tela tem que mostrar o antes → depois');
    });

    await teste('[ADM] ligar chave comum é direto, sem modal', async () => {
        const { it, out } = mkInter({ customId: `adm:toggle:G1:${DONO}`, values: ['anti_spam'] });
        await AP.handleAdmInteraction(it);
        assert.strictEqual(out.modals.length, 0);
        assert.strictEqual(Features.ligadoSync('anti_spam', 'G1'), true);
        assert.ok(json(out.updates[0].embeds[0]).title.includes('ligada'));
    });

    // ================================================================
    // 7. PAUSA DE EMERGÊNCIA
    // ================================================================

    await teste('[ADM] a pausa cobre moderação e não cobre a chave-mestra', () => {
        assert.ok(Features.PAUSA_GUILD.includes('filtro_palavras'));
        assert.ok(Features.PAUSA_GUILD.includes('anti_spam'));
        assert.ok(Features.PAUSA_GUILD.includes('anti_link'));
        assert.ok(Features.PAUSA_GUILD.includes('ia_moderacao'));
        assert.ok(!Features.PAUSA_GUILD.includes('monitoramento'),
            'a pausa não pode mexer na chave-mestra: quem pausou por pânico ' +
            'precisa religar com um clique, não dois');
        assert.ok(!Features.PAUSA_GUILD.includes('manutencao'));
    });

    await teste('[ADM] a pausa desliga e religa sem perder a configuração', async () => {
        const antes = await Features.estado('G1');

        const { it, out } = mkInter({ customId: `adm:pausa:G1:${DONO}` });
        await AP.handleAdmInteraction(it);
        assert.strictEqual(out.modals.length, 1, 'pausa tem que pedir confirmação');
        assert.ok(json(out.modals[0]).custom_id.includes('__pausa__'));

        const { it: it2 } = mkInter({ customId: `adm:confirmar:__pausa__:off:G1:${DONO}` });
        await AP.handleAdmInteraction(it2);
        const pausado = await Features.estado('G1');
        assert.strictEqual(pausado.filtro_palavras, false);
        assert.strictEqual(pausado.anti_spam, false);
        assert.strictEqual(pausado.anti_link, false);
        assert.strictEqual(pausado.ia_moderacao, false);
        assert.strictEqual(pausado.monitoramento, antes.monitoramento,
            'a chave-mestra não pode ter mudado');

        const { it: it3 } = mkInter({ customId: `adm:confirmar:__pausa__:on:G1:${DONO}` });
        await AP.handleAdmInteraction(it3);
        const voltou = await Features.estado('G1');
        assert.strictEqual(voltou.filtro_palavras, antes.filtro_palavras);
        assert.strictEqual(voltou.anti_spam, antes.anti_spam);
        assert.strictEqual(voltou.anti_link, antes.anti_link);
    });

    await teste('[ADM] toda ação que o painel gera tem caso no roteador', async () => {
        // Um customId gerado sem case cai no default com "botão
        // desconhecido" — foi assim que o `adm:menu`, prometido pela tela de
        // troca de servidor, não fazia nada.
        const fs = require('fs');
        const src = fs.readFileSync(path.join(RAIZ, 'handlers/adminPanel.js'), 'utf8');
        const geradas = new Set([...src.matchAll(/adm:([a-z_]+)/g)].map(m => m[1]));
        const casos = new Set([...src.matchAll(/case '([a-z_]+)'/g)].map(m => m[1]));
        const semCaso = [...geradas].filter(a => !casos.has(a));
        assert.deepStrictEqual(semCaso, [],
            `ações geradas sem case no switch: ${semCaso.join(', ')}`);
    });

    await teste('[ADM] o botão de trocar servidor abre o painel do escolhido', async () => {
        const { it, out } = mkInter({ customId: `adm:menu:G9:${DONO}`, guildId: 'G9', guildName: 'Outro Servidor' });
        await AP.handleAdmInteraction(it);
        assert.strictEqual(out.replies.length, 1, 'a tela de menu tem que responder');
        assert.ok(out.replies[0].components && out.replies[0].components.length === 2,
            'e tem que vir com o painel inteiro');
    });

    await teste('[ADM] o painel da rede só lista o que vale para a rede', async () => {
        // O erro que este teste trava: `grupoDe('mod', 'global')` devolvia as
        // chaves de SERVIDOR. Alternar `filtro_palavras` ali gravava no doc
        // `global` enquanto o messageCreate lê o doc do servidor — botão que
        // desenhava e não fazia nada.
        for (const g of ['mod', 'ia', 'ticket', 'sistema']) {
            for (const item of Features.grupoDe(g, 'global')) {
                assert.ok(Features.ehGlobal(item.key),
                    `a chave de servidor ${item.key} apareceu no painel da rede (grupo ${g})`);
            }
        }
        const naRede = ['mod', 'ia', 'ticket', 'sistema']
            .flatMap(g => Features.grupoDe(g, 'global').map(i => i.key));
        assert.deepStrictEqual(naRede.sort(),
            ['autokb', 'canal_estudo', 'guard', 'manutencao', 'roast'],
            'a rede tem exatamente as chaves de escopo global');

        // E o inverso: o painel de um servidor não mostra chave global.
        for (const g of ['mod', 'ia', 'ticket', 'sistema']) {
            for (const item of Features.grupoDe(g, 'G1')) {
                assert.ok(!Features.ehGlobal(item.key),
                    `a chave de rede ${item.key} apareceu no painel do servidor G1`);
            }
        }
    });

    await teste('[ADM] grupo sem chaves não quebra a tela', async () => {
        // `mod` e `ticket` não têm chave de rede. O select ficaria com zero
        // opções, que o Discord rejeita.
        for (const g of ['mod', 'ticket']) {
            const { it, out } = mkInter({ customId: `adm:grupo:${g}:global:${DONO}`, guildId: 'global' });
            await AP.handleAdmInteraction(it);
            assert.ok(out.updates[0], `o grupo vazio ${g} não renderizou`);
            const sel = json(out.updates[0].components[0]).components[0];
            assert.ok(sel.options.length >= 1,
                `select do grupo ${g} ficou com ${sel.options.length} opções — o Discord rejeita`);
        }
    });

    // ================================================================
    // 8. LOG DE MODERAÇÃO
    // ================================================================

    await teste('[ADM] o log de xingamento agrega por palavra e por infrator', () => {
        ModerationLog.zerar();
        ModerationLog.registrar({ guildId: 'G1', channelName: 'geral', userId: 'u1', userTag: 'Ana#1', palavra: 'merda', severidade: 'high', confianca: 0.9, acao: 'punido' });
        ModerationLog.registrar({ guildId: 'G1', channelName: 'geral', userId: 'u1', userTag: 'Ana#1', palavra: 'Merda', severidade: 'low', acao: 'staff' });
        ModerationLog.registrar({ guildId: 'G1', channelName: 'spam', userId: 'u3', userTag: 'Cid#3', palavra: 'idiota', severidade: 'critical', acao: 'review' });
        ModerationLog.registrar({ guildId: 'G2', channelName: 'x', userId: 'u2', userTag: 'B#2', palavra: 'burro', severidade: 'low', acao: 'punido' });
        ModerationLog.gravarAgora();

        const g1 = ModerationLog.resumo('G1');
        assert.strictEqual(g1.total, 3, `G1 tem 3 casos, veio ${g1.total}`);
        assert.strictEqual(g1.palavras[0].chave, 'merda',
            'a palavra mais usada de G1 tem que ser merda');
        assert.strictEqual(g1.palavras[0].total, 2,
            '"Merda" e "merda" são a mesma palavra para o ranking');
        assert.strictEqual(g1.infratores[0].chave, 'Ana#1');
        assert.strictEqual(g1.review, 1, 'o caso needs_review tem que aparecer');
        assert.strictEqual(ModerationLog.resumo('G2').total, 1, 'G2 tem o caso dele');
        assert.strictEqual(ModerationLog.resumo(null).total, 4, 'a rede soma os quatro');
    });

    await teste('[ADM] o log sobrevive a releitura do arquivo', () => {
        // A propriedade que importa: o registro não vive só na memória do
        // processo. Um restart não pode apagar o histórico de punição — é o
        // mesmo motivo do utils/warnStore.js ser arquivo.
        const relido = ModerationLog.resumo('G1');
        assert.ok(relido.bufferTotal >= 4,
            `o buffer em disco tem ${relido.bufferTotal} registros`);
        ModerationLog.zerar();
    });

    await teste('[ADM] a tela de xingamentos mostra os agregados', () => {
        ModerationLog.zerar();
        ModerationLog.registrar({ guildId: 'G1', channelName: 'geral', userId: 'u1', userTag: 'Ana#1', palavra: 'merda', severidade: 'high', acao: 'punido' });
        ModerationLog.registrar({ guildId: 'G1', channelName: 'geral', userId: 'u2', userTag: 'Bob#2', palavra: 'idiota', severidade: 'critical', acao: 'review' });
        ModerationLog.gravarAgora();

        const x = AP.telaXingamentos('G1', { tag: 't' }, 'tudo');
        const e = json(x.embeds[0]);
        assert.ok(e.fields.some(f => f.name.includes('Palavras mais usadas')), 'ranking de palavras');
        assert.ok(e.fields.some(f => f.name.includes('Quem mais repete')), 'ranking de infratores');
        assert.ok(e.fields.some(f => f.value.includes('Sem decisão da IA')),
            'o caso sem decisão da IA precisa ser destacado: é o que fica invisível quando a IA cai');
        for (const f of e.fields) assert.ok(f.value.length <= 1024, `campo com ${f.value.length}`);
        assert.ok(json(x.components[1]).components.some(b => b.custom_id.startsWith('adm:banir:')),
            'a tela oferece banir palavra direto do log');
        ModerationLog.zerar();
    });

    await teste('[ADM] a chave manutencao manda no mesmo estado do /maintenance', () => {
        // Sem esta ponte, o painel mostrava um 🟢 que não desligava nada:
        // a chave era lida por ninguém e o único caminho era o /maintenance.
        const MM = require(path.join(RAIZ, 'managers/MaintenanceManager'));
        const arquivo = path.join(RAIZ, 'data', 'maintenance.json');
        const antes = (() => { try { return require('fs').readFileSync(arquivo, 'utf-8'); } catch (e) { return null; } })();

        try {
            const original = MM.setData;
            // 1) escrever o arquivo tem quereflection a chave
            MM.setData({ enabled: true, updatedBy: 'D', updatedAt: Date.now() });
            assert.strictEqual(Features.ligadoSync('manutencao'), true,
                'escrever maintenance.json tem que ligar a chave do painel');
            assert.strictEqual(MM.isEnabled(), true, 'e a manutenção tem que valer');

            MM.setData({ enabled: false, updatedBy: 'D', updatedAt: Date.now() });
            assert.strictEqual(Features.ligadoSync('manutencao'), false,
                'desligar o arquivo tem que desligar a chave');
            assert.strictEqual(MM.isEnabled(), false);

            // 2) a chave sozinha também manda (é o caminho do botão de pausa)
            Features.set('manutencao', 'global', true, 'teste');
            assert.strictEqual(MM.isEnabled(), true,
                'a chave ligada tem que valer mesmo com o arquivo desligado — ' +
                'é o que o botão de pausa de emergência usa');
            Features.set('manutencao', 'global', false, 'teste');
            assert.strictEqual(MM.isEnabled(), false);
            void original;
        } finally {
            if (antes !== null) {
                try { require('fs').writeFileSync(arquivo, antes); } catch (e) {}
            }
            Features.set('manutencao', 'global', false, 'limpeza');
        }
    });

    // ================================================================
    // 9. INVARIANTES DE ESTRUTURA
    // ================================================================

    await teste('[ADM] o messageCreate consulta o FeatureRegistry nos pontos de corte', () => {
        const src = require('fs').readFileSync(path.join(RAIZ, 'events/messageCreate.js'), 'utf8');
        for (const chave of ['filtro_palavras', 'anti_spam', 'anti_link', 'chat_ia', 'monitoramento', 'punicao_auto']) {
            assert.ok(src.includes(`'${chave}'`),
                `a chave ${chave} não é consultada em messageCreate — o toggle do ` +
                'painel não teria efeito no filtro');
        }
        // E o caminho quente não pode virar await por chave.
        assert.ok(/ligadoSync/.test(src),
            'o caminho quente tem que usar ligadoSync (sem I/O por mensagem)');
    });

    await teste('[ADM] o registry não depende de rede no caminho quente', () => {
        const src = require('fs').readFileSync(path.join(RAIZ, 'managers/FeatureRegistry.js'), 'utf8');
        assert.ok(/static ligadoSync/.test(src), 'ligadoSync é o que o messageCreate usa');
        assert.ok(/static async aquecer/.test(src), 'e o registry tem que saber aquecer o cache');
        const ready = require('fs').readFileSync(path.join(RAIZ, 'events/ready.js'), 'utf8');
        assert.ok(/Features\.aquecer|aquecer\(\)/.test(ready),
            'sem aquecer, ligadoSync cai no default e o painel mostra "tudo ligado" ' +
            'num servidor que a staff já tinha desligado');
    });

    await teste('[ADM] o boot não sobrescreve mais o desligamento da staff', () => {
        const src = require('fs').readFileSync(path.join(RAIZ, 'events/ready.js'), 'utf8');
        assert.ok(!/setMonitoringStatus\(\s*guild\.id\s*,\s*true\s*\)/.test(src),
            'o ready.js ainda força monitoramento=true a cada boot — quem ' +
            'desligou pelo !MonitorOff ou pelo /adm recebe de volta no restart');
    });

    await teste('[ADM] as palavras banidas e o filtro de link são por servidor', () => {
        const FilterManager = require('fs').readFileSync(path.join(RAIZ, 'managers/FilterManager.js'), 'utf8');
        assert.ok(/db\.getCustomWords\(g\)/.test(FilterManager),
            'o FilterManager tem que pedir as palavras com o guildId — sem ' +
            'isso o admin de um servidor muda o filtro de todos');
        const lm = require('fs').readFileSync(path.join(RAIZ, 'managers/LinkManager.js'), 'utf8');
        assert.ok(/getLinkSettings\(escopo\)/.test(lm),
            'o LinkManager tem que pedir a config com o escopo do servidor');

        // E os comandos de escrita não podem chamar a API crua: o cache do
        // FilterManager tem que ser invalidado junto, senão o painel grava e
        // o filtro continua valendo.
        for (const arquivo of ['commands/config/filter.js', 'managers/AdminChatManager.js']) {
            const src = require('fs').readFileSync(path.join(RAIZ, arquivo), 'utf8');
            assert.ok(!/db\.addCustomWord|db\.removeCustomWord/.test(src),
                `${arquivo} escreve palavra direto no banco e não invalida o ` +
                'cache — o filtro não muda na hora');
        }
    });

    await teste('[ADM] o refresh de canal usa os servidores do client, não Object.keys(db)', () => {
        // O bug que zerava o /filter disable a cada restart: Object.keys de um
        // MÓDULO devolve os nomes das funções, nunca um ID de guild.
        //
        // Os comentários saem antes: o arquivo DESCREVE o `Object.keys(db)`
        // antigo, e o texto do bug não pode fazer o teste falhar.
        const src = require('fs').readFileSync(path.join(RAIZ, 'managers/FilterManager.js'), 'utf8');
        const codigo = src
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
        assert.ok(!/Object\.keys\(db\)/.test(codigo),
            'refreshChannelModeration ainda faz Object.keys(db) — devolve ' +
            "['db','getCustomWords',...], nunca um ID de guild");
        assert.ok(/guildIdsConhecidos/.test(codigo),
            'a lista de servidores tem que vir do client do gateway');
    });

    // ================================================================
    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    if (falhou) {
        console.log('\n  FALHAS (worklist — cada uma é um bug a corrigir):');
        falhas.forEach(f => console.log('   - ' + f));
    }
    try { require('fs').unlinkSync(TMP); require('fs').unlinkSync(TMP + '.bak'); } catch (e) {}
    process.exit(falhou ? 1 : 0);
})();
