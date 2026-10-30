/**
 * Testes da escrita na KB (Fase 1): auto-kb, index.json e precedência.
 *
 * Roda contra um índice temporário — o index.json real nunca é tocado.
 *
 *   node tests/auto-kb.test.js
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
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autokb-'));
const TMP_INDEX = path.join(TMP_DIR, 'index.json');
const TMP_AUTO = path.join(TMP_DIR, 'auto-kb');

// snapshot do índice real (para provar no fim que o teste não escreveu nele)
const SNAPSHOT = JSON.parse(
    fs.readFileSync(path.join(RAIZ, 'ai/knowledge/index.json'), 'utf8')
).documents.map(d => d.id);
fs.copyFileSync(path.join(RAIZ, 'ai/knowledge/index.json'), TMP_INDEX);

// Os paths do writer vêm do env (AUTO_KB_INDEX / AUTO_KB_DIR). Apontar antes
// do require é o que garante que o index.json real não seja tocado.
process.env.AUTO_KB_INDEX = TMP_INDEX;
process.env.AUTO_KB_DIR = TMP_AUTO;
const w = require(path.join(RAIZ, 'ai/autoKbWriter'));

let passou = 0, falhou = 0;
async function teste(nome, fn) {
    try { await fn(); console.log('  ok   ' + nome); passou++; }
    catch (e) {
        console.log('  FALHA ' + nome);
        console.log('       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e));
        falhou++;
    }
}
const lerIdx = () => JSON.parse(fs.readFileSync(TMP_INDEX, 'utf8'));

(async () => {
    try {
        // 1) cria o .md e a entrada no índice
        await teste('addDoc cria o arquivo e registra no índice', () => {
            const r = w.addDoc({
                titulo: 'Onde fica a vitrine de artes',
                fatos: '- A vitrine fica no canal <#1553042999720542218> e abre as 19h.',
                origem: 'Chat #geral, 2026-09-26',
                aprovadoPor: '1438102316271014008',
            });
            assert.ok(r.id.startsWith('auto-kb-'), 'id deveria começar com auto-kb-');
            const doc = lerIdx().documents.find(d => d.id === r.id);
            assert.ok(doc, 'entrada ausente no índice');
            assert.strictEqual(doc.category, 'auto-kb');
            assert.strictEqual(doc.confidence, 'low');
            assert.ok(fs.existsSync(path.join(TMP_AUTO, doc.id + '.md')), 'o .md não foi criado em ' + TMP_AUTO);
        });

        // 2) prioridade baixa: texto auditado vence no empate
        await teste('doc aprendido tem prioridade baixa', () => {
            const doc = lerIdx().documents.find(d => d.id === 'auto-kb-onde-fica-a-vitrine-de-artes');
            assert.ok(doc.priority <= 2, `prioridade ${doc.priority} deveria ser <= 2`);
        });

        // 3) o formato segue o padrão dos docs curados
        await teste('o markdown gerado tem as seções do padrão da KB', () => {
            // ancorado no id criado: o índice temporário foi copiado do real,
            // que pode já ter docs auto-kb aprovados de verdade
            const doc = lerIdx().documents.find(d => d.id === 'auto-kb-onde-fica-a-vitrine-de-artes');
            const md = fs.readFileSync(path.join(TMP_AUTO, doc.id + '.md'), 'utf8');
            assert.ok(md.startsWith('# '), 'faltou o título');
            assert.ok(/## Fatos/.test(md), 'faltou ## Fatos');
            assert.ok(/## Fonte/.test(md), 'faltou ## Fonte');
            assert.ok(/confidence: low/.test(md), 'faltou o marcador de confidence');
        });

        // 4) dedup: mesmo título atualiza, não duplica
        await teste('reescrever o mesmo título atualiza em vez de duplicar', () => {
            const antes = lerIdx().documents.length;
            const r = w.addDoc({
                titulo: 'Onde fica a vitrine de artes',
                fatos: '- Agora abre as 20h (atualizado).',
            });
            assert.strictEqual(lerIdx().documents.length, antes, 'duplicou a entrada');
            const doc = lerIdx().documents.find(d => d.id === r.id);
            const md = fs.readFileSync(path.join(TMP_AUTO, doc.id + '.md'), 'utf8');
            assert.ok(/20h/.test(md), 'o conteúdo não foi atualizado');
        });

        // 5) entrada órfã no índice não quebra a carga
        await teste('entrada sem arquivo não quebra o loader', () => {
            const idx = lerIdx();
            idx.documents.push({
                id: 'auto-kb-fantasma', title: '# Fantasma', path: 'ai/knowledge/auto-kb/nao-existe.md',
                category: 'auto-kb', priority: 2, keywords: ['fantasma'], commands: [],
                source: 'teste', confidence: 'low', lastVerified: '2026-09-26',
            });
            fs.writeFileSync(TMP_INDEX, JSON.stringify(idx, null, 2));
            const { loadDocContent, invalidateCache } = require(path.join(RAIZ, 'ai/knowledge-loader'));
            invalidateCache();
            const doc = JSON.parse(fs.readFileSync(TMP_INDEX, 'utf8')).documents.find(d => d.id === 'auto-kb-fantasma');
            assert.strictEqual(loadDocContent(doc), null, 'deveria devolver null, não estourar');
        });

        // 6) addDoc exige título e fatos
        await teste('addDoc valida entrada', () => {
            assert.throws(() => w.addDoc({}), /titulo e fatos/);
            assert.throws(() => w.addDoc({ titulo: 'x' }), /titulo e fatos/);
        });

        // 7) findByTitle acha o que já existe
        await teste('findByTitle localiza o documento aprendido', () => {
            const achado = w.findByTitle('Onde fica a vitrine de artes');
            assert.ok(achado, 'não achou');
            assert.strictEqual(achado.existeArquivo, true);
            assert.strictEqual(w.findByTitle('Assunto que nunca foi salvo'), null);
        });

        // 8) o índice real não foi tocado: comparamos com o snapshot, porque
        // pode haver docs auto-kb aprovados de verdade antes do teste
        await teste('o index.json real continua intacto', () => {
            const real = JSON.parse(fs.readFileSync(path.join(RAIZ, 'ai/knowledge/index.json'), 'utf8'));
            assert.deepStrictEqual(
                real.documents.map(d => d.id).sort(),
                SNAPSHOT.sort(),
                'o teste escreveu no índice real'
            );
        });

        // 9) damping: doc aprendido não pode vencer texto curado
        await teste('doc aprendido não displace documento curado', () => {
            const src = fs.readFileSync(path.join(RAIZ, 'ai/knowledge-loader.js'), 'utf8');
            assert.ok(/doc\.category === 'auto-kb'\) score \*= 0\.75/.test(src), 'faltou o damping');
            assert.ok(/s\.score > melhorCurado\.score/.test(src), 'faltou a regra de só entrar se vencer o curado');
        });
    } finally {
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
    }

    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou ? 1 : 0);
})();
