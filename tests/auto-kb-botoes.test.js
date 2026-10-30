/**
 * Teste do fluxo de decisão do Auto-KB, sem Discord.
 *
 * Reproduz o bug real: o handler respondia a interaction DUAS vezes
 * (update dentro do manager + reply no handler) e o Discord estourava
 * "The reply to this interaction has already been sent or deferred".
 * Aqui conta quantas vezes cada método foi chamado.
 *
 *   node tests/auto-kb-botoes.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

// Log separado do bot (ver utils/logger.js: LOG_FILE). Sem isto as linhas
// de teste caem no logs/bot-*.log junto com as do bot rodando, e o
// diagnostico fica impossivel: nao da para saber qual processo escreveu.
process.env.LOG_FILE = process.env.LOG_FILE || 'teste.log';

// O approve grava de verdade. apontamos TAMBEM o writer para uma pasta
// temporaria: sem isso o teste suja o index.json e o auto-kb de producao
// (ja aconteceu uma vez enquanto escrevia isto).
const TMP = path.join(os.tmpdir(), 'autokb-btn-' + process.pid + '.json');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autokb-btndir-'));
process.env.AUTO_KB_PENDING_FILE = TMP;
process.env.AUTO_KB_INDEX = path.join(TMP_DIR, 'index.json');
process.env.AUTO_KB_DIR = path.join(TMP_DIR, 'auto-kb');
fs.writeFileSync(process.env.AUTO_KB_INDEX, JSON.stringify({ documents: [] }));

const { AutoKB } = require(path.join(RAIZ, 'managers/AutoKB'));

/** Interaction falsa que conta respostas e simula o erro do Discord. */
function interFalso(userId = '1438102316271014008') {
    const c = { reply: 0, update: 0, deferUpdate: 0, editReply: 0, followUp: 0, showModal: 0, order: [] };
    const i = {
        user: { id: userId, tag: 'tester#0001' },
        customId: '',
        _c: c,
        async reply(o) {
            c.reply++; c.order.push('reply');
            if (c.deferUpdate || c.update || c.editReply) throw new Error('The reply to this interaction has already been sent or deferred.');
        },
        async update() {
            c.update++; c.order.push('update');
            if (c.reply || c.editReply) throw new Error('The reply to this interaction has already been sent or deferred.');
        },
        async deferUpdate() { c.deferUpdate++; c.order.push('deferUpdate'); },
        async editReply() { c.editReply++; c.order.push('editReply'); },
        async followUp() { c.followUp++; c.order.push('followUp'); },
        async showModal() { c.showModal++; c.order.push('showModal'); },
    };
    return i;
}

function registrarProposta(chave, id) {
    AutoKB.pendentes.set(chave, {
        id: String(id),
        proposta: {
            chave,
            freq: 3,
            perguntas: ['como apago veiculo orfao aqui'],
            exemplos: [{ pergunta: 'como apago veiculo orfao aqui', resposta: "Use 'deletar <id>'.", channelId: 'c', timestamp: 1 }],
        },
        status: 'pendente', messageId: 'msg', criadoEm: Date.now(),
    });
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
        // 1) o manager NÃO responde a interaction (quem responde é o handler)
        await teste('aprovar/ignorar não tocam na interaction', async () => {
            registrarProposta('k-aprovar', 1);
            const i = interFalso();
            const r = await AutoKB.aprovar('autokb_approve:1', i);
            assert.ok(r.ok, 'deveria aprovar: ' + r.msg);
            assert.strictEqual(i._c.update, 0, 'o manager chamou update() — bug do reply duplo');
            assert.strictEqual(i._c.reply, 0, 'o manager chamou reply() — bug do reply duplo');
            assert.strictEqual(i._c.editReply, 0, 'o manager chamou editReply() — bug do reply duplo');
        });

        await teste('ignorar não toca na interaction', async () => {
            registrarProposta('k-ignorar', 2);
            const i = interFalso();
            const r = await AutoKB.ignorar('autokb_ignore:2', i);
            assert.ok(r.ok);
            assert.strictEqual(i._c.update, 0);
            assert.strictEqual(i._c.reply, 0);
            assert.strictEqual(i._c.editReply, 0);
        });

        // 2) aprovar devolve o que o handler precisa para montar o embed
        await teste('aprovar devolve status, docId e path', async () => {
            registrarProposta('k-dados', 3);
            const i = interFalso();
            const r = await AutoKB.aprovar('autokb_approve:3', i);
            assert.strictEqual(r.status, 'aprovado');
            assert.ok(r.docId, 'faltou docId');
            assert.ok(r.path, 'faltou path');
            assert.ok(r.path.endsWith('.md'), 'path deveria apontar pro .md');
        });

        // 3)Ignorar devolve status 'ignorado'
        await teste('ignorar devolve status ignorado', async () => {
            registrarProposta('k-st', 4);
            const r = await AutoKB.ignorar('autokb_ignore:4', interFalso());
            assert.strictEqual(r.status, 'ignorado');
        });

        // 4) embed decidido não mexe em componente
        await teste('embed decidido sai sem botões', () => {
            const i = interFalso();
            const e = AutoKB.embedDecidido('aprovado', i, 'auto-kb-x', 'x.md').toJSON();
            assert.match(e.title, /aprovada/);
            assert.ok(!e.components, 'o embed decidido não deve ter components');
            assert.ok(e.description.includes('x.md'), 'faltou o caminho do documento');
        });

        // 5) após erro, dá pra reexibir a proposta com os botões
        await teste('embedOriginal e linhaBotoes devolvem a proposta', () => {
            registrarProposta('k-orig', 5);
            const e = AutoKB.embedOriginal('autokb_approve:5').toJSON();
            assert.match(e.title, /Sugestão/);
            const b = AutoKB.linhaBotoes('5').toJSON();
            assert.strictEqual(b.components.length, 3);
            assert.deepStrictEqual(b.components.map(c => c.custom_id), [
                'autokb_approve:5', 'autokb_edit:5', 'autokb_ignore:5',
            ]);
        });

        // 6) proposta já decidida não pode ser decidida de novo
        await teste('proposta já decidida é recusada', async () => {
            registrarProposta('k-dup', 6);
            const i1 = interFalso();
            await AutoKB.aprovar('autokb_approve:6', i1);
            const i2 = interFalso();
            const r = await AutoKB.aprovar('autokb_approve:6', i2);
            assert.ok(!r.ok, 'aprovou duas vezes!');
            assert.match(r.msg, /já foi respondida/);
        });

        // 7) decisão sobrevive a "restart" (vem do arquivo)
        await teste('pendentes sobrevivem ao restart', () => {
            registrarProposta('k-restart', 7);
            AutoKB.salvarPendentes();
            AutoKB.pendentes = new Map();
            const n = AutoKB.carregarPendentes();
            assert.ok(n > 0, 'não recuperou nada');
            assert.ok(AutoKB.pendentes.has('k-restart'), 'a proposta sumiu do registro');
        });

        // 8) o index real nao foi tocado
        await teste('o índice real da KB não é tocado pelo teste', () => {
            const real = JSON.parse(fs.readFileSync(path.join(RAIZ, 'ai/knowledge/index.json'), 'utf8'));
            const nomes = real.documents.filter(d => /orfao-aqui|tester/.test(d.id)).map(d => d.id);
            assert.deepStrictEqual(nomes, [], 'o teste escreveu no índice real: ' + nomes.join(', '));
        });

        // 9) o código do handler não pode responder duas vezes
        await teste('handler responde uma única vez por clique', () => {
            const src = fs.readFileSync(path.join(RAIZ, 'events/interactionCreate.js'), 'utf8');
            const bloco = src.slice(src.indexOf("autokb_ignore") , src.indexOf('// BOTÕES ADMIN'));
            // No caminho de decisão: deferUpdate + UM editReply.
            const replies = (bloco.match(/interaction\.reply\(/g) || []).length;
            const updates = (bloco.match(/interaction\.update\(/g) || []).length;
            const editReplies = (bloco.match(/interaction\.editReply\(/g) || []).length;
            assert.strictEqual(updates, 0, 'handler ainda chama interaction.update()');
            assert.ok(editReplies >= 1, 'handler precisa fechar com editReply');
            // reply() só pode existir nos caminhos de saída antecipada (negado/erro)
            assert.ok(replies <= 2, 'handler tem reply() demais no bloco: ' + replies);
        });
    } finally {
        try { fs.unlinkSync(TMP); } catch (e) {}
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
    }

    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou ? 1 : 0);
})();
