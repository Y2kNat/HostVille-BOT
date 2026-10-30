/**
 * Testes do ZipBuilder e do TierCooldown.
 *
 * O zip e validado de verdade: o arquivo gerado vai pra pasta e roda
 * `unzip -t` e `unzip -p` (o unzip ja existe no Termux). Nao e so conferir
 * o tamanho do buffer.
 *
 *   node tests/zip.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');

// Grava em log SEPARADO do bot. Sem isto as linhas de teste aparecem no
// logs/bot-*.log junto com as do bot rodando, e o diagnostico fica
// impossivel: nao da para saber qual processo escreveu a linha.
process.env.LOG_FILE = process.env.LOG_FILE || 'teste.log';
const ZipBuilder = require(path.join(RAIZ, 'utils/ZipBuilder'));
const TierCooldown = require(path.join(RAIZ, 'utils/TierCooldown'));

let passou = 0, falhou = 0;
async function teste(nome, fn) {
    try { await fn(); console.log('  ok   ' + nome); passou++; }
    catch (e) {
        console.log('  FALHA ' + nome);
        console.log('       ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n       ') : e));
        falhou++;
    }
}

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ziptest-'));
const unzip = (args) => execFileSync('unzip', args, { cwd: TEMP, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const temUnzip = (() => {
    try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); return true; }
    catch { return false; }
})();

// Guarda o arquivo original de cooldown e restaura no fim
const COOLDOWN_FILE = TierCooldown.FILE;
const cooldownOriginal = fs.existsSync(COOLDOWN_FILE) ? fs.readFileSync(COOLDOWN_FILE, 'utf8') : null;

(async () => {
    if (temUnzip) console.log('  (unzip disponível — validando com o descompactador de verdade)');
    else console.log('  (AVISO: unzip ausente — os testes de integridade do zip foram pulados)');

    // ============================================================
    // ZipBuilder: estrutura
    // ============================================================

    await teste('zip tem as três assinaturas ZIP', () => {
        const b = ZipBuilder.criar([{ nome: 'a.txt', conteudo: 'oi' }]);
        assert.strictEqual(b.readUInt32LE(0), 0x04034b50, 'local file header');
        const eocd = b.length - 22;
        assert.strictEqual(b.readUInt32LE(eocd), 0x06054b50, 'EOCD');
    });

    await teste('sem arquivos é erro explícito', () => {
        assert.throws(() => ZipBuilder.criar([]), /nenhum arquivo/);
        assert.throws(() => ZipBuilder.criar(null), /nenhum arquivo/);
    });

    await teste('sanitizar neutraliza path traversal e barras do Windows', () => {
        assert.strictEqual(ZipBuilder.sanitizar('../../etc/passwd'), 'etc/passwd');
        assert.strictEqual(ZipBuilder.sanitizar('C:\\proj\\src\\index.js'), 'proj/src/index.js');
        assert.strictEqual(ZipBuilder.sanitizar('/abs/x.js'), 'abs/x.js');
        assert.strictEqual(ZipBuilder.sanitizar('./a/./b.txt'), 'a/b.txt');
        assert.strictEqual(ZipBuilder.sanitizar(''), 'arquivo');
    });

    // ============================================================
    // nomeDeArquivo: o nome vem do MODELO e é gravado em disco
    // ============================================================

    await teste('nomeDeArquivo aceita subpasta legitima', () => {
        assert.strictEqual(ZipBuilder.nomeDeArquivo('src/index.tsx'), 'src/index.tsx',
            'src/index.tsx e um pedido legitimo de projeto e nao pode ser barrado');
    });

    await teste('nomeDeArquivo neutraliza traversal que ESCAPARIA de temp/', () => {
        // Este e o bug: com path.join(dir, nome) e "../../../../tmp/EVIL.txt",
        // o arquivo sai de temp/ e grava em qualquer lugar do sistema.
        for (const mal of [
            '../../../../tmp/EVIL.txt',
            '../../EVIL.txt',
            '../EVIL.txt',
            'a/../../EVIL.txt',
            '..\\..\\EVIL.txt',
        ]) {
            const r = ZipBuilder.nomeDeArquivo(mal);
            assert.ok(!r.includes('..'), `"${mal}" virou "${r}" com .. ainda dentro`);
            const caminho = path.join('/repo/temp', r);
            assert.ok(caminho.startsWith('/repo/temp/'), `"${mal}" escapou para ${caminho}`);
        }
    });

    await teste('nomeDeArquivo neutraliza caminho absoluto e URL', () => {
        assert.strictEqual(ZipBuilder.nomeDeArquivo('/tmp/EVIL.txt'), 'tmp/EVIL.txt');
        assert.strictEqual(ZipBuilder.nomeDeArquivo('C:\\EVIL.txt'), 'EVIL.txt');
        // URL perde esquema e host: vira só o caminho
        assert.strictEqual(ZipBuilder.nomeDeArquivo('http://x.com/a/b.js'), 'a/b.js');
        // "/etc/passwd" não tem extensão, então é rejeitado: o fallback é um
        // nome neutro, nunca o path original
        assert.strictEqual(ZipBuilder.nomeDeArquivo('file:///etc/passwd'), 'arquivo.txt');
        assert.ok(!ZipBuilder.nomeDeArquivo('file:///etc/passwd').includes('passwd'));
    });

    await teste('nomeDeArquivo sempre devolve nome com extensao', () => {
        assert.strictEqual(ZipBuilder.nomeDeArquivo(''), 'arquivo.txt');
        assert.strictEqual(ZipBuilder.nomeDeArquivo('../../'), 'arquivo.txt');
        assert.strictEqual(ZipBuilder.nomeDeArquivo('sem-extensao'), 'arquivo.txt');
        assert.strictEqual(ZipBuilder.nomeDeArquivo('a/b/c'), 'arquivo.txt');
    });

    await teste('garantirPasta cria a subpasta antes do writeFileSync', () => {
        // Era o ENOENT do log: mkdirSync criava so temp/, nao temp/src/.
        const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'pasta-'));
        const alvo = path.join(raiz, 'src', 'components', 'index.tsx');
        ZipBuilder.garantirPasta(alvo);
        assert.ok(fs.existsSync(path.join(raiz, 'src', 'components')), 'a subpasta nao foi criada');
        fs.writeFileSync(alvo, 'ok');
        assert.strictEqual(fs.readFileSync(alvo, 'utf8'), 'ok');
        fs.rmSync(raiz, { recursive: true, force: true });
    });

    await teste('o nome que o TaskRunner grava NAO sai de temp/', () => {
        // Teste de integração: a combinação que estava quebrada no log real.
        const nome = ZipBuilder.nomeDeArquivo('src/index.tsx');
        const dir = path.join(TEMP, 'integracao');
        fs.mkdirSync(dir, { recursive: true });
        const destino = path.join(dir, nome);
        ZipBuilder.garantirPasta(destino);
        fs.writeFileSync(destino, 'conteudo');
        assert.ok(fs.existsSync(destino), 'o arquivo nao foi criado na subpasta');
        assert.ok(destino.startsWith(dir + path.sep), 'o arquivo saiu do diretorio');

        const mal = ZipBuilder.nomeDeArquivo('../../../../tmp/EVIL-E2E.txt');
        const destino2 = path.join(dir, mal);
        assert.ok(destino2.startsWith(dir + path.sep), `malicious escaped: ${destino2}`);
        assert.ok(!fs.existsSync(path.join(os.tmpdir(), 'EVIL-E2E.txt')), 'gravo fora de temp!');
    });

    await teste('caminho malicioso não escapa do diretório de extração', () => {
        const zip = ZipBuilder.criar([
            { nome: '../../../../tmp/eviltest.txt', conteudo: 'pwn' },
        ]);
        const destino = path.join(TEMP, 'trav');
        fs.mkdirSync(destino, { recursive: true });
        fs.writeFileSync(path.join(TEMP, 'evil.zip'), zip);
        unzip(['-o', 'evil.zip', '-d', destino]);
        const saiu = fs.readdirSync(destino, { recursive: true }).map(String);
        assert.ok(saiu.some(f => f.includes('eviltest.txt')), `esperava o arquivo dentro, veio ${JSON.stringify(saiu)}`);
        assert.ok(!fs.existsSync(path.join(os.tmpdir(), 'eviltest.txt')), 'ESCAPOU do diretorio de extração');
    });

    await teste('conteúdo vazio não quebra', () => {
        const b = ZipBuilder.criar([{ nome: 'vazio.txt', conteudo: '' }]);
        assert.ok(b.length > 22, 'precisa ter pelo menos o EOCD');
    });

    await teste('dataDos satura antes de 1980 sem underflow', () => {
        const { data } = ZipBuilder.dataDos(new Date('1970-01-01T00:00:00Z'));
        assert.ok(Number.isFinite(data) && data >= 0, `data invalida: ${data}`);
    });

    // ============================================================
    // ZipBuilder: integridade real
    // ============================================================

    await teste('unzip -t aprova o arquivo', () => {
        if (!temUnzip) return;
        const arquivos = [
            { nome: 'index.html', conteudo: '<!DOCTYPE html><h1>oi</h1>'.repeat(200) },
            { nome: 'style.css', conteudo: 'body{margin:0}'.repeat(500) },
            { nome: 'app.js', conteudo: 'console.log(1)'.repeat(300) },
            { nome: 'vazio.txt', conteudo: '' },
            { nome: 'acentuado-ção.txt', conteudo: 'ção, coração, ã' },
        ];
        fs.writeFileSync(path.join(TEMP, 'ok.zip'), ZipBuilder.criar(arquivos));
        const out = unzip(['-t', 'ok.zip']);
        assert.ok(/No errors detected/i.test(out), out);
    });

    await teste('round-trip: o conteúdo extraido é byte a byte igual', () => {
        if (!temUnzip) return;
        const conteudos = {
            'a.txt': 'linha1\nlinha2\n' + 'x'.repeat(5000),
            'b.json': JSON.stringify({ nome: 'Nat', traits: ['a', 'b'], n: 42 }),
            'c/unicode.txt': 'ação — coração\n\t\r\n fim',
        };
        fs.writeFileSync(path.join(TEMP, 'rt.zip'), ZipBuilder.criar(
            Object.entries(conteudos).map(([nome, conteudo]) => ({ nome, conteudo }))
        ));
        for (const [nome, esperado] of Object.entries(conteudos)) {
            const extraido = unzip(['-p', 'rt.zip', nome]);
            assert.strictEqual(extraido, esperado, `divergiu o conteudo de ${nome}`);
        }
    });

    await teste('round-trip com Buffer binário (não só texto)', () => {
        if (!temUnzip) return;
        const bin = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 0, 0, 0]);
        fs.writeFileSync(path.join(TEMP, 'bin.zip'), ZipBuilder.criar([{ nome: 'raw.bin', conteudo: bin }]));
        const destino = path.join(TEMP, 'binout');
        fs.mkdirSync(destino, { recursive: true });
        unzip(['-o', 'bin.zip', '-d', destino]);
        assert.ok(bin.equals(fs.readFileSync(path.join(destino, 'raw.bin'))), 'buffer nao sobreviveu ao round-trip');
    });

    await teste('múltiplos arquivos com mesmo nome base em pastas diferentes', () => {
        if (!temUnzip) return;
        fs.writeFileSync(path.join(TEMP, 'dup.zip'), ZipBuilder.criar([
            { nome: 'src/index.js', conteudo: 'A'.repeat(2000) },
            { nome: 'public/index.js', conteudo: 'B'.repeat(3000) },
        ]));
        const out = unzip(['-l', 'dup.zip']);
        assert.ok(out.includes('src/index.js') && out.includes('public/index.js'), out);
    });

    await teste('zip grande realmente comprime (deflate funcionando)', () => {
        if (!temUnzip) return;
        const grande = 'A'.repeat(200000);
        const zip = ZipBuilder.criar([{ nome: 'grande.txt', conteudo: grande }]);
        assert.ok(zip.length < grande.length / 10, `zip de ${zip.length} bytes nao comprimiu ${grande.length}`);
        fs.writeFileSync(path.join(TEMP, 'big.zip'), zip);
        const out = unzip(['-p', 'big.zip', 'grande.txt']);
        assert.strictEqual(out.length, grande.length, 'round-trip do arquivo grande divergiu');
    });

    // ============================================================
    // ZipBuilder.gravar: split acima do limite
    // ============================================================

    await teste('gravar faz 1 parte abaixo do limite', () => {
        const r = ZipBuilder.gravar(
            [{ nome: 'a.txt', conteudo: 'x'.repeat(1000) }],
            TEMP, { nomeBase: 'p1' }
        );
        assert.strictEqual(r.partes.length, 1);
        assert.strictEqual(r.total, 1);
        assert.ok(fs.existsSync(r.partes[0].caminho));
        assert.ok(/unzip/.test(String(temUnzip)) ? true : true);
    });

    await teste('gravar divide quando passa do limite e cada parte é um zip válido', () => {
        if (!temUnzip) return;
        // Conteúdo INCOMPRIMÍVEL de propósito: com texto repetido o deflate
        // esmaga tudo e o zip nunca passaria do limite — o teste passaria pelo
        // motivo errado.
        const incompressivel = (semente) => {
            let s = '';
            let x = semente;
            for (let i = 0; i < 4000; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += String.fromCharCode(33 + (x % 90)); }
            return s;
        };
        const arquivos = [];
        for (let i = 0; i < 12; i++) arquivos.push({ nome: `f${i}.txt`, conteudo: incompressivel(i + 1) });
        const r = ZipBuilder.gravar(arquivos, TEMP, { nomeBase: 'split', limiteBytes: 8192 });
        assert.ok(r.partes.length > 1, `esperava mais de 1 parte, veio ${r.partes.length}`);
        assert.strictEqual(r.total, 12, 'perdeu arquivo na divisao');
        for (const p of r.partes) {
            assert.ok(p.bytes <= 8192 * 2, `parte ${p.nome} com ${p.bytes} bytes`);
            const out = unzip(['-t', p.nome]);
            assert.ok(/No errors detected/i.test(out), `${p.nome}: ${out}`);
        }
    });

    await teste('gravar numereia as partes e todas seguem o prefixo', () => {
        let s = '', x = 7;
        for (let i = 0; i < 6000; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += String.fromCharCode(33 + (x % 90)); }
        const arquivos = [];
        for (let i = 0; i < 10; i++) arquivos.push({ nome: `g${i}.txt`, conteudo: s });
        const r = ZipBuilder.gravar(arquivos, TEMP, { nomeBase: 'num', limiteBytes: 8192 });
        assert.ok(r.partes.length > 1, `precisou dividir, veio ${r.partes.length}`);
        r.partes.forEach((p, i) => assert.strictEqual(p.nome, `num-${i + 1}.zip`, `parte ${i} nomeada ${p.nome}`));
    });

    // ============================================================
    // TierCooldown: cooldowns de 12h/24h
    // ============================================================

    await teste('sem registro, o tier nao esta bloqueado', () => {
        TierCooldown.clear('u_teste_1');
        assert.strictEqual(TierCooldown.get('u_teste_1', 'MAX').bloqueado, false);
    });

    await teste('set bloqueia e devolve o tempo restante', () => {
        TierCooldown.clear('u_teste_2');
        TierCooldown.set('u_teste_2', 'MAX', 24);
        const g = TierCooldown.get('u_teste_2', 'MAX');
        assert.strictEqual(g.bloqueado, true);
        assert.ok(g.restanteMs > 23 * 3600000, `restou so ${g.restanteMs}ms de 24h`);
    });

    await teste('cooldown e por tier: MAX bloqueado nao bloqueia HIGH', () => {
        TierCooldown.clear('u_teste_3');
        TierCooldown.set('u_teste_3', 'MAX', 24);
        assert.strictEqual(TierCooldown.get('u_teste_3', 'MAX').bloqueado, true);
        assert.strictEqual(TierCooldown.get('u_teste_3', 'HIGH').bloqueado, false, 'MAX vazou para HIGH');
    });

    await teste('cooldown e por usuario: um nao afeta o outro', () => {
        TierCooldown.clear('u_teste_4a');
        TierCooldown.clear('u_teste_4b');
        TierCooldown.set('u_teste_4a', 'HIGH', 12);
        assert.strictEqual(TierCooldown.get('u_teste_4a', 'HIGH').bloqueado, true);
        assert.strictEqual(TierCooldown.get('u_teste_4b', 'HIGH').bloqueado, false);
    });

    await teste('cooldown de 0h nao bloqueia', () => {
        TierCooldown.clear('u_teste_5');
        TierCooldown.set('u_teste_5', 'MIN', 0);
        assert.strictEqual(TierCooldown.get('u_teste_5', 'MIN').bloqueado, false);
    });

    await teste('cooldown vencido nao bloqueia', () => {
        TierCooldown.clear('u_teste_6');
        // Deterministico: semeia um timestamp ja no passado em vez de usar um
        // cooldown de 360ms, que dependia do relogio e era racy.
        const dados = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8'));
        dados.u_teste_6 = { HIGH: Date.now() - 1000 };
        fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(dados, null, 2));
        const g = TierCooldown.get('u_teste_6', 'HIGH');
        assert.strictEqual(g.bloqueado, false, `ainda bloqueou com ${g.restanteMs}ms`);
        assert.strictEqual(g.restanteMs, 0);
    });

    await teste('clear so no tier libera os outros', () => {
        TierCooldown.clear('u_teste_7');
        TierCooldown.set('u_teste_7', 'MAX', 24);
        TierCooldown.set('u_teste_7', 'HIGH', 12);
        TierCooldown.clear('u_teste_7', 'MAX');
        assert.strictEqual(TierCooldown.get('u_teste_7', 'MAX').bloqueado, false);
        assert.strictEqual(TierCooldown.get('u_teste_7', 'HIGH').bloqueado, true, 'clear de MAX limpou HIGH');
    });

    await teste('prune remove vencidos e preserva vigentes', () => {
        TierCooldown.clear('u_teste_8');
        TierCooldown.set('u_teste_8', 'MAX', 24);
        const dados = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8'));
        dados.u_teste_9 = { MAX: Date.now() - 1000 };
        fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(dados, null, 2));

        TierCooldown.prune();
        assert.strictEqual(TierCooldown.get('u_teste_8', 'MAX').bloqueado, true, 'prune levou um cooldown vigente');
        const depois = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8'));
        assert.ok(!depois.u_teste_9, 'prune deixou usuario vencido no arquivo');
    });

    await teste('COOLDOWN SOBREVIVE a recarregar o modulo (restart)', () => {
        TierCooldown.clear('u_teste_10');
        TierCooldown.set('u_teste_10', 'MAX', 24);
        // simula restart: limpa o cache e exige de novo
        delete require.cache[require.resolve(path.join(RAIZ, 'utils/TierCooldown'))];
        const Recarregado = require(path.join(RAIZ, 'utils/TierCooldown'));
        assert.strictEqual(Recarregado.get('u_teste_10', 'MAX').bloqueado, true,
            'o cooldown nao sobreviveu ao restart — e por isso que ele fica em arquivo, e nao no Map do RateLimiter');
        TierCooldown.clear('u_teste_10');
    });

    await teste('arquivo corrompido nao derruba: volta vazio', () => {
        const original = fs.readFileSync(COOLDOWN_FILE, 'utf8');
        fs.writeFileSync(COOLDOWN_FILE, '{ nao é json');
        try {
            assert.strictEqual(TierCooldown.get('u_x', 'MAX').bloqueado, false);
        } finally {
            fs.writeFileSync(COOLDOWN_FILE, original);
        }
    });

    await teste('formatar devolve tempo legível', () => {
        assert.strictEqual(TierCooldown.formatar(0), 'agora');
        assert.strictEqual(TierCooldown.formatar(30 * 60000), '30min');
        assert.strictEqual(TierCooldown.formatar(12 * 3600000), '12h');
        assert.strictEqual(TierCooldown.formatar(12 * 3600000 + 23 * 60000), '12h23');
    });

    // ============================================================
    // TierSelector: dois estágios (botão público -> ephemeral)
    // ============================================================

    /**
     * Message dublê com collector COMO O discord.js REAL.
     *
     * max:1 importa: o discord.js emite 'end' assim que despacha 'collect',
     * sem esperar o handler assíncrono. Um duble que so entrega 'collect'
     * esconde esse bug — foi assim que ele passou na primeira versão.
     */
    function mensagemDuble({ emiteEndNoMax = true } = {}) {
        const st = { edicoes: [], respostas: [] };
        const msg = {
            id: 'm1',
            edit: async (x) => { st.edicoes.push(x); return msg; },
            createMessageComponentCollector: (opts) => {
                st.opts = opts;
                const handlers = {};
                const collector = {
                    on: (ev, cb) => { handlers[ev] = cb; return collector; },
                    stop: () => { st.parou = true; },
                };
                st.disparar = async (ev, ...a) => {
                    if (!handlers[ev]) return;
                    if (ev === 'collect' && emiteEndNoMax) {
                        handlers.collect(...a);
                        // o discord.js encerra na sequencia, sem esperar o
                        // handler assíncrono terminar
                        if (handlers.end) handlers.end({ size: 1 }, 'max');
                        return;
                    }
                    return handlers[ev](...a);
                };
                return collector;
            },
        };
        st.msg = msg;
        return st;
    }

    /**
     * Client dublê com emitter de interactionCreate, como o discord.js real.
     *
     * Reproduz o ambiente em que o bug apareceu: nem
     * `interaction.awaitReplyComponent` nem
     * `InteractionResponse.awaitMessageComponent` funcionam aqui (o primeiro
     * não existe no 14.26.4; o segundo filtra pelo id da mensagem pública e
     * rejeita o clique no ephemeral). A espera correta é no evento do client.
     */
    function clientDuble() {
        const ouvintes = [];
        return {
            _emit: (ev, ...a) => { ouvintes.filter(o => o.ev === ev).forEach(o => o.cb(...a)); },
            _ativos: () => ouvintes.length,
            on(ev, cb) { ouvintes.push({ ev, cb }); return this; },
            off(ev, cb) {
                const i = ouvintes.findIndex(o => o.ev === ev && o.cb === cb);
                if (i >= 0) ouvintes.splice(i, 1);
                return this;
            },
        };
    }

    /**
     * Interação do clique em `gen:abrir`.
     * Sem nenhum método de espera: a escolha chega pelo evento do client.
     */
    function cliqueAbrirDuble(userId, client) {
        const st = { ephemerals: [] };
        const inter = {
            id: 'pub-123',
            client,
            customId: 'gen:abrir',
            user: { id: userId },
            reply: async (o) => { st.ephemerals.push(o); return { id: 'pub-123' }; },
        };
        st.inter = inter;
        return st;
    }

    /** Clique num tier, como chega do client. */
    function cliqueTier(userId, tier) {
        return { customId: `gen:${tier}`, user: { id: userId }, isButton: () => true, respostas: [], reply: async function (o) { this.respostas.push(o); } };
    }

    await teste('estagio 1 publica UM botao, sem vazar preco', async () => {
        const Sel = require(path.join(RAIZ, 'managers/TierSelector'));
        const d = mensagemDuble();
        const p = Sel.perguntar({ alvo: d.msg, userId: 'u2st_1', pedido: 'faz um site', timeoutMs: 40 });
        await new Promise(r => setTimeout(r, 5));

        const pub = d.edicoes[0];
        assert.ok(pub, 'a mensagem publica nao foi enviada');
        const linha = pub.components[0].toJSON().components;
        assert.strictEqual(linha.length, 1, `o estagio 1 deveria ter 1 botao, veio ${linha.length}`);
        assert.strictEqual(linha[0].custom_id, 'gen:abrir');
        assert.ok(d.opts.filter, 'o collector precisa de filtro');
        // O canal nao pode mostrar custo nem os 4 tiers: a escolha e privada.
        const json = JSON.stringify(pub.embeds[0].toJSON());
        assert.ok(!/[0-9]+k tokens/.test(json), `vazou preco: ${json}`);
        assert.ok(!/\bMED\b|\bHIGH\b|\bMAX\b/.test(json), `vazou a lista de tiers: ${json}`);
        assert.ok(!/volta em/.test(json), 'vazou o estado do cooldown');

        d.disparar('end', { size: 0 }, 'time');
        const r = await p;
        assert.strictEqual(r.tier, null);
        assert.strictEqual(r.expirou, true);
    });

    await teste('clique em abrir responde EPHEMERAL com o seletor de 4 botoes', async () => {
        const Sel = require(path.join(RAIZ, 'managers/TierSelector'));
        const d = mensagemDuble();
        const p = Sel.perguntar({ alvo: d.msg, userId: 'u2st_2', pedido: 'faz um site', timeoutMs: 200 });
        await new Promise(r => setTimeout(r, 5));

        const client = clientDuble();
        const clique = cliqueAbrirDuble('u2st_2', client);
        d.disparar('collect', clique.inter);
        await new Promise(r => setTimeout(r, 5));
        client._emit('interactionCreate', cliqueTier('u2st_2', 'MED'));

        assert.strictEqual(clique.ephemerals.length, 1, 'o clique nao respondeu');
        const eph = clique.ephemerals[0];
        assert.strictEqual(eph.flags, 64, 'o seletor PRECISA ser ephemeral (flags 64)');
        const botoes = eph.components[0].toJSON().components;
        assert.strictEqual(botoes.length, 4, `o seletor ephemeral deveria ter 4 botoes, veio ${botoes.length}`);
        assert.deepStrictEqual(botoes.map(x => x.custom_id), ['gen:MIN', 'gen:MED', 'gen:HIGH', 'gen:MAX']);
        // Agora SIM o preco aparece, porque e no privado
        assert.ok(/[0-9]+k tokens/.test(JSON.stringify(eph.embeds[0].toJSON())), 'o privado tem que mostrar o custo');

        const r = await p;
        assert.strictEqual(r.tier, 'MED', `veio ${r.tier}`);
        assert.strictEqual(r.expirou, false);
    });

    await teste('a escolha no ephemeral tambem responde ephemeral', async () => {
        const Sel = require(path.join(RAIZ, 'managers/TierSelector'));
        const { limiter } = require(path.join(RAIZ, 'managers/RateLimiter'));
        const uid = 'u2st_3';
        TierCooldown.clear(uid);
        limiter.reset('gen:MED:' + uid);

        const d = mensagemDuble();
        const p = Sel.perguntar({ alvo: d.msg, userId: uid, pedido: 'faz um site', timeoutMs: 300 });
        await new Promise(r => setTimeout(r, 5));
        const client = clientDuble();
        const clique = cliqueAbrirDuble(uid, client);
        d.disparar('collect', clique.inter);
        await new Promise(r2 => setTimeout(r2, 5));
        const tier = cliqueTier(uid, 'MED');
        client._emit('interactionCreate', tier);
        const r = await p;

        assert.strictEqual(r.tier, 'MED');
        const conf = tier.respostas[0];
        assert.ok(conf, 'a confirmacao do tier tem que responder');
        assert.strictEqual(conf.flags, 64, 'a confirmacao tem que ser ephemeral');
        assert.ok(/Gerando no tier/.test(conf.content), `conteudo: ${conf.content}`);
    });

    await teste('escolher HIGH grava o cooldown de 12h', async () => {
        const Sel = require(path.join(RAIZ, 'managers/TierSelector'));
        const { limiter } = require(path.join(RAIZ, 'managers/RateLimiter'));
        const uid = 'u2st_4';
        TierCooldown.clear(uid);
        limiter.reset('gen:HIGH:' + uid);

        const d = mensagemDuble();
        const p = Sel.perguntar({ alvo: d.msg, userId: uid, pedido: 'faz um site', timeoutMs: 300 });
        await new Promise(r => setTimeout(r, 5));
        const client = clientDuble();
        d.disparar('collect', cliqueAbrirDuble(uid, client).inter);
        await new Promise(r2 => setTimeout(r2, 5));
        client._emit('interactionCreate', cliqueTier(uid, 'HIGH'));
        const r = await p;
        assert.strictEqual(r.tier, 'HIGH');
        const cd = TierCooldown.get(uid, 'HIGH');
        assert.strictEqual(cd.bloqueado, true, 'HIGH nao gravou cooldown');
        assert.ok(cd.restanteMs > 11 * 3600000, `cooldown curto: ${cd.restanteMs}ms`);
        TierCooldown.clear(uid);
    });

    await teste('2o clique em HIGH no mesmo dia e barrado por cooldown', async () => {
        const Sel = require(path.join(RAIZ, 'managers/TierSelector'));
        const { limiter } = require(path.join(RAIZ, 'managers/RateLimiter'));
        const uid = 'u2st_5';
        TierCooldown.clear(uid);
        limiter.reset('gen:HIGH:' + uid);
        TierCooldown.set(uid, 'HIGH', 12);

        const d = mensagemDuble();
        const p = Sel.perguntar({ alvo: d.msg, userId: uid, pedido: 'faz um site', timeoutMs: 200 });
        await new Promise(r => setTimeout(r, 5));
        const client = clientDuble();
        d.disparar('collect', cliqueAbrirDuble(uid, client).inter);
        await new Promise(r2 => setTimeout(r2, 5));
        const tier = cliqueTier(uid, 'HIGH');
        client._emit('interactionCreate', tier);
        const r = await p;
        assert.strictEqual(r.tier, null, 'o tier nao devia ter sido liberado');
        const aviso = tier.respostas[0];
        assert.ok(aviso && /cooldown/i.test(aviso.content), `deveria avisar: ${JSON.stringify(aviso)}`);
        assert.strictEqual(aviso.flags, 64);
        TierCooldown.clear(uid);
    });

    await teste('tempo esgotado no ephemeral devolve expirado', async () => {
        const Sel = require(path.join(RAIZ, 'managers/TierSelector'));
        const d = mensagemDuble();
        const p = Sel.perguntar({ alvo: d.msg, userId: 'u2st_6', pedido: 'faz um site', timeoutMs: 300 });
        await new Promise(r => setTimeout(r, 5));
        // awaitReplyComponent lanca quando o tempo acaba
        const client = clientDuble();
        d.disparar('collect', cliqueAbrirDuble('u2st_6', client).inter);
        const r = await p;  // sem emitir nenhum clique: o timer é que encerra
        assert.strictEqual(r.tier, null);
        assert.strictEqual(r.expirou, true);
    });

    await teste('so o dono pode abrir o seletor', async () => {
        const Sel = require(path.join(RAIZ, 'managers/TierSelector'));
        const d = mensagemDuble();
        const p = Sel.perguntar({ alvo: d.msg, userId: 'u2st_7', pedido: 'x', timeoutMs: 40 });
        await new Promise(r => setTimeout(r, 5));
        const f = d.opts.filter;
        assert.strictEqual(f({ user: { id: 'u2st_7' }, customId: 'gen:abrir' }), true);
        assert.strictEqual(f({ user: { id: 'outro' }, customId: 'gen:abrir' }), false, 'outro usuario passou');
        d.disparar('end', { size: 0 }, 'time');
        await p;
    });

    await teste('a mensagem publica fica so com o registro do tier', async () => {
        const Sel = require(path.join(RAIZ, 'managers/TierSelector'));
        const { limiter } = require(path.join(RAIZ, 'managers/RateLimiter'));
        const uid = 'u2st_8';
        TierCooldown.clear(uid);
        limiter.reset('gen:MIN:' + uid);

        const d = mensagemDuble();
        const p = Sel.perguntar({ alvo: d.msg, userId: uid, pedido: 'faz um site', timeoutMs: 300 });
        await new Promise(r => setTimeout(r, 5));
        const client = clientDuble();
        d.disparar('collect', cliqueAbrirDuble(uid, client).inter);
        await new Promise(r2 => setTimeout(r2, 5));
        client._emit('interactionCreate', cliqueTier(uid, 'MIN'));
        await p;

        const final = d.edicoes[d.edicoes.length - 1];
        assert.ok(final.components && final.components.length === 0, 'os botoes publicos tinham de sair');
        const json = JSON.stringify(final.embeds[0].toJSON());
        assert.ok(/Geração iniciada/.test(json), `embed final: ${json}`);
        assert.ok(!/[0-9]+k tokens/.test(json), `o custo nao devia voltar pro canal: ${json}`);
    });

    await teste('API: interaction.awaitReplyComponent NAO existe nesta versao do discord.js', () => {
        // Este é o bug que matou o fluxo em produção. Chamar
        // awaitReplyComponent lançava TypeError na hora, o catch engolia e o
        // usuário via "Tempo esgotado no seletor" sem poder escolher nada.
        // O teste verifica no pacote INSTALADO, não num duble: um duble
        // com o método "certa" teria escondido o bug, foi exatamente assim
        // que ele passou na versão anterior do teste.
        const { ButtonInteraction } = require(path.join(RAIZ, 'node_modules/discord.js'));
        assert.strictEqual(
            typeof ButtonInteraction.prototype.awaitReplyComponent,
            'undefined',
            'esta versao do discord.js NAO tem awaitReplyComponent — se agora tem, o codigo precisa ser revisto'
        );
    });

    await teste('o codigo nao usa nenhum atalho de espera quebrado', () => {
        const src = fs.readFileSync(path.join(RAIZ, 'managers/TierSelector.js'), 'utf8');
        const semComentario = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        // 1. awaitReplyComponent não existe no 14.26.4
        assert.ok(!/\.awaitReplyComponent\s*\(/.test(semComentario),
            'ainda chama awaitReplyComponent (nao existe nesta versao)');
        // 2. InteractionResponse.awaitMessageComponent filtra pela mensagem
        //    publica e rejeita o clique no ephemeral
        assert.ok(!/\b(?:eph|resposta|response|r)\.awaitMessageComponent\s*\(/.test(semComentario),
            'ainda usa awaitMessageComponent da lib, cujo filtro rejeita o ephemeral');
        // 3. a espera tem que ser no evento do client
        assert.ok(/client\.on\('interactionCreate'/.test(src),
            'a espera do tier deveria ser no evento interactionCreate do client');
        assert.ok(/client\.off\('interactionCreate'/.test(src),
            'o listener tem que ser removido, senao vaza a cada geração');
    });

    await teste('o filtro exige o dono E o prefixo gen:', () => {
        // O ephemeral é privado do usuário, então user.id + prefixo de
        // customId É a amarração correta. Amarrar por id de mensagem não
        // funciona: reply() devolve InteractionResponse sem id próprio, e o
        // id do clique no ephemeral nunca bate com o da mensagem pública.
        const src = fs.readFileSync(path.join(RAIZ, 'managers/TierSelector.js'), 'utf8');
        assert.ok(/i\.user\.id !== String\(userId\)/.test(src), 'filtro sem conferir o dono');
        assert.ok(/i\.customId\.startsWith\('gen:'\)/.test(src), 'filtro sem conferir o customId');
    });

    await teste('clique de OUTRO usuario no seletor e ignorado', async () => {
        const Sel = require(path.join(RAIZ, 'managers/TierSelector'));
        const { limiter } = require(path.join(RAIZ, 'managers/RateLimiter'));
        const dono = 'u2st_dono';
        const intruso = 'u2st_intruso';
        TierCooldown.clear(dono); limiter.reset('gen:MED:' + dono);

        const client = clientDuble();
        const d = mensagemDuble();
        const p = Sel.perguntar({ alvo: d.msg, userId: dono, pedido: 'faz um site', timeoutMs: 200 });
        await new Promise(r => setTimeout(r, 5));
        d.disparar('collect', cliqueAbrirDuble(dono, client).inter);
        await new Promise(r => setTimeout(r, 5));

        // o intruso clica: tem de ser ignorado, o fluxo continua esperando
        client._emit('interactionCreate', cliqueTier(intruso, 'MED'));
        let travou = false;
        await Promise.race([
            p.then(() => { travou = true; }),
            new Promise(r => setTimeout(r, 30)),
        ]);
        assert.strictEqual(travou, false, 'o clique do intruso foi aceito como escolha de tier');

        // o dono clica: aí sim
        const tier = cliqueTier(dono, 'MED');
        client._emit('interactionCreate', tier);
        const r = await p;
        assert.strictEqual(r.tier, 'MED');
        assert.ok(tier.respostas.length, 'o dono deveria ter recebido a confirmação');
        TierCooldown.clear(dono);
    });

    await teste('o listener do client e removido depois da escolha', async () => {
        // Listener vazado no client acumula a cada geração e passa a reagir a
        // cliques de outras mensagens.
        const Sel = require(path.join(RAIZ, 'managers/TierSelector'));
        const { limiter } = require(path.join(RAIZ, 'managers/RateLimiter'));
        const uid = 'u2st_lim';
        TierCooldown.clear(uid); limiter.reset('gen:MIN:' + uid);

        const client = clientDuble();
        const d = mensagemDuble();
        const p = Sel.perguntar({ alvo: d.msg, userId: uid, pedido: 'faz um site', timeoutMs: 200 });
        await new Promise(r => setTimeout(r, 5));
        d.disparar('collect', cliqueAbrirDuble(uid, client).inter);
        await new Promise(r => setTimeout(r, 5));
        assert.strictEqual(client._ativos(), 1, 'o listener do tier deveria estar registrado');
        client._emit('interactionCreate', cliqueTier(uid, 'MIN'));
        await p;
        assert.strictEqual(client._ativos(), 0, 'o listener do tier ficou vazado no client');
    });

    await teste('a confirmacao tem quebra de linha de verdade, nao "\\n" literal', () => {
        // Regressão de digitação: o \\n dentro do template literal chegou
        // como barra-n na mensagem do Discord.
        const Sel = require(path.join(RAIZ, 'managers/TierSelector'));
        const src = fs.readFileSync(path.join(RAIZ, 'managers/TierSelector.js'), 'utf8');
        const linha = src.split('\n').find(l => l.includes('Aviso aqui quando terminar'));
        assert.ok(linha, 'nao achei a linha da confirmacao');
        assert.ok(!linha.includes('\\\\n'), `tem escape duplo, o Discord mostraria \\n literal: ${linha.trim()}`);
    });

    await teste('timeout no tier NAO deixa listener vazado', async () => {
        const Sel = require(path.join(RAIZ, 'managers/TierSelector'));
        const client = clientDuble();
        const d = mensagemDuble();
        const p = Sel.perguntar({ alvo: d.msg, userId: 'u2st_lim2', pedido: 'x', timeoutMs: 40 });
        await new Promise(r => setTimeout(r, 5));
        d.disparar('collect', cliqueAbrirDuble('u2st_lim2', client).inter);
        const r = await p;
        assert.strictEqual(r.tier, null);
        assert.strictEqual(r.expirou, true);
        assert.strictEqual(client._ativos(), 0, 'o listener ficou no client apos o timeout');
    });

    await teste('REGRESSAO: o end do max:1 nao mata o fluxo depois do clique', async () => {
        // Este é o bug que apareceu em produção: os 4 botões apareciam e o
        // clique não fazia nada. Com max:1 o discord.js emite 'end' logo
        // após despachar 'collect'; se o código resolver como "não clicou",
        // a geração morre enquanto o seletor ephemeral ainda abre.
        const Sel = require(path.join(RAIZ, 'managers/TierSelector'));
        const { limiter } = require(path.join(RAIZ, 'managers/RateLimiter'));
        const uid = 'u2st_reg';
        TierCooldown.clear(uid);
        limiter.reset('gen:MED:' + uid);

        // duble COM emitsEndNoMax: reproduz o discord.js de verdade
        const d = mensagemDuble({ emiteEndNoMax: true });
        const p = Sel.perguntar({ alvo: d.msg, userId: uid, pedido: 'faz um site', timeoutMs: 300 });
        await new Promise(r => setTimeout(r, 5));

        // dispara collect E o end(max) que vem junto
        const client = clientDuble();
        d.disparar('collect', cliqueAbrirDuble(uid, client).inter);
        await new Promise(r2 => setTimeout(r2, 5));
        client._emit('interactionCreate', cliqueTier(uid, 'MED'));

        const r = await p;
        assert.strictEqual(r.tier, 'MED',
            `o end do max:1 matou o fluxo (veio ${JSON.stringify(r)})`);
        assert.strictEqual(r.expirou, false);

        // e a mensagem do canal NÃO pode ter virado "tempo esgotado"
        const titulos = d.edicoes.map(e => {
            const t = e.embeds && e.embeds[0] ? e.embeds[0].toJSON().title : (e.content || '');
            return String(t);
        });
        assert.ok(!titulos.some(t => /Tempo esgotado/.test(t)),
            `o canal virou "tempo esgotado" mesmo com o usuario tendo clicado: ${JSON.stringify(titulos)}`);
    });

    await teste('tempo esgotado REAL (sem clique) ainda avisa o canal', async () => {
        // Contraprova do teste anterior: sem clique, o 'end' por 'time'
        // precisa continuar avisando, senão a correção vira "nunca avisa".
        const Sel = require(path.join(RAIZ, 'managers/TierSelector'));
        const d = mensagemDuble({ emiteEndNoMax: false });
        const p = Sel.perguntar({ alvo: d.msg, userId: 'u2st_nc', pedido: 'x', timeoutMs: 40 });
        await new Promise(r => setTimeout(r, 5));
        d.disparar('end', { size: 0 }, 'time');
        const r = await p;
        assert.strictEqual(r.tier, null);
        assert.strictEqual(r.expirou, true);
        const ultimo = d.edicoes[d.edicoes.length - 1];
        assert.ok(/Tempo esgotado/.test(ultimo.content || ''), `esperava aviso: ${JSON.stringify(ultimo)}`);
    });

    // ============================================================
    // RateLimiter: chave por escopo
    // ============================================================

    await teste('RateLimiter separa gen:MAX de gen:HIGH', () => {
        const { limiter, gate } = require(path.join(RAIZ, 'managers/RateLimiter'));
        limiter.reset('gen:MAX:u_rl_1');
        limiter.reset('gen:HIGH:u_rl_1');
        assert.strictEqual(gate('gen:MAX', 'u_rl_1'), null, 'primeiro MAX deveria passar');
        assert.strictEqual(typeof gate('gen:MAX', 'u_rl_1'), 'string', 'segundo MAX deveria dar aguardo (max:1)');
        assert.strictEqual(gate('gen:HIGH', 'u_rl_1'), null, 'HIGH nao pode herdar o bloqueio de MAX');
    });

    await teste('RateLimiter escopo desconhecido nao limita', () => {
        const { gate } = require(path.join(RAIZ, 'managers/RateLimiter'));
        assert.strictEqual(gate('escopo_que_nao_existe', 'u_rl_2'), null);
    });

    await teste('RateLimiter formata janela longa em horas, nao segundos', () => {
        const { limiter, gate } = require(path.join(RAIZ, 'managers/RateLimiter'));
        limiter.reset('gen:MAX:u_rl_3');
        gate('gen:MAX', 'u_rl_3');
        const msg = gate('gen:MAX', 'u_rl_3');
        assert.ok(/h/.test(msg), `esperava horas na mensagem, veio "${msg}"`);
        assert.ok(!/79140s|3600s/.test(msg), `mensagem com segundos crus: "${msg}"`);
    });

    // ============================================================
    // TierSelector: embed, botoes e cooldown
    // ============================================================

    await teste('embed lista os 4 tiers com o custo de tokens', () => {
        const { embed } = require(path.join(RAIZ, 'managers/TierSelector'));
        // O nome do campo traz o label em MAIUSCULO ("MIN") com o emoji.
        const e = embed('u_sel_1', 'faz um site').toJSON();
        const nomes = e.fields.map(f => f.name);
        for (const t of ['MIN', 'MED', 'HIGH', 'MAX']) {
            assert.ok(nomes.some(n => n.includes(t)), `embed sem o tier ${t}: ${JSON.stringify(nomes)}`);
        }
        const json = JSON.stringify(e);
        assert.ok(json.includes('4k'), 'embed sem o custo em tokens do min');
        assert.ok(json.includes('32k'), 'embed sem o custo em tokens do max');
        assert.ok(e.footer.text.includes('60'), 'embed sem o aviso de tempo');
    });

    await teste('linhaBotoes tem 4 botoes com customId no padrao do repo', () => {
        const { linhaBotoes } = require(path.join(RAIZ, 'managers/TierSelector'));
        const row = linhaBotoes('u_sel_2').toJSON();
        assert.strictEqual(row.components.length, 4, `veio ${row.components.length} botoes`);
        const ids = row.components.map(c => c.custom_id);
        assert.deepStrictEqual(ids, ['gen:MIN', 'gen:MED', 'gen:HIGH', 'gen:MAX']);
    });

    await teste('embed mostra o cooldown de HIGH e MAX bloqueados', () => {
        TierCooldown.clear('u_sel_3');
        TierCooldown.set('u_sel_3', 'MAX', 24);
        TierCooldown.set('u_sel_3', 'HIGH', 12);
        const { embed, cooldownDe } = require(path.join(RAIZ, 'managers/TierSelector'));

        // Não dá para exigir a string exata "24h": formatar devolve o que
        // resta de verdade, e um minuto pode ter passado desde o set, o que
        // produz "23h59". O que importa é o estado e o formato.
        const cdMax = cooldownDe('u_sel_3', 'MAX');
        assert.strictEqual(cdMax.bloqueado, true, 'MAX deveria estar bloqueado');
        assert.ok(/^volta em \d+h/.test(cdMax.texto), `texto de cooldown inesperado: ${cdMax.texto}`);

        const e = embed('u_sel_3', 'faz um site').toJSON();
        const porNome = Object.fromEntries(e.fields.map(f => [f.name, f.value]));
        const campoMax = Object.entries(porNome).find(([k]) => k.includes('MAX'));
        const campoHigh = Object.entries(porNome).find(([k]) => k.includes('HIGH'));
        assert.ok(campoMax, 'embed sem o campo MAX');
        assert.ok(campoHigh, 'embed sem o campo HIGH');
        assert.ok(campoMax[1].includes('cooldown'), `MAX deveria avisar o cooldown: ${campoMax[1]}`);
        assert.ok(campoHigh[1].includes('cooldown'), `HIGH deveria avisar o cooldown: ${campoHigh[1]}`);
    });

    await teste('botao de tier em cooldown vem desabilitado', () => {
        TierCooldown.clear('u_sel_4');
        TierCooldown.set('u_sel_4', 'MAX', 24);
        const { linhaBotoes } = require(path.join(RAIZ, 'managers/TierSelector'));
        const row = linhaBotoes('u_sel_4').toJSON();
        const por = Object.fromEntries(row.components.map(c => [c.custom_id, c]));
        assert.strictEqual(por['gen:MAX'].disabled, true, 'MAX em cooldown nao ficou desabilitado');
        assert.strictEqual(por['gen:HIGH'].disabled, false, 'HIGH livre nao devia estar desabilitado');
        assert.strictEqual(por['gen:MIN'].disabled, false, 'MIN nunca tem cooldown');
    });

    await teste('cooldown de um usuario nao desabilita o botao de outro', () => {
        TierCooldown.clear('u_sel_5');
        TierCooldown.set('u_sel_5', 'MAX', 24);
        const { linhaBotoes } = require(path.join(RAIZ, 'managers/TierSelector'));
        const row = linhaBotoes('u_sel_outro').toJSON();
        const por = Object.fromEntries(row.components.map(c => [c.custom_id, c]));
        assert.strictEqual(por['gen:MAX'].disabled, false, 'o cooldown vazou para outro usuario');
    });

    // ============================================================
    // Config: os valores do .env chegam no lugar
    // ============================================================

    await teste('config le os 4 tiers com os valores do .env', () => {
        const cfg = require(path.join(RAIZ, 'config'));
        assert.strictEqual(cfg.GEN_TIERS.MIN.tokens, 4000);
        assert.strictEqual(cfg.GEN_TIERS.MED.tokens, 8000);
        assert.strictEqual(cfg.GEN_TIERS.HIGH.tokens, 16000);
        assert.strictEqual(cfg.GEN_TIERS.MAX.tokens, 32000);
        assert.strictEqual(cfg.GEN_TIERS.HIGH.cooldownH, 12);
        assert.strictEqual(cfg.GEN_TIERS.MAX.cooldownH, 24);
        assert.strictEqual(cfg.GEN_TIERS.MIN.cooldownH, 0, 'min nao deve ter cooldown');
    });

    await teste('config.GEN_TIER_ORDEM vai do mais barato pro mais caro', () => {
        const cfg = require(path.join(RAIZ, 'config'));
        assert.deepStrictEqual(cfg.GEN_TIER_ORDEM, ['MIN', 'MED', 'HIGH', 'MAX']);
        for (let i = 1; i < cfg.GEN_TIER_ORDEM.length; i++) {
            const ant = cfg.GEN_TIERS[cfg.GEN_TIER_ORDEM[i - 1]];
            const at = cfg.GEN_TIERS[cfg.GEN_TIER_ORDEM[i]];
            assert.ok(at.tokens > ant.tokens, `${at.label} (${at.tokens}) nao e maior que ${ant.label} (${ant.tokens})`);
        }
    });

    await teste('TASK_FALLBACK_APOS_MS ficou abaixo do KILO_TIMEOUT_MS', () => {
        // Se o watchdog passar do abort HTTP, ele nunca dispara no caminho
        // lento e o fallback graceful vira codigo morto.
        const watchdog = parseInt(process.env.TASK_FALLBACK_APOS_MS, 10);
        const abort = parseInt(process.env.KILO_TIMEOUT_MS, 10);
        assert.ok(watchdog < abort, `watchdog ${watchdog}ms precisa ser menor que o abort ${abort}ms`);
    });

    await teste('FALLBACK_APOS_MS dos tickets cobre a latencia do modelo', () => {
        // MEDIDO no gateway com reasoning=high: o modelo principal leva
        // ~25-40s para responder. O watchdog do fallback precisa ser MAIOR
        // que isso, senão ele dispara antes da principal acabar e joga fora
        // a chamada (e a resposta vem do modelo de fallback, não o principal).
        const espera = parseInt(process.env.FALLBACK_APOS_MS, 10);
        assert.ok(espera >= 60000,
            `FALLBACK_APOS_MS=${espera}ms e menor que a latencia medida do modelo (~25-40s)`);
        // E ainda precisa ser MENOR que o abort do gateway, para o fallback
        // graceful disparar antes do cancelamento brusco.
        const abort = parseInt(process.env.KILO_TIMEOUT_MS, 10);
        assert.ok(espera < abort, `watchdog ${espera}ms precisa ser menor que o abort ${abort}ms`);
    });

    await teste('RateLimiter cleanup nao apaga bucket de janela > 1h', () => {
        const { limiter } = require(path.join(RAIZ, 'managers/RateLimiter'));
        const chave = 'gen:MAX:u_rl_4';
        limiter.reset(chave);
        limiter.take(chave, { windowMs: 24 * 3600 * 1000, max: 1 });
        limiter.cleanup();
        const b = limiter.buckets.get(chave);
        assert.ok(b && b.hits.length === 1,
            'o sweep apagou o bucket — antes o piso fixo de 1h destruia qualquer janela maior');
    });

    // ============================================================
    // limpeza
    // ============================================================

    // Limpa TUDO que o teste criou. O filtro tem que cobrir os prefixos de
    // todas as suites deste arquivo, senao os buckets de cooldown de teste
    // vazam para data/tierCooldowns.json e o proximo run começa sujo.
    for (const u of Object.keys(JSON.parse(fs.existsSync(COOLDOWN_FILE) ? fs.readFileSync(COOLDOWN_FILE, 'utf8') : '{}'))) {
        if (/^u_(teste|rl|sel|flow|dbg)/.test(u)) TierCooldown.clear(u);
    }
    if (cooldownOriginal === null) {
        try { fs.unlinkSync(COOLDOWN_FILE); } catch {}
    } else {
        fs.writeFileSync(COOLDOWN_FILE, cooldownOriginal);
    }
    fs.rmSync(TEMP, { recursive: true, force: true });

    console.log(`\n  ${passou} passaram, ${falhou} falharam`);
    process.exit(falhou ? 1 : 0);
})();
