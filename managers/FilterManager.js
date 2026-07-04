const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class FilterManager {
  
  static sensitiveCache = new Map();
  static MAX_CACHE = 10000;
  static CACHE_TTL = 5 * 60 * 1000;
  static cacheCleaner = null;

  static setCache(key, result) {
    if (this.sensitiveCache.size >= this.MAX_CACHE) {
      this.sensitiveCache.delete(this.sensitiveCache.keys().next().value);
    }
    this.sensitiveCache.set(key, { result, time: Date.now() });
  }

  static getCache(key) {
    const cached = this.sensitiveCache.get(key);
    if (cached && Date.now() - cached.time < this.CACHE_TTL) return cached.result;
    if (cached) this.sensitiveCache.delete(key);
    return null;
  }

  static init() {
    if (this.cacheCleaner) return;
    this.cacheCleaner = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.sensitiveCache) {
        if (now - value.time > this.CACHE_TTL) this.sensitiveCache.delete(key);
      }
    }, 60000);
  }

  static hardBlock = [
    'puta', 'puita', 'put0', 'poota',
    'caralho', 'car4lho', 'c4ralho', 'karalho', 'carai', 'carãi', 'karaio',
    'buceta', 'buc3ta', 'buseta', 'bct', 'bcta',
    'foda se', 'foda-se', 'fodase', 'fod4se',
    'vai se foder', 'vai tomar no cu', 'vtnc', 'tmnc', 'vsf',
    'arrombado', 'arromb4do',
    'filho da puta', 'filha da puta',
    'estupro', 'estupr0', '3stupro',
  ];

  static sensitive = [
    'foder', 'fuder', 'fder',
    'fdp', 'f d p', 'f.d.p',
    'porra', 'porã', 'fodo', 'f0do', 'porrã', 'porr4',
    'merda', 'm3rda', 'merd4',
    'desgraça', 'd3sgraça',
    'cacete', 'c4cete',
    'polla', 'rola', 'piroca',
    'bosta', 'viado', 'retardado', 'otario', 'corno',
    'puto',
    'fuck', 'fck', 'fuk',
    'shit', 'sh1t',
    'bitch', 'b1tch',
    'dick', 'd1ck',
    'cunt', 'kunt',
    'bastard', 'whore', 'slut',
  ];

  static illegal = [
    'child porn', 'childporn', 'children porn',
    'pedo', 'ped0', 'p3do', 'pedophile',
    'loli', 'l0li', 'lol1', 'shota', 'sh0ta',
    'minor', 'underage', 'und3rage',
    'rape', 'r4pe', 'r4p3', 'rap3',
    'abuse', 'abus3', 'abus0', '4buse',
    'groom', 'gr00m', 'gr0oming',
    'incest', 'inc3st',
    'zoofilia', 'z00filia', 'necrophilia', 'n3cr0',
  ];

  static normalize(text) {
    return String(text)
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
      .toLowerCase()
      .replace(/[0@º]/g, 'o').replace(/[1!|£]/g, 'i')
      .replace(/[3€]/g, 'e').replace(/[4ª]/g, 'a')
      .replace(/[5$§]/g, 's').replace(/[6]/g, 'g')
      .replace(/[7+]/g, 't').replace(/[8]/g, 'b').replace(/[9]/g, 'g')
      .replace(/[áâãàä]/g, 'a').replace(/[éêèë]/g, 'e')
      .replace(/[íìîï]/g, 'i').replace(/[óôõòö]/g, 'o')
      .replace(/[úùûü]/g, 'u').replace(/[ç]/g, 'c').replace(/[ñ]/g, 'n')
      .replace(/[._\-+,;:!?|/\\()[\]{}"'\n\r]+/g, ' ')
      .replace(/(.)\1{2,}/g, '$1$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  static phraseMatch(tokens, phraseTokens) {
    if (!phraseTokens.length || tokens.length < phraseTokens.length) return false;
    for (let i = 0; i <= tokens.length - phraseTokens.length; i++) {
      let ok = true;
      for (let j = 0; j < phraseTokens.length; j++) {
        if (tokens[i + j] !== phraseTokens[j]) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }

  static matchList(text, list, level) {
    if (!text || typeof text !== 'string') return null;
    
    // PRÉ-FILTRO NO TEXTO BRUTO
      text = text.replace(/f0d@/gi, 'fodo');
    text = text
  .replace(/^f0d@$/gi, 'foda')
  .replace(/f0d@\s/gi, 'foda ')         
  .replace(/\sf0d@$/gi, ' foda')        
  .replace(/\sf0d@\s/gi, ' foda ')      
  .replace(/v!a\s+t0mar\s+n0\s+c0/gi, 'vai tomar no cu')
  .replace(/v1tnc|vt[nm]c|v!tnc/gi, 'vai tomar no cu')
  .replace(/p0rr[@a]/gi, 'porra')
  .replace(/f0d[@a]|f0da/gi, 'foda')
  .replace(/t0mar/gi, 'tomar')
  .replace(/n0/gi, 'no')
      
  .replace(/c0/gi, 'cu');
    
    const normalized = this.normalize(text);
    const tokens = normalized.split(' ').filter(Boolean);
    
    const joinedTokens = [];
    let buffer = '';
    for (const token of tokens) {
      if (token.length === 1 && /[a-z]/.test(token)) {
        buffer += token;
      } else {
        if (buffer.length >= 3) joinedTokens.push(buffer);
        buffer = '';
        joinedTokens.push(token);
      }
    }
    if (buffer.length >= 3) joinedTokens.push(buffer);
    
    const compact = normalized.replace(/\s+/g, '');
    
    for (const item of list) {
      const normalizedItem = this.normalize(item);
      const itemTokens = normalizedItem.split(' ').filter(Boolean);
      const compactItem = normalizedItem.replace(/\s+/g, '');

      if (itemTokens.length === 1) {
        if (joinedTokens.some(t => t === normalizedItem)) {
          return { word: item, level, reason: 'exact-token-match', confidence: 0.98 };
        }
      } else if (this.phraseMatch(joinedTokens, itemTokens)) {
        return { word: item, level, reason: 'exact-phrase-match', confidence: 0.96 };
      } else if (compact.includes(compactItem)) {
        return { word: item, level, reason: 'compact-phrase-match', confidence: 0.94 };
      }
    }
    return null;
  }

  // ============================================
  // DETECTOR DE CONTEXTO
  // ============================================
  
  static isQuoted(text, word) {
    const patterns = [
      new RegExp(`["'\`«»“”].*?${word}.*?["'\`«»“”]`, 'i'),
      new RegExp(`disse\\s+["'\`].*?${word}`, 'i'),
      new RegExp(`escreveu\\s+["'\`].*?${word}`, 'i'),
      new RegExp(`digitou\\s+["'\`].*?${word}`, 'i'),
    ];
    return patterns.some(p => p.test(text));
  }

  static isAcademicOrTechnical(text) {
    const words = [
      'exemplo', 'cita', 'citação', 'citou', 'palavra', 'termo', 'termos',
      'chamado', 'chamada', 'string', 'variável', 'log', 'logs',
      'código', 'codigo', 'arquivo', 'classe', 'função', 'funcao',
      'estudando', 'estudo', 'pesquisa', 'analisa', 'artigo',
      'música', 'musica', 'meme', 'memes', 'internet',
      'aparece', 'contém', 'contem', 'foi usado', 'usada', 'usado',
      'linguagem', 'linguística', 'linguistica', 'português', 'portugues',
      'insultos', 'ofensivas', 'ofensivo', 'ofensa',
    ];
    const lower = text.toLowerCase();
    return words.some(w => lower.includes(w));
  }

  static isHumor(text) {
    const indicators = [
      'kkkk', 'kkk', '😂', '🤣', 'brincadeira', 'brinks',
      'zuera', 'zoeira', 'zoando', 'brincando',
      'mas funciona', 'mas eu gosto', 'mas é bom',
      'tá uma', 'ta uma', 'tá um', 'ta um',
    ];
    const lower = text.toLowerCase();
    return indicators.some(w => lower.includes(w));
  }

  static isMention(text, word) {
    const patterns = [
      new RegExp(`(a|o|da|do|na|no|à|ao)\\s+palavra\\s+${word}`, 'i'),
      new RegExp(`(termo|string|texto|frase)\\s+${word}`, 'i'),
      new RegExp(`${word}\\s+(aparece|contém|foi|está|esta|é)`, 'i'),
      new RegExp(`(citar|cita|citou|mencionou|digitou|escreveu|disse|mandou|enviou)\\s+(${word}|v1tnc|vtnc)`, 'i'),
      new RegExp(`${word}\\s+(como|no|na|em)`, 'i'),
    ];
    return patterns.some(p => p.test(text));
  }

  static shouldBlock(text, word) {
    // Frases claramente ofensivas NUNCA são suprimidas
    if (/(que|qual)\s+(porra|merda|bosta|caralho)\s+[ée]\s+(essa|isso|isto)/i.test(text)) return true;
    
    if (/(digitou|escreveu|mandou|enviou)\s+(v1tnc|vtnc|vai tomar no cu)/i.test(text)) return false;
    if (this.isQuoted(text, word)) return false;
    if (this.isAcademicOrTechnical(text)) return false;
    if (this.isHumor(text)) return false;
    if (this.isMention(text, word)) return false;
    return true;
  }

  // ============================================
  // ANÁLISE PRINCIPAL
  // ============================================
  static async analyze(text) {
    if (!text || typeof text !== 'string') return { offensive: false, word: null, level: null, reason: 'invalid', confidence: 0 };
    
    const illegal = this.matchList(text, this.illegal, 'illegal');
    if (illegal) return { offensive: true, ...illegal };
    
    const hard = this.matchList(text, this.hardBlock, 'hard');
    if (hard) {
      if (!this.shouldBlock(text, hard.word)) {
        return { offensive: false, word: hard.word, level: hard.level, reason: 'context-suppressed', confidence: 0.65 };
      }
      return { offensive: true, ...hard };
    }
    
    const sensitive = this.matchList(text, this.sensitive, 'sensitive');
    if (!sensitive) return { offensive: false, word: null, level: null, reason: 'clean', confidence: 0.99 };
    
    if (!this.shouldBlock(text, sensitive.word)) {
      return { offensive: false, word: sensitive.word, level: sensitive.level, reason: 'context-suppressed', confidence: 0.65 };
    }
    return { offensive: true, word: sensitive.word, level: 'sensitive', reason: 'dictionary-match', confidence: 0.95 };
  }

  static async containsOffensiveWord(text) { return (await this.analyze(text)).offensive; }
  static async findOffensiveWord(text) { const r = await this.analyze(text); return r.offensive ? r.word : null; }
}

FilterManager.init();
module.exports = FilterManager;