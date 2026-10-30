/**
 * Migração dos avisos do MongoDB para data/warnings.json.
 *
 * CONTEXTO
 * Até 30/09/2026 os avisos viviam na coleção `Memory` (category 'warning').
 * Agora vivem em `data/warnings.json` — decisão do dono, porque a gravação
 * passava a depender de rede e a escada de punição não pode perder registro
 * (ver o cabeçalho de utils/warnStore.js).
 *
 * POR QUE ESTE SCRIPT EXISTE DE NOVO (corrigido em 20/10/2026)
 *
 * A migração de 30/09 NUNCA rodou. O script morria logo depois de
 * conectar, com "Operation `memories.find()` buffering timed out after
 * 10000ms": o buffer padrão do mongoose é de 10s e o cluster está LONGE
 * (a rede do Termux demora 15-26s só para o gateway do Kilo). As
 * execuções de 30/09 23:00 (logs/migracao.log, 3 conexões) foram as três
 * tentativas que morreram ali.
 *
 * Consequência silenciosa: `data/warnings.json` nasceu VAZIO e foi
 * recebendo só os avisos novos. Os 56 avisos do Mongo ficaram lá — e o
 * Mongo não é lido para contar punição. 5 usuários com 5+ avisos
 * reiniciavam a escada de punição (mute → expulsão → banimento) sozinhos,
 * sem log e sem aviso.
 *
 * O que mudou aqui:
 *   - espera a conexão REAL (asPromise) em vez de confiar no connect();
 *   - bufferTimeoutMS de 120s (era 10s, o padrão do mongoose);
 *   - connectTimeoutMS/socketTimeoutMS de 120s (o handshake TLS também
 *     demora nesta rede);
 *   - normaliza avisos já gravados sem `guildId` dentro do objeto.
 *
 * O QUE ESTE SCRIPT FAZ
 * Lê os avisos do Mongo e grava no arquivo. É idempotente: rodar de novo
 * não duplica nada (compara timestamp + chave).
 *
 * O QUE ELE NÃO FAZ
 * Não apaga nada do Mongo. O histórico antigo fica lá como backup — se a
 * migração Turns out estar errada, o dado ainda existe. Apagar é uma
 * decisão separada e manual.
 *
 *   node scripts/migrar-warnings-para-arquivo.js [--dry-run]
 */
process.env.LOG_FILE = process.env.LOG_FILE || 'migracao.log';

const mongoose = require('../database/mongo');
const WarnStore = require('../utils/warnStore');

(async () => {
    const dryRun = process.argv.includes('--dry-run');

    try {
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 60000,
            // O handshake TLS com o cluster também demora nesta rede: o
            // padrão de 30s matava a conexão antes do handshake.
            connectTimeoutMS: 120000,
            socketTimeoutMS: 120000,
        });
        // O buffer padrão do mongoose é de 10s, e o Mongo está LONGE (a
        // rede do Termux demora 15-26s para o gateway). A consulta era
        // bufferizada e MORRIA com "buffering timed out after 10000ms" —
        // sem nunca devolver um aviso. Era por isso que a migração nunca
        // rodava: as execuções de 30/09 morriam todas aqui, depois de
        // conectar.
        mongoose.set('bufferTimeoutMS', 120000);
        // Espera a conexão REAL ficar pronta (o connect() resolve antes).
        await mongoose.connection.asPromise();
        console.log('Mongo: conectado');
    } catch (e) {
        console.error('Mongo: FALHOU —', e.message);
        console.error('Sem acesso ao histórico antigo. Nada foi migrado.');
        process.exit(1);
    }

    // Lê direto do model: o db.js já não tem mais getWarnings.
    delete require.cache[require.resolve('../models/Memory')];
    const Memory = require('../models/Memory');

    const docs = await Memory.find({ category: 'warning' }).sort({ timestamp: 1 }).lean();
    console.log(`avisos no Mongo: ${docs.length}`);

    const existentes = WarnStore._carregar();
    let jaGravados = 0, novos = 0;

    // NORMALIZA: aviso gravado SEM `guildId` dentro do objeto (o formato
    // antigo, de antes do store passar a gravar o campo) herda o servidor
    // da chave. Sem isto o arquivo fica com avisos de origem desconhecida
    // e o /warnings mostra a origem errada.
    //
    // É idempotente: aviso que já tem guildId não é tocado.
    let normalizados = 0;
    for (const [chave, lista] of Object.entries(existentes)) {
        if (!Array.isArray(lista)) continue;
        const sep = chave.indexOf(':');
        const guildDaChave = sep >= 0 ? chave.slice(0, sep) : WarnStore.LEGACY_GUILD;
        for (const w of lista) {
            if (w && !w.guildId) { w.guildId = guildDaChave; normalizados++; }
        }
    }

    for (const d of docs) {
        // Aviso sem guild cai na chave de legado, que continua contável em
        // qualquer servidor. É o que os 56 avisos existentes são.
        const guildId = d.guildId && d.guildId !== 'unknown' ? d.guildId : WarnStore.LEGACY_GUILD;
        const chave = `${guildId}:${d.userId}`;
        const jaTem = Array.isArray(existentes[chave])
            && existentes[chave].some(w => w.timestamp === (d.timestamp ? new Date(d.timestamp).getTime() : 0));

        if (jaTem) { jaGravados++; continue; }
        if (!dryRun) {
            WarnStore.add(d.userId, {
                reason: d.answer,
                moderator: d.moderator || null,
                // O Mongo não guardava `auto`; os avisos do filtro automático
                // são os que têm motivo começando com "Palavra ofensiva".
                auto: /^Palavra ofensiva/.test(String(d.answer || '')),
                timestamp: d.timestamp ? new Date(d.timestamp).getTime() : Date.now(),
                guildId
            });
        }
        novos++;
    }

    // Grava a normalização (o `add()` acima já grava o que migrou).
    if (normalizados && !dryRun) {
        WarnStore._gravar(existentes);
    }

    const porUsuario = new Map();
    for (const d of docs) {
        porUsuario.set(d.userId, (porUsuario.get(d.userId) || 0) + 1);
    }
    const top = [...porUsuario.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    console.log('');
    console.log(`migrados agora:   ${novos}`);
    console.log(`já estavam lá:    ${jaGravados}`);
    console.log(`normalizados:     ${normalizados} (avisos sem guildId dentro do objeto)`);
    console.log(`usuarios afetados: ${porUsuario.size}`);
    if (top.length) console.log(`maiores historicos: ${top.map(([u, n]) => `${u}=${n}`).join(', ')}`);
    console.log(`arquivo: ${WarnStore.FILE}`);
    if (dryRun) console.log('\n(--dry-run: nada foi gravado)');

    // Confere o que a escada de punição vai ler a partir de agora.
    let conferidos = 0;
    for (const [userId, esperado] of porUsuario) {
        const lidos = WarnStore.get(userId).length;
        if (lidos !== esperado) {
            console.log(`  ⚠️ divergência em ${userId}: mongo=${esperado} arquivo=${lidos}`);
        } else conferidos++;
    }
    console.log(`\nusuarios conferidos: ${conferidos}/${porUsuario.size}`);

    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => {
    console.error('ERRO:', e.message);
    process.exit(1);
});