/**
 * Gerador de PDF das transcricoes de ticket.
 *
 * Reproduz o layout do protótipo assets/prototipo/transcricao-discord.html:
 * fundo do canal, cabecalho do ticket fixo no topo, blocos de mensagem
 * agrupados por autor, avatares, embeds com barra lateral e anexos.
 *
 * Sem dependencias externas: as fontes TTF vem de assets/fonts/ e sao
 * embutidas como CIDFontType2. Imagens PNG sao decodificadas e embutidas
 * como XObject.
 */
const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ *
 * Medidas do protótipo convertidas para pontos (1 px = 0.75 pt)
 * ------------------------------------------------------------------ */
const SCALE = 0.75;
const px = v => v * SCALE;

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_L = px(16);
const MARGIN_R = px(48);
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

/* Avatar, gap e recuo do texto (iguais ao .msg do HTML) */
const AVATAR = px(40);
const AVATAR_GAP = px(16);
const TEXT_X = MARGIN_L + AVATAR + AVATAR_GAP;

/* ------------------------------------------------------------------ *
 * Paleta (mesma do :root do protótipo)
 * ------------------------------------------------------------------ */
const CORES = {
    chatBg: '#313338',
    sidebarBg: '#2B2D31',
    elevated: '#111214',
    text: '#DBDEE1',
    textStrong: '#F2F3F5',
    muted: '#949BA4',
    faint: '#5C5E66',
    divider: '#3F4147',
    blurple: '#5865F2',
    green: '#23A55A',
    red: '#DA373C',
    yellow: '#FEE75C',
    mentionBg: '#404E6B',
    mentionTxt: '#C9DDFB',
    link: '#00A8FC',
};

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FONT_FILES = {
    regular: path.join(FONT_DIR, 'DejaVuSans.ttf'),
    bold: path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'),
};

/* ------------------------------------------------------------------ *
 * Leitura de TTF
 * ------------------------------------------------------------------ */
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

function readFont(file) {
    const buf = fs.readFileSync(file);
    const numTables = u16(buf, 4);
    const tables = {};
    for (let i = 0; i < numTables; i++) {
        const o = 12 + i * 16;
        tables[buf.toString('ascii', o, o + 4)] = { offset: u32(buf, o + 8), length: u32(buf, o + 12) };
    }
    if (!tables.head || !tables.cmap || !tables.hhea || !tables.hmtx) {
        throw new Error('fonte invalida: ' + path.basename(file));
    }

    const unitsPerEm = u16(buf, tables.head.offset + 18) || 1000;
    const indexToLocFormat = u16(buf, tables.head.offset + 50);
    const numGlyphs = u16(buf, tables.maxp.offset + 4);

    // cmap Unicode (formato 4 ou 12)
    const cmapBase = tables.cmap.offset;
    let best = null;
    const nEnc = u16(buf, cmapBase + 2);
    for (let i = 0; i < nEnc; i++) {
        const rec = cmapBase + 4 + i * 8;
        const pid = u16(buf, rec), eid = u16(buf, rec + 2);
        const off = u32(buf, rec + 4);
        const unicode = (pid === 3 && eid === 1) || (pid === 0 && eid >= 4);
        const format = u16(buf, cmapBase + off);
        if (unicode && (format === 4 || format === 12) && (!best || format === 12)) {
            best = { off: cmapBase + off, format };
        }
    }
    if (!best) throw new Error('fonte sem cmap Unicode: ' + path.basename(file));

    function lookup(cp) {
        if (best.format === 12) {
            const n = u32(buf, best.off + 12);
            let lo = 0, hi = n - 1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                const g = best.off + 16 + mid * 12;
                const s = u32(buf, g), e = u32(buf, g + 4);
                if (cp < s) hi = mid - 1;
                else if (cp > e) lo = mid + 1;
                else return u32(buf, g + 8) + (cp - s);
            }
            return 0;
        }
        const segX2 = u16(buf, best.off + 6);
        const seg = segX2 / 2;
        const endB = best.off + 14, startB = endB + segX2 + 2;
        const deltaB = startB + segX2, rangeB = deltaB + segX2;
        for (let i = 0; i < seg; i++) {
            if (cp > u16(buf, endB + i * 2)) continue;
            if (cp < u16(buf, startB + i * 2)) return 0;
            const delta = u16(buf, deltaB + i * 2);
            const ro = u16(buf, rangeB + i * 2);
            if (ro === 0) return (cp + delta) & 0xffff;
            const gi = u16(buf, rangeB + i * 2 + ro + (cp - u16(buf, startB + i * 2)) * 2);
            return gi === 0 ? 0 : (gi + delta) & 0xffff;
        }
        return 0;
    }

    // glyf / loca
    const hasGlyf = !!tables.loca && !!tables.glyf;
    const loca = [];
    if (hasGlyf) {
        const lo = tables.loca.offset;
        for (let i = 0; i <= numGlyphs; i++) {
            loca.push(indexToLocFormat === 0 ? u16(buf, lo + i * 2) * 2 : u32(buf, lo + i * 4));
        }
    }

    const numHMetrics = u16(buf, tables.hhea.offset + 34);
    const widths = [];
    for (let i = 0; i < numGlyphs; i++) {
        const w = i < numHMetrics ? u16(buf, tables.hmtx.offset + i * 4) : u16(buf, tables.hmtx.offset + (numHMetrics - 1) * 4);
        widths.push(Math.round((w * 1000) / unitsPerEm));
    }

    const contourCache = new Map();
    function glyphContours(gid) {
        if (!hasGlyf) return null;
        if (contourCache.has(gid)) return contourCache.get(gid);
        const r = computeContours(gid);
        contourCache.set(gid, r);
        return r;
    }
    function computeContours(gid) {
        const start = tables.glyf.offset + loca[gid];
        const end = tables.glyf.offset + loca[gid + 1];
        if (end <= start) return null;
        const nContours = u16(buf, start);
        let o = start + 10;
        const endPts = [];
        for (let i = 0; i < nContours; i++) { endPts.push(u16(buf, o)); o += 2; }
        o += 2;
        const nPoints = nContours ? endPts[nContours - 1] + 1 : 0;
        const flags = [];
        while (flags.length < nPoints && o < end) {
            const f = buf[o++];
            flags.push(f);
            if (f & 8) { let r = buf[o++]; while (r-- > 0) flags.push(f); }
        }
        if (flags.length < nPoints) return null;
        const xs = [], ys = [];
        let x = 0, y = 0;
        for (let i = 0; i < nPoints; i++) {
            const f = flags[i];
            if (f & 2) { const d = buf[o++]; x += (f & 16) ? d : -d; }
            else if (!(f & 16)) { x += (buf[o] << 8) | buf[o + 1]; o += 2; }
            if (f & 4) { const d = buf[o++]; y += (f & 32) ? d : -d; }
            else if (!(f & 32)) { y += (buf[o] << 8) | buf[o + 1]; o += 2; }
            xs.push(x); ys.push(y);
        }
        const contours = [];
        let s = 0;
        for (let c = 0; c < nContours; c++) {
            const e = endPts[c];
            const pts = [];
            for (let i = s; i <= e; i++) pts.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) });
            if (pts.length) {
                const firstOn = pts.findIndex(p => p.on);
                if (firstOn > 0) pts.unshift(...pts.splice(firstOn));
                if (!pts[0].on) pts.unshift(pts.pop());
            }
            contours.push(pts);
            s = e + 1;
        }
        return contours;
    }

    return { buf, lookup, widths, numGlyphs, unitsPerEm };
}

const _fonts = {};
function loadFonts() {
    if (_fonts.regular) return _fonts;
    for (const [k, f] of Object.entries(FONT_FILES)) {
        if (!fs.existsSync(f)) throw new Error('fonte nao encontrada: ' + f);
        _fonts[k] = readFont(f);
    }
    return _fonts;
}

/* ------------------------------------------------------------------ *
 * PNG
 * ------------------------------------------------------------------ */
function decodePng(buf) {
    const zlib = require('zlib');
    const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error('nao e png');

    let off = 8, ihdr = null, palette = null, trns = null;
    const idat = [];
    while (off < buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (type === 'IHDR') {
            ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
        } else if (type === 'IDAT') idat.push(data);
        else if (type === 'PLTE') palette = data;
        else if (type === 'tRNS') trns = data;
        else if (type === 'IEND') break;
        off += 12 + len;
    }
    if (!ihdr) throw new Error('png sem IHDR');
    if (ihdr.depth !== 8 || ihdr.interlace) throw new Error('png nao suportado');

    const canais = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.color];
    if (!canais) throw new Error('formato de png nao suportado');

    const raw = zlib.inflateSync(Buffer.concat(idat));
    const w = ihdr.width, h = ihdr.height, bpp = canais, stride = w * bpp;
    const out = Buffer.alloc(h * stride);
    let pos = 0;
    for (let y = 0; y < h; y++) {
        const filtro = raw[pos++];
        const linha = raw.subarray(pos, pos + stride); pos += stride;
        const atual = out.subarray(y * stride, (y + 1) * stride);
        const ant = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? atual[x - bpp] : 0;
            const b = ant ? ant[x] : 0;
            const c = ant && x >= bpp ? ant[x - bpp] : 0;
            let v = linha[x];
            if (filtro === 1) v += a;
            else if (filtro === 2) v += b;
            else if (filtro === 3) v += (a + b) >> 1;
            else if (filtro === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
            }
            atual[x] = v & 0xFF;
        }
    }

    const rgb = Buffer.alloc(w * h * 3);
    const alpha = (ihdr.color === 4 || ihdr.color === 6) ? Buffer.alloc(w * h) : null;
    for (let i = 0; i < w * h; i++) {
        let r, g, b, a = 255;
        if (ihdr.color === 0) { r = g = b = out[i]; }
        else if (ihdr.color === 4) { r = g = b = out[i * 2]; a = out[i * 2 + 1]; }
        else if (ihdr.color === 2) { r = out[i * 3]; g = out[i * 3 + 1]; b = out[i * 3 + 2]; }
        else if (ihdr.color === 6) { r = out[i * 4]; g = out[i * 4 + 1]; b = out[i * 4 + 2]; a = out[i * 4 + 3]; }
        else { const idx = out[i]; r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2]; a = trns && idx < trns.length ? trns[idx] : 255; }
        rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
        if (alpha) alpha[i] = a;
    }
    return { width: w, height: h, rgb, alpha };
}

/* ------------------------------------------------------------------ *
 * Utilidades
 * ------------------------------------------------------------------ */
function hexColor(hex) {
    let h = String(hex || '#000000').replace('#', '').trim();
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) h = '000000';
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
}

const MENTION_RE = /(<@!?\d+>|<@&\d+>|@everyone|@here|`[^`\n]+`)/g;
const ehMencao = t => /^<@!?\d+>$|^<@&\d+>$|^@everyone$|^@here$/.test(t);
const ehCodigo = t => /^`[^`\n]+`$/.test(t);

/* ================================================================== *
 * Builder
 * ================================================================== */
class PdfBuilder {
    constructor({ corFundo = CORES.chatBg } = {}) {
        this.fonts = loadFonts();
        this.corFundo = corFundo;
        this.pages = [];
        this.ops = [];
        this.y = PAGE_H - MARGIN_L;
        this._images = [];
        this._imgCache = new Map();
        this._glifos = { regular: new Set(), bold: new Set() };
    }

    get bottom() { return MARGIN_L; }
    get contentW() { return CONTENT_W; }
    get textX() { return TEXT_X; }

    /* ---------- primitivas ---------- */

    _rect(x, yTop, w, h, color) {
        const [r, g, b] = hexColor(color);
        this.ops.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg ${x.toFixed(2)} ${(yTop - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    }

    _stroke(x1, y1, x2, y2, color, w = 0.6) {
        const [r, g, b] = hexColor(color);
        this.ops.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG ${w} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
    }

    _rounded(x, yTop, w, h, r, color) {
        const [cr, cg, cb] = hexColor(color);
        const k = 0.5523 * r;
        const yB = yTop - h;
        this.ops.push(
            `${cr.toFixed(3)} ${cg.toFixed(3)} ${cb.toFixed(3)} rg ` +
            `${(x + r).toFixed(2)} ${yTop.toFixed(2)} m ` +
            `${(x + w - r).toFixed(2)} ${yTop.toFixed(2)} l ` +
            `${(x + w - r + k).toFixed(2)} ${yTop.toFixed(2)} ${(x + w).toFixed(2)} ${(yTop - r + k).toFixed(2)} ${(x + w).toFixed(2)} ${(yTop - r).toFixed(2)} c ` +
            `${(x + w).toFixed(2)} ${(yB + r).toFixed(2)} l ` +
            `${(x + w).toFixed(2)} ${(yB + r - k).toFixed(2)} ${(x + w - r + k).toFixed(2)} ${yB.toFixed(2)} ${(x + w - r).toFixed(2)} ${yB.toFixed(2)} c ` +
            `${(x + r).toFixed(2)} ${yB.toFixed(2)} l ` +
            `${(x + r - k).toFixed(2)} ${yB.toFixed(2)} ${x.toFixed(2)} ${(yB + r - k).toFixed(2)} ${x.toFixed(2)} ${(yB + r).toFixed(2)} c ` +
            `${x.toFixed(2)} ${(yTop - r).toFixed(2)} l ` +
            `${x.toFixed(2)} ${(yTop - r + k).toFixed(2)} ${(x + r - k).toFixed(2)} ${yTop.toFixed(2)} ${(x + r).toFixed(2)} ${yTop.toFixed(2)} c f`
        );
    }

    _circle(cx, cy, r, color) {
        const [cr, cg, cb] = hexColor(color);
        const k = 0.5523 * r;
        this.ops.push(
            `${cr.toFixed(3)} ${cg.toFixed(3)} ${cb.toFixed(3)} rg ` +
            `${(cx + r).toFixed(2)} ${cy.toFixed(2)} m ` +
            `${(cx + r).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx + k).toFixed(2)} ${(cy + r).toFixed(2)} ${cx.toFixed(2)} ${(cy + r).toFixed(2)} c ` +
            `${(cx - k).toFixed(2)} ${(cy + r).toFixed(2)} ${(cx - r).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx - r).toFixed(2)} ${cy.toFixed(2)} c ` +
            `${(cx - r).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx - k).toFixed(2)} ${(cy - r).toFixed(2)} ${cx.toFixed(2)} ${(cy - r).toFixed(2)} c ` +
            `${(cx + k).toFixed(2)} ${(cy - r).toFixed(2)} ${(cx + r).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx + r).toFixed(2)} ${cy.toFixed(2)} c f`
        );
    }

    /** Registra uma imagem e devolve o nome do XObject. */
    _registrarImagem(png) {
        const img = decodePng(png);
        const chave = `${img.width}x${img.height}:${img.rgb.length}:${img.alpha ? 1 : 0}`;
        if (this._imgCache.has(chave)) return this._imgCache.get(chave);
        const id = `im${this._images.length}`;
        this._images.push({ ...img, id });
        this._imgCache.set(chave, id);
        return id;
    }

    /** Desenha a imagem numa caixa (w x h), preservando proporcao. */
    _drawImage(png, x, yTop, w, h) {
        const id = this._registrarImagem(png);
        this.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(yTop - h).toFixed(2)} cm /${id} Do Q`);
    }

    _text(str, x, y, size, bold, color) {
        const f = bold ? this.fonts.bold : this.fonts.regular;
        const set = bold ? this._glifos.bold : this._glifos.regular;
        const [r, g, b] = hexColor(color);
        let hex = '';
        for (const ch of str) {
            const cp = ch.codePointAt(0);
            if (cp >= 0xd800 && cp <= 0xdfff) continue;
            const gid = f.lookup(cp);
            // sem glifo nao desenha nada: o PDF mostraria um quadrado vazio
            if (!gid) continue;
            set.add(gid);
            hex += gid.toString(16).padStart(4, '0');
        }
        if (!hex) return 0;
        this.ops.push(
            `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg ` +
            `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${hex.toUpperCase()}> Tj ET`
        );
        return this._width(str, size, bold);
    }

    _width(str, size, bold) {
        const f = bold ? this.fonts.bold : this.fonts.regular;
        let t = 0;
        for (const ch of str) {
            const cp = ch.codePointAt(0);
            if (cp >= 0xd800 && cp <= 0xdfff) continue;
            t += f.widths[f.lookup(cp)] ?? 500;
        }
        return (t * size) / 1000;
    }

    /** Texto com mencoes e codigo destacados, como o Discord faz. */
    _inline(str, x, y, size, color) {
        let cursor = x;
        for (const parte of String(str).split(MENTION_RE)) {
            if (!parte) continue;
            if (ehMencao(parte)) {
                const w = this._width(parte, size, false);
                this._rounded(cursor, y + size * 0.24, w + px(6), size * 1.16, px(2), CORES.mentionBg);
                this._text(parte, cursor + px(3), y, size, false, CORES.mentionTxt);
                cursor += w + px(6) + px(3);   // respiro dos dois lados
            } else if (ehCodigo(parte)) {
                const limpo = parte.slice(1, -1);
                const w = this._width(limpo, size * 0.9, false);
                this._rect(cursor - px(1), y + size * 0.16, w + px(6), size * 1.1, CORES.sidebarBg);
                this._text(limpo, cursor + px(2), y, size * 0.9, false, CORES.text);
                cursor += w + px(6);
            } else {
                cursor += this._text(parte, cursor, y, size, false, color);
            }
        }
        return cursor - x;
    }

    /** Largura de um token ja com o "realce" que o _inline aplica. */
    _larguraToken(tok, size) {
        if (ehMencao(tok)) return this._width(tok, size, false) + px(9);
        if (ehCodigo(tok)) return this._width(tok.slice(1, -1), size * 0.9, false) + px(8);
        return this._width(tok, size, false);
    }

    /**
     * Quebra o texto em linhas. Tokens de mencao/codigo nao sao partidos,
     * e o realce (fundo da pilula) entra na conta da largura.
     */
    wrap(str, size, maxW) {
        const out = [];
        for (const par of String(str).split('\n')) {
            if (par === '') { out.push(''); continue; }
            const tokens = par.split(/(\s+)/).filter(t => t !== '');
            let line = '';
            let larg = 0;
            for (const tk of tokens) {
                const w = this._larguraToken(tk, size);
                const eEspaco = /^\s+$/.test(tk);
                if (larg + w > maxW && line.trim()) {
                    out.push(line.replace(/\s+$/, ''));
                    line = eEspaco ? '' : tk;
                    larg = eEspaco ? 0 : w;
                } else {
                    line += tk;
                    larg += w;
                }
            }
            if (line.trim() || !out.length) out.push(line.replace(/\s+$/, ''));
        }
        return out.length ? out : [''];
    }

    _newPage() {
        this.pages.push(this.ops.join('\n'));
        this.ops = [];
        this.y = PAGE_H - MARGIN_L;
    }

    _need(h) {
        if (this.y - h < MARGIN_L) this._newPage();
    }

    get pageCount() { return Math.max(1, this.pages.length); }

    /* ---------- blocos do layout ---------- */

    /** .channel-head: nome do canal + selo a direita. */
    channelHead(nome, selo = 'Transcrição') {
        const h = px(48);
        this.y = PAGE_H - h;
        this._rect(0, PAGE_H, PAGE_W, h, CORES.chatBg);
        this._text('#', MARGIN_L, this.y - px(16), px(22), false, CORES.faint);
        const w = this._text(nome, MARGIN_L + px(20), this.y - px(17), px(15), true, CORES.textStrong);
        if (selo) {
            const sw = this._width(selo, px(11), true) + px(12);
            const sx = PAGE_W - MARGIN_R - sw;
            this._rounded(sx, this.y - px(11), sw, px(18), px(4), '#1A1B1E');
            this._text(selo, sx + px(6), this.y - px(15.5), px(11), true, CORES.muted);
        }
        this._stroke(0, this.y - h, PAGE_W, this.y - h, CORES.divider, 0.5);
        this.y = this.y - h;
    }

    /**
     * .ticket-pin: fundo escuro (#111214), titulo, metadados em 2 colunas
     * e o bloco de resumo com barra blurple.
     */
    ticketPin({ titulo, numero, meta = [], resumo = null }) {
        const PAD = px(16);
        const w = PAGE_W - PAD * 2;
        const colW = (w - px(24)) / 2;

        /* ---------- medicao ---------- */
        const FS_K = px(13);
        const LINHA = FS_K * 1.45;
        const itens = [];
        let cursor = px(12) + px(22);                    // padding + titulo

        for (let i = 0; i < meta.length; i += 2) {
            const par = meta.slice(i, i + 2);
            const med = par.map(m => {
                const kw = this._width(String(m.k), FS_K, false);
                const linhas = this.wrap(String(m.v), FS_K, colW - kw - px(6));
                return { m, kw, linhas };
            });
            const alt = Math.max(...med.map(x => x.linhas.length * LINHA));
            // guarda o DESLOCO a partir do topo da caixa
            itens.push({ med, alt, dy: cursor + px(4) });
            cursor += px(4) + alt + px(4);
        }

        let resumoDados = null;
        if (resumo) {
            const iw = w - px(8) - px(28);   // igual ao desenho
            const FS_R = px(13.5);
            const RH = FS_R * 1.45;
            const linhas = [];
            for (const [rot, val] of [['Problema relatado:', resumo.problema], ['Solução aplicada:', resumo.solucao]]) {
                const rw = this._width(rot, FS_R, true);
                linhas.push({ rot, rw, ls: this.wrap(val, FS_R, iw - rw) });
            }
            const altTitulo = px(18);
            const alt = px(10) + altTitulo + px(6)
                + linhas.reduce((s, l) => s + l.ls.length * RH + px(7), 0) + px(10);
            const dy = cursor + px(12);
            resumoDados = { linhas, alt, altTitulo, FS_R, RH, dy };
            cursor = dy + alt;
        }

        const totalH = cursor + px(14);

        /* ---------- desenho ---------- */
        this._need(totalH);
        const top = this.y;
        this._rect(0, top, PAGE_W, totalH, CORES.elevated);

        // titulo
        this._text(titulo, PAD, top - px(12) - px(13), px(15), true, CORES.textStrong);
        if (numero) {
            const wT = this._width(titulo, px(15), true);
            this._text(numero, PAD + wT + px(8), top - px(12) - px(13), px(15), false, CORES.muted);
        }

        // metadados: rotulo e valor na MESMA linha de base
        for (const item of itens) {
            item.med.forEach((x, j) => {
                const cx = PAD + j * (colW + px(24));
                x.linhas.forEach((ln, li) => {
                    const yBase = (top - item.dy - li * LINHA) - FS_K * 0.78;
                    if (li === 0) this._text(String(x.m.k), cx, yBase, FS_K, false, CORES.muted);
                    this._text(ln, cx + x.kw + px(6), yBase, FS_K, true,
                        x.m.link ? CORES.link : CORES.textStrong);
                });
            });
        }

        // resumo
        if (resumo && resumoDados) {
            const { linhas, alt, altTitulo, FS_R, RH, dy } = resumoDados;
            const rx = PAD;
            const rw = w - px(8);
            const ry = top - dy;
            this._rect(rx, ry, rw, alt, CORES.sidebarBg);
            this._rect(rx, ry, px(4), alt, CORES.blurple);
            this._text('RESUMO DO ATENDIMENTO', rx + px(14), ry - px(10) - px(9), px(12), true, CORES.blurple);
            let y = ry - px(10) - altTitulo - px(6);
            for (const l of linhas) {
                l.ls.forEach((ln, li) => {
                    const yBase = (y - li * RH) - FS_R * 0.78;
                    // o rotulo so na primeira linha, como no HTML (<b> inline)
                    if (li === 0) this._text(l.rot, rx + px(14), yBase, FS_R, true, CORES.textStrong);
                    this._text(ln, rx + px(14) + l.rw, yBase, FS_R, false, CORES.text);
                });
                y -= l.ls.length * RH + px(7);
            }
        }

        this.y = top - totalH;
        this._stroke(0, this.y, PAGE_W, this.y, CORES.divider, 0.5);
    }

    /** .day-divider: linha com o dia ao centro. */
    dayDivider(texto) {
        if (!texto) { this._need(px(20)); this.y -= px(18); return; }
        this._need(px(34));
        this.y -= px(18);
        const y = this.y - px(7);
        const w = this._width(texto, px(12), true) + px(12);
        const cx = PAGE_W / 2;
        this._stroke(MARGIN_L, y, cx - w / 2, y, CORES.divider, 0.5);
        this._stroke(cx + w / 2, y, PAGE_W - MARGIN_R, y, CORES.divider, 0.5);
        this._text(texto, cx - this._width(texto, px(12), true) / 2, y - px(3.5), px(12), true, CORES.muted);
        this.y = y - px(9);
    }

    /**
     * Desenha um bloco de mensagem/embed.
     * O yfinal e sempre y - bloco.h, porque h foi medido com a MESMA
     * formula usada aqui (garantido pelo teste de geometria).
     */
    _desenharBloco(bloco, y, FS_MSG, LH) {
        const { c, linhas } = bloco;
        if (c.tipo === 'embed') {
            this._desenharEmbed(c, y);
        } else if (c.tipo === 'embedImagem') {
            this._desenharEmbedImagem(c, y);
        } else if (c.tipo === 'anexo') {
            this._desenharAnexo(c, y);
        } else {
            let ly = y;
            for (const ln of linhas) {
                if (ln === '') { ly -= LH * 0.5; continue; }
                this._inline(ln, TEXT_X, ly - FS_MSG * 0.78, FS_MSG, CORES.text);
                ly -= LH;
            }
        }
        return y - bloco.h;
    }

    /** Avatar + nome + selo BOT + hora. Reutilizado quando o grupo e fatiado. */
    _cabecalhoGrupo({ autor, hora, avatarPng, avatarColor, bot, top, FS_NOME = px(16), FS_HORA = px(12) }) {
        const cy = top - AVATAR;
        if (avatarPng) {
            try {
                this._drawImage(avatarPng, MARGIN_L, cy, AVATAR, AVATAR);
            } catch (e) {
                this._avatarIniciais(autor, cy, avatarColor);
            }
        } else {
            this._avatarIniciais(autor, cy, avatarColor);
        }

        let x = TEXT_X;
        const yNome = top - px(16);
        x += this._text(autor, x, yNome, FS_NOME, false, CORES.textStrong);

        if (bot) {
            const t = 'BOT';
            const fsB = px(10);
            const w = this._width(t, fsB, true) + px(9);
            const hB = px(14);
            const topB = yNome - px(11.5);
            this._rounded(x + px(7), topB, w, hB, px(3), CORES.blurple);
            this._text(t, x + px(11.5), topB + hB * 0.7, fsB, true, '#FFFFFF');
            x += w + px(7);
        }

        this._text(hora, x + px(9), yNome, FS_HORA, false, CORES.faint);
    }

    /**
     * Bloco de mensagens do mesmo autor.
     * children: [{ tipo:'texto'|'embed'|'anexo'|'embedImagem', ... }]
     */
    messageGroup({ autor, hora, avatarPng = null, avatarColor = CORES.blurple, bot = false, children = [] }) {
        const FS_MSG = px(15);
        const LH = FS_MSG * 1.375;
        const FS_NOME = px(16);
        const FS_HORA = px(12);
        const GAP_CARD = px(6);

        // mede tudo
        const blocos = [];
        for (const c of children) {
            if (c.tipo === 'embed') {
                blocos.push({ c, h: this._medirEmbed(c) + GAP_CARD });
            } else if (c.tipo === 'embedImagem') {
                blocos.push({ c, h: this._medirEmbedImagem(c) + GAP_CARD });
            } else if (c.tipo === 'anexo') {
                blocos.push({ c, h: px(34) + GAP_CARD });
            } else {
                const ls = this.wrap(c.texto || '', FS_MSG, CONTENT_W - (TEXT_X - MARGIN_L) - px(48));
                blocos.push({ c, linhas: ls, h: ls.length * LH + px(4) });
            }
        }

        const hNome = px(24);
        const alturaBlocos = blocos.reduce((s, b) => s + b.h, 0);
        const alturaTotal = hNome + alturaBlocos;

        // espaco entre autores (o .msg--first do HTML)
        if (this.ops.length) this.y -= px(9);

        // Fatiamento: se o grupo inteiro nao couber, enche a pagina atual
        // com o que der e leva o resto para a proxima, repetindo o cabecalho
        // do autor. Evita aquele buraco enorme no meio da pagina.
        const cabecalho = { autor, hora, avatarPng, avatarColor, bot, FS_NOME, FS_HORA };
        let top = this.y;
        let inicio = 0;
        let repeteCabecalho = false;

        if (this.y - alturaTotal < MARGIN_L && this.ops.length) {
            // quanto cabe nesta pagina (depois do cabecalho do grupo)
            let cab = hNome;
            let i = 0;
            while (i < blocos.length && this.y - (cab + blocos[i].h) >= MARGIN_L) {
                cab += blocos[i].h;
                i++;
            }
            if (i === 0) {
                // nem o primeiro bloco cabe: pagina inteira
                this._newPage();
                top = this.y;
            } else {
                // desenha so os i primeiros e leva o resto
                this._cabecalhoGrupo({ ...cabecalho, top });
                let y = top - hNome;
                for (let k = 0; k < i; k++) {
                    y = this._desenharBloco(blocos[k], y, FS_MSG, LH);
                }
                this.y = top - (hNome + blocos.slice(0, i).reduce((s, b) => s + b.h, 0));
                this._newPage();
                inicio = i;
                repeteCabecalho = true;
                top = this.y;
            }
        }

        // avatar + nome + selo BOT + hora
        this._cabecalhoGrupo({ autor, hora, avatarPng, avatarColor, bot, top, FS_NOME, FS_HORA });

        /* conteudo */
        if (repeteCabecalho) this._cabecalhoGrupo({ ...cabecalho, top });

        let y = top - hNome;
        for (let k = inicio; k < blocos.length; k++) {
            y = this._desenharBloco(blocos[k], y, FS_MSG, LH);
        }

        this.y = top - (hNome + blocos.slice(inicio).reduce((s, b) => s + b.h, 0));
    }

    _avatarIniciais(autor, cy, cor) {
        this._circle(MARGIN_L + AVATAR / 2, cy - AVATAR / 2, AVATAR / 2, cor);
        const ini = String(autor).trim().replace(/^[^a-zA-Z0-9\u00C0-\u024F]+/, '').slice(0, 2).toUpperCase() || '?';
        const fs = px(15);
        const w = this._width(ini, fs, true);
        this._text(ini, MARGIN_L + (AVATAR - w) / 2, cy - AVATAR / 2 - fs * 0.36, fs, true, '#FFFFFF');
    }

    /* ---------- embed de texto ---------- */

    /**
     * Layout do embed: calcula as posicoes UMA vez e devolve a lista.
     * Medir e desenhar usam a MESMA lista, entao nunca divergem.
     * @returns {{alt:number, itens:Array, W:number}}
     */
    _layoutEmbed(c) {
        const W = Math.min(px(520), CONTENT_W - (TEXT_X - MARGIN_L) - px(24));
        const inner = W - px(32);
        const x0 = px(16);
        const itens = [];

        // cursor medido como "quanto falta descer" a partir do topo da caixa.
        // Cada item guarda a BASE da linha; a caixa cobre ate a base do ultimo.
        const push = (txt, yBase, x, size, bold, cor) =>
            itens.push({ t: 'txt', txt, y: yBase, x, size, bold, cor });

        let y = 0;   // 0 = topo da caixa

        // padding superior
        y += px(10);

        if (c.autor) {
            y += px(20);
            itens.push({ t: 'dot', y: y - px(10), x: x0 + px(10), r: px(10) });
            push(c.autor, y - px(3), x0 + px(26), px(14), true, CORES.textStrong);
            y += px(8);
        }

        if (c.titulo) {
            for (const ln of this.wrap(c.titulo, px(16), inner)) {
                y += px(16) * 1.3;
                push(ln, y - px(4), x0, px(16), true, CORES.textStrong);
            }
            y += px(8);
        }

        if (c.descricao) {
            for (const par of c.descricao.split('\n')) {
                for (const ln of this.wrap(par, px(14), inner)) {
                    y += px(14) * 1.35;
                    push(ln, y - px(3.5), x0, px(14), false, CORES.text);
                }
                y += px(4);
            }
        }

        if (c.campos && c.campos.length) {
            y += px(10);
            const colW = inner / 2;
            for (let i = 0; i < c.campos.length; i += 2) {
                const par = c.campos.slice(i, i + 2);
                const cols = par.map(f => ({
                    k: f.k,
                    valor: this.wrap(f.v, px(14), colW - px(20)),
                }));
                const altLinha = Math.max(...cols.map(col =>
                    px(14) * 1.3 + col.valor.length * px(14) * 1.35));

                cols.forEach((col, j) => {
                    const cx = x0 + j * colW;
                    let cy = y + px(14) * 1.3;
                    push(col.k, cy - px(3.5), cx, px(14), true, CORES.textStrong);
                    for (const ln of col.valor) {
                        cy += px(14) * 1.35;
                        push(ln, cy - px(3.5), cx, px(14), false, CORES.text);
                    }
                });

                y += altLinha + px(10);
            }
        }

        if (c.rodape) {
            y += px(10);
            push(c.rodape, y - px(2), x0, px(12), false, CORES.muted);
        }

        // fecha a caixa com folga depois da ultima linha
        const ultima = itens.length ? Math.max(...itens.map(i => i.y)) : 0;
        const alt = ultima + px(14);
        return { W, itens, alt };
    }

    _medirEmbed(c) {
        return this._layoutEmbed(c).alt;
    }

    _desenharEmbed(c, yTop) {
        const { W, itens, alt } = this._layoutEmbed(c);
        this._rect(TEXT_X, yTop, W, alt, CORES.embedBg);
        this._rect(TEXT_X, yTop, px(4), alt, c.accent || CORES.blurple);

        for (const it of itens) {
            // y = deslocamento abaixo do topo; a base da linha e yTop - y
            if (it.t === 'dot') {
                this._circle(TEXT_X + it.x, yTop - it.y, it.r, c.accent || CORES.blurple);
            } else {
                this._text(it.txt, TEXT_X + it.x, yTop - it.y, it.size, it.bold, it.cor);
            }
        }
    }

    /* ---------- embed de imagem (barra + imagem + legenda) ---------- */

    _medirEmbedImagem(c) {
        const W = Math.min(px(400), CONTENT_W - (TEXT_X - MARGIN_L) - px(24));
        const iw = W - px(8);
        const ih = c.png ? Math.max(px(60), iw * (c.ratio || 0.5625)) : px(120);
        return px(4) + ih + (c.legenda ? px(4) + px(14) + px(4) : px(6));
    }

    _desenharEmbedImagem(c, yTop) {
        const W = Math.min(px(400), CONTENT_W - (TEXT_X - MARGIN_L) - px(24));
        const h = this._medirEmbedImagem(c);
        this._rect(TEXT_X, yTop, W, h, CORES.embedBg);
        this._rect(TEXT_X, yTop, px(4), h, c.accent || CORES.green);
        if (c.png) {
            try { this._drawImage(c.png, TEXT_X + px(4), yTop - px(4), W - px(8), h - px(4) - (c.legenda ? px(18) : px(2))); } catch (e) {}
        }
        if (c.legenda) {
            this._text(c.legenda, TEXT_X + px(12), yTop - h + px(12), px(12), false, CORES.muted);
        }
    }

    /* ---------- anexo ---------- */

    _desenharAnexo(c, yTop) {
        const h = px(34);
        const w = Math.min(px(420), CONTENT_W - (TEXT_X - MARGIN_L) - px(24));
        this._rounded(TEXT_X, yTop, w, h, px(8), CORES.sidebarBg);
        this._rounded(TEXT_X, yTop, w, h, px(8), 'STROKE');
        this._text('📎', TEXT_X + px(12), yTop - px(22), px(14), false, CORES.text);
        const nome = c.nome || 'arquivo';
        this._text(nome, TEXT_X + px(34), yTop - px(22), px(14), false, CORES.link);
        if (c.tamanho) {
            const wn = this._width(nome, px(14), false);
            this._text(` · ${c.tamanho}`, TEXT_X + px(34) + wn, yTop - px(22), px(14), false, CORES.muted);
        }
    }

    /* ---------- rodapé ---------- */

    foot(texto) {
        // desce so o necessario e garante que a linha caiba na pagina
        this._need(px(44));
        this.y -= px(22);
        this._stroke(MARGIN_L, this.y + px(6), PAGE_W - MARGIN_R, this.y + px(6), CORES.divider, 0.5);
        this._text(texto, MARGIN_L, this.y - px(8), px(12), false, CORES.faint);
    }

    /* ================================================================== *
     * Montagem do arquivo
     * ================================================================== */
    build(meta = {}) {
        if (this.ops.length) this.pages.push(this.ops.join('\n'));
        if (!this.pages.length) this.pages.push('');

        const objects = [];
        const add = b => { objects.push(b); return objects.length; };

        const pagesId = add(null);

        // fontes
        // glifos realmente usados em cada variacao da fonte
        const usadosPor = { regular: new Set(), bold: new Set() };
        // reconstroi a lista percorrendo os glifos ja registrados por _text
        for (const set of [this._glifos.regular, this._glifos.bold]) {
            for (const g of set) usadosPor.regular.add(g);
        }
        this._glifos.bold.forEach(g => usadosPor.bold.add(g));

        const makeFont = (key, resName, usados) => {
            const f = this.fonts[key];
            const full = f.buf.toString('latin1');
            const fileId = add(`<< /Length ${f.buf.length} /Length1 ${f.buf.length} >>\nstream\n${full}\nendstream`);
            const descId = add(
                `<< /Type /FontDescriptor /FontName /${resName} /Flags 4 /FontBBox [-1021 -463 1793 1232] ` +
                `/ItalicAngle 0 /Ascent 928 /Descent -236 /CapHeight 700 /StemV 80 /FontFile2 ${fileId} 0 R >>`
            );
            // /W com as larguras reais agrupadas; sem isso o PDF usa /DW e
            // distorce o espacamento de todos os caracteres
            const gids = [...usados].filter(g => g > 0).sort((a, b) => a - b);
            const partes = [];
            let i = 0;
            while (i < gids.length) {
                const ini = gids[i];
                const w = f.widths[ini] ?? 500;
                let j = i;
                while (j + 1 < gids.length && f.widths[gids[j + 1]] === w) j++;
                partes.push(`${ini} ${gids[j]} ${w}`);
                i = j + 1;
            }
            const wArray = `[${partes.join(' ')}]`;
            const cidId = add(
                `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${resName} ` +
                `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
                `/FontDescriptor ${descId} 0 R /DW 1000 /W ${wArray} /CIDToGIDMap /Identity >>`
            );
            return add(
                `<< /Type /Font /Subtype /Type0 /BaseFont /${resName} /Encoding /Identity-H ` +
                `/DescendantFonts [${cidId} 0 R] >>`
            );
        };
        const f1 = makeFont('regular', 'DejaVuSans', usadosPor.regular);
        const f2 = makeFont('bold', 'DejaVuSans-Bold', usadosPor.bold);

        // imagens
        const imgRefs = [];
        for (const img of this._images) {
            const mk = (data, extra) => Buffer.concat([
                Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ${extra} /BitsPerComponent 8 /Length ${data.length} >>\nstream\n`, 'latin1'),
                data,
                Buffer.from('\nendstream', 'latin1'),
            ]);
            const smask = img.alpha ? add(mk(img.alpha, '/ColorSpace /DeviceGray')) : null;
            imgRefs.push(`/${img.id} ${add(mk(img.rgb, `/ColorSpace /DeviceRGB${smask ? ` /SMask ${smask} 0 R` : ''}`))} 0 R`);
        }
        const resImg = imgRefs.length ? ` /XObject << ${imgRefs.join(' ')} >>` : '';

        const pageIds = [];
        for (let i = 0; i < this.pages.length; i++) {
            let content = this.pages[i];
            // fundo ANTES de tudo
            const [r, g, b] = hexColor(this.corFundo);
            content = `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg 0 0 ${PAGE_W} ${PAGE_H} re f\n` + content;
            const streamId = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
            pageIds.push(add(
                `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
                `/Resources << /ProcSet [ /PDF /Text /ImageB ] /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${resImg} >> ` +
                `/Contents ${streamId} 0 R >>`
            ));
        }

        objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

        const now = new Date();
        const p = n => String(n).padStart(2, '0');
        const stamp = `D:${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
        const esc = s => String(s || '').replace(/[\\()]/g, c => '\\' + c);
        const info = add(
            `<< /Title (${esc(meta.title || 'Transcrição')}) /Author (${esc(meta.author || 'HostVille BOT')}) ` +
            `/Subject (${esc(meta.subject || '')}) /Creator (HostVille BOT) /Producer (HostVille Transcript PDF) ` +
            `/CreationDate (${stamp}) >>`
        );
        const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

        // montagem final com offsets em bytes
        const partes = [];
        let bytes = 0;
        const T = t => { const b = Buffer.from(t, 'latin1'); partes.push(b); bytes += b.length; };
        const Bin = b => { partes.push(b); bytes += b.length; };

        T('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'.replace(/\\x/g, ''));

        const offsets = [];
        objects.forEach((body, i) => {
            offsets.push(bytes);
            T(`${i + 1} 0 obj\n`);
            if (Buffer.isBuffer(body)) Bin(body); else T(body);
            T('\nendobj\n');
        });

        const xrefPos = bytes;
        let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
        for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
        xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
        T(xref);

        return Buffer.concat(partes);
    }
}

module.exports = { PdfBuilder, CORES, decodePng, PAGE_W, PAGE_H };
