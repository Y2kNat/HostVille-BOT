const zlib = require('zlib');

/**
 * Monta um .zip em memoria, sem dependencia externa.
 *
 * Casa com a filosofia de utils/PdfBuilder.js ("Sem dependencias externas"):
 * o projeto nao tem archiver/jszip/adm-zip nem como transitiva, e nao vale
 * instalar uma so pra isso. Node 20.15+ traz zlib.crc32, que e a unica peça
 * que faltava alem do deflate.
 *
 * Formato: local file header (PK\x03\x04) por arquivo, um central directory
 * (PK\x01\x02) e o EOCD (PK\x05\x06). So o metodo deflate, que e o que
 * qualquer descompactador aceita.
 */

// Assinaturas do formato ZIP
const LFH = 0x04034b50;  // local file header
const CDH = 0x02014b50;  // central directory header
const EOCD = 0x06054b50; // end of central directory
const MASCARA_DIRETORIO = 0x800;  // flag: nomes em UTF-8
const METODO_DEFLATE = 8;
const VERSAO = 20;        // 2.0 — o minimo para deflate
const VERSAO_CRIACAO = 0x031e; // 3.0 — unix, para permissões de leitura
const DOS_DATA_HORA = 0x00000021; // 1980-01-01 00:00:00, o epoch do MS-DOS

/**
 * Data/hora no formato MS-DOS (o ZIP nao tem epoch proprio).
 * @param {Date} [d]
 * @returns {{ hora:number, data:number }}
 */
function dataDos(d = new Date()) {
    const ano = Math.max(1980, d.getFullYear());
    return {
        hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2)),
        data: ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
}

/** Corta caminho do Windows e neutraliza ".." e barra inicial. */
function sanitizar(nome) {
    const limpo = String(nome == null ? '' : nome)
        .replace(/\\/g, '/')
        .replace(/^[a-zA-Z]:/, '')
        .split('/')
        .filter(p => p && p !== '.' && p !== '..')
        .join('/');
    return limpo || 'arquivo';
}

/**
 * Nome de arquivo SEGURO para gravar em disco, vindo do modelo.
 *
 * Diferente de sanitizar(): aqui o nome precisa ser gravado com
 * fs.writeFileSync, então tem que ser relativo ao diretório de destino.
 * sanitizar() serve para dentro do zip, onde ".." não escapa nada; aqui
 * escapa. "src/index.tsx" é aceito (subpasta é legítima e o chamador cria
 * o diretório), mas "../../../../tmp/EVIL.txt" precisa virar "tmp/EVIL.txt".
 *
 * @param {string} nome nome cru, possivelmente vindo de um LLM
 * @returns {string} caminho relativo sem ".." e sem raiz
 */
function nomeDeArquivo(nome) {
    let n = String(nome == null ? '' : nome).replace(/\\/g, '/').trim();

    // URL: descarta esquema e host, fica só o caminho. Sem isso
    // "http://x.com/a/b.js" virava "x.com/a/b.js" e criava uma pasta x.com
    // dentro de temp/.
    const url = n.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/]*)(\/.*)?$/);
    if (url) n = url[2] || '';
    // Prefixo de drive do Windows
    n = n.replace(/^[a-zA-Z]:/, '');
    // Tira qualquer barra inicial: o resultado precisa ser relativo
    n = n.replace(/^\/+/, '');

    const partes = n.split('/').filter(p => p && p !== '.' && p !== '..');
    // Só sobrou lixo: precisa ter pelo menos um nome com ponto de extensão
    const valido = partes.some(p => /\.\w{1,5}$/.test(p));
    if (!partes.length || !valido) return 'arquivo.txt';

    return partes.join('/');
}

/** Cria o diretório do arquivo, se faltar (src/, src/components/...). */
function garantirPasta(caminhoCompleto) {
    const fs = require('fs');
    const path = require('path');
    const pasta = path.dirname(caminhoCompleto);
    if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
    return caminhoCompleto;
}

/**
 * Cria o .zip.
 * @param {Array<{nome:string, conteudo:string|Buffer}>} arquivos
 * @param {{mtime?:Date}} [opts]
 * @returns {Buffer}
 */
function criar(arquivos, { mtime = new Date() } = {}) {
    if (!Array.isArray(arquivos) || !arquivos.length) {
        throw new Error('ZipBuilder.criar: nenhum arquivo informado');
    }

    const { hora, data } = dataDos(mtime);
    const locais = [];
    const central = [];
    let offset = 0;

    for (const arquivo of arquivos) {
        const nome = Buffer.from(sanitizar(arquivo.nome), 'utf8');
        const bruto = Buffer.isBuffer(arquivo.conteudo)
            ? arquivo.conteudo
            : Buffer.from(String(arquivo.conteudo ?? ''), 'utf8');

        const comprimido = zlib.deflateRawSync(bruto, { level: 9 });
        // Nao vale comprimir o que nao encolhe: com 1 byte a mais, o metodo
        // "store" (0) e melhor e evita deflate em arquivo minúsculo.
        const usarDeflate = comprimido.length < bruto.length;
        const dados = usarDeflate ? comprimido : bruto;
        const metodo = usarDeflate ? METODO_DEFLATE : 0;
        const crc = zlib.crc32(bruto);

        const lfh = Buffer.alloc(30);
        lfh.writeUInt32LE(LFH, 0);
        lfh.writeUInt16LE(VERSAO, 4);
        lfh.writeUInt16LE(MASCARA_DIRETORIO, 6);
        lfh.writeUInt16LE(metodo, 8);
        lfh.writeUInt16LE(hora, 10);
        lfh.writeUInt16LE(data, 12);
        lfh.writeUInt32LE(crc, 14);
        lfh.writeUInt32LE(dados.length, 18);
        lfh.writeUInt32LE(bruto.length, 22);
        lfh.writeUInt16LE(nome.length, 26);
        lfh.writeUInt16LE(0, 28); // sem campos extras
        locais.push(lfh, nome, dados);

        const cdh = Buffer.alloc(46);
        cdh.writeUInt32LE(CDH, 0);
        cdh.writeUInt16LE(VERSAO_CRIACAO, 4);
        cdh.writeUInt16LE(VERSAO, 6);
        cdh.writeUInt16LE(MASCARA_DIRETORIO, 8);
        cdh.writeUInt16LE(metodo, 10);
        cdh.writeUInt16LE(hora, 12);
        cdh.writeUInt16LE(data, 14);
        cdh.writeUInt32LE(crc, 16);
        cdh.writeUInt32LE(dados.length, 20);
        cdh.writeUInt32LE(bruto.length, 24);
        cdh.writeUInt16LE(nome.length, 28);
        cdh.writeUInt16LE(0, 30); // extras
        cdh.writeUInt16LE(0, 32); // comentario
        cdh.writeUInt16LE(0, 34); // disco
        cdh.writeUInt16LE(0, 36); // atributos internos
        cdh.writeUInt32LE(0o644 << 16, 38); // permissões unix, só leitura
        cdh.writeUInt32LE(offset, 42);
        central.push(cdh, nome);

        offset += lfh.length + nome.length + dados.length;
    }

    const cd = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD, 0);
    eocd.writeUInt16LE(0, 4);   // disco
    eocd.writeUInt16LE(0, 6);   // cd começa no disco 0
    eocd.writeUInt16LE(arquivos.length, 8);
    eocd.writeUInt16LE(arquivos.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);  // sem comentário

    return Buffer.concat([...locais, cd, eocd]);
}

/**
 * Monta o zip e o divide quando passa do teto de upload do Discord (8MB).
 * Devolve os caminhos gravados em disco; o chamador anexa e limpa.
 * @param {Array<{nome:string, conteudo:string|Buffer}>} arquivos
 * @param {string} destinoPasta
 * @param {{ nomeBase?:string, limiteBytes?:number }} [opts]
 * @returns {{ partes: Array<{caminho:string, nome:string, bytes:number}>, total:number }}
 */
function gravar(arquivos, destinoPasta, { nomeBase = 'projeto', limiteBytes = 8 * 1024 * 1024 } = {}) {
    const fs = require('fs');
    if (!fs.existsSync(destinoPasta)) fs.mkdirSync(destinoPasta, { recursive: true });

    let zip = criar(arquivos);
    let partes = [];

    if (zip.length <= limiteBytes) {
        partes = [{ buffer: zip, sufixo: '' }];
    } else {
        // Divide em lotes de arquivos: o limite é por anexo, então cada parte
        // tem que caber inteira. Sem índice (-1) o tamanho ainda não é
        // conhecido e o lote poderia estourar.
        const lotes = [];
        let atual = [];
        let atualBytes = 0;
        for (const a of arquivos) {
            const custo = Buffer.byteLength(String(a.conteudo ?? ''), 'utf8');
            if (atual.length && atualBytes + custo > limiteBytes / 2) {
                lotes.push(atual);
                atual = [];
                atualBytes = 0;
            }
            atual.push(a);
            atualBytes += custo;
        }
        if (atual.length) lotes.push(atual);
        partes = lotes.map((lote, i) => ({
            buffer: criar(lote),
            sufixo: lotes.length > 1 ? `-${i + 1}` : '',
        }));
    }

    const gravados = partes.map((p) => {
        const nome = `${nomeBase}${p.sufixo}.zip`;
        const caminho = require('path').join(destinoPasta, nome);
        fs.writeFileSync(caminho, p.buffer);
        return { caminho, nome, bytes: p.buffer.length };
    });

    return { partes: gravados, total: arquivos.length };
}

module.exports = { criar, gravar, dataDos, sanitizar, nomeDeArquivo, garantirPasta };
