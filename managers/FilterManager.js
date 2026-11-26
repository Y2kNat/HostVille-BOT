/**
 * FilterManager — casca de persistência.
 *
 * Antes este arquivo tinha TODO o motor de matching. Agora o motor é
 * utils/moderation/OffensiveEngine.js. O que sobra aqui é o que depende de
 * estado: as palavras customizadas que a staff cadastra via /filter, com
 * cache TTL, e a inicialização.
 *
 * Nenhum outro módulo deve usar os arrays hardBlock/sensitive/illegal: o
 * conhecimento está em data/offensiveWords.js.
 */

const db = require('../database/db');
const config = require('../config');
const engine = require('../utils/moderation/OffensiveEngine');
const { DECISION } = require('../utils/moderation/constants');

class FilterManager {

  static sensitiveCache = new Map();
  static MAX_CACHE = 1000;
  static CACHE_TTL = 5 * 60 * 1000;
  static cacheCleaner = null;

  // Palavras banidas pelo staff (db.getCustomWords), cacheadas com TTL.
  // POR SERVIDOR: a lista é `{ guildId: [palavras] }`. Antes era um array
  // único, e o admin de um servidor mudava o filtro de todos.
  static customWords = {};
  static customWordsLoadedAt = 0;
  static CUSTOM_WORDS_TTL = 2 * 60 * 1000;

  // Canais com o filtro desligado (via /filter disable). Cacheado como as
  // customWords: uma consulta ao banco a cada 2 min, não a cada mensagem.
  static channelModeration = {};
  static channelModerationAt = 0;
  static CHANNEL_TTL = 2 * 60 * 1000;

  /**
   * ERRO A (corrigido) — o refresh nunca carregava nada.
   *
   * A versão anterior fazia `Object.keys(db)`, onde `db` é o MÓDULO
   * exportado por database/db.js. `Object.keys` de um módulo devolve os
   * NOMES DAS FUNÇÕES (`['db', 'getCustomWords', 'addCustomWord', ...]`),
   * nunca um ID de guild. O laço chamava `getChannelModeration('ban')` e
   * guardava `{}` em `this.channelModeration['ban']`.
   *
   * Ou seja: o mapa por canal vivia só na sessão onde alguém rodou
   * `/filter disable`. Depois de um restart, todo canal voltava a moderar
   * sem que ninguém tivesse ligado nada de novo.
   *
   * A fonte da lista de servidores é o client do gateway. `global.client` é
   * publicado no ready.js; fora dele (teste, script) cai para o que já está
   * em cache, e o refresh force ainda funciona para quem souber o guildId.
   */
  static guildIdsConhecidos() {
    const ids = new Set();
    const client = global.client;
    if (client?.guilds?.cache) {
      for (const id of client.guilds.cache.keys()) ids.add(String(id));
    }
    for (const id of Object.keys(this.channelModeration)) ids.add(String(id));
    for (const id of Object.keys(this.customWords)) ids.add(String(id));
    return [...ids];
  }

  static async refreshChannelModeration(force = false) {
    const now = Date.now();
    if (!force && now - this.channelModerationAt < this.CHANNEL_TTL) return this.channelModeration;
    try {
      const db = require('../database/db');
      const guildIds = this.guildIdsConhecidos();
      const vistos = new Set();
      for (const g of guildIds) {
        try {
          const map = await db.getChannelModeration(g);
          this.channelModeration[g] = map;
          vistos.add(String(g));
        } catch (e) { /* guild sem config */ }
      }
      // Servidor que saiu do bot não pode continuar entrando no `map` do
      // `isChannelEnabled` — mas também não vale a pena apagar a config dele
      // do cache, porque ele pode estar só com o gateway frio.
      this.channelModerationAt = now;
      return this.channelModeration;
    } catch (e) { /* banco fora: segue com o que tem em cache */ }
    return this.channelModeration;
  }

  /** O filtro roda neste canal? */
  static isChannelEnabled(guildId, channelId) {
    const map = this.channelModeration[guildId];
    if (!map) return true;              // sem config = filtro ligado
    return !map[String(channelId)];      // true no map = desligado
  }

  static async setChannelModeration(guildId, channelId, disabled) {
    const db = require('../database/db');
    const map = await db.setChannelModeration(guildId, channelId, disabled);
    this.channelModeration[guildId] = map;
    this.channelModerationAt = Date.now();
    return map;
  }

  static async refreshCustomWords(force = false) {
    if (!force && Date.now() - this.customWordsLoadedAt < this.CUSTOM_WORDS_TTL) return this.customWords;
    try {
      const db = require('../database/db');
      const guildIds = this.guildIdsConhecidos();
      for (const g of guildIds) {
        try {
          const words = await db.getCustomWords(g);
          this.customWords[g] = Array.isArray(words)
            ? words.filter(w => typeof w === 'string' && w.trim())
            : [];
        } catch (e) { /* banco fora para este servidor */ }
      }
      this.customWordsLoadedAt = Date.now();
    } catch (e) {
      this.customWords = this.customWords || {};
    }
    return this.customWords;
  }

  /** Palavras do servidor. Sem guildId, não devolve nada: o filtro de
   *  palavra é de servidor, e devolver a lista errada é pior que devolver
   *  vazia (é o que punia gente em um servidor por palavra de outro). */
  static async wordsFor(guildId) {
    await this.refreshCustomWords();
    if (!guildId) return [];
    return this.customWords[String(guildId)] || [];
  }

  static async addWord(guildId, word) {
    const db = require('../database/db');
    const added = await db.addCustomWord(guildId, word);
    await this.refreshCustomWords(true);
    return added;
  }

  static async removeWord(guildId, word) {
    const db = require('../database/db');
    await db.removeCustomWord(guildId, word);
    await this.refreshCustomWords(true);
    return true;
  }

  static init() {
    if (this.cacheCleaner) return;
    this.refreshCustomWords(true);
    this.refreshChannelModeration(true);
    this.cacheCleaner = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.sensitiveCache) {
        if (now - value.time > this.CACHE_TTL) this.sensitiveCache.delete(key);
      }
      this.refreshCustomWords();
      this.refreshChannelModeration();
    }, 60000);
    if (this.cacheCleaner.unref) this.cacheCleaner.unref();
  }

  /**
   * Análise completa. API principal do módulo.
   *
   * @param {string} text
   * @param {object} [opts] { guildId, debug }
   * @returns {Promise<object>} resultado do engine, com customWords aplicadas
   */
  static async analyze(text, opts = {}) {
    if (!text || typeof text !== 'string') {
      return engine.analyze('', opts);
    }
    const customWords = await this.wordsFor(opts.guildId);
    return engine.analyze(text, {
      ...opts,
      customWords
    });
  }

  /**
   * Decide uma mensagem, resolvendo a parte ambígua com o classificador.
   *
   * Regra de punição: só pune com DECISÃO FINAL. Se a IA ficou
   * indisponível, o resultado volta needs_review e NADA é apagado — uma
   * queda do gateway não pode gerar warn.
   *
   * @param {string} text
   * @param {object} [opts] { guildId, debug }
   * @returns {Promise<object>}
   */
  static async decide(text, opts = {}) {
    const base = await this.analyze(text, opts);
    if (config.MODERATION_AI_ALL) return base;
    if (!base.requiresAI) return base;

    const Classifier = require('./ModerationClassifier');
    return Classifier.classifyAmbiguous(text, base, opts);
  }

  /** Só uma decisão final pode punir. */
  static shouldPunish(result) {
    return !!(result && result.flagged && result.decision === DECISION.FINAL);
  }

  /** Termo mais forte encontrado, para a mensagem de aviso à staff. */
  static findOffensiveWord(result) {
    if (!result || !Array.isArray(result.matched) || !result.matched.length) return null;
    const ranked = result.matched.slice().sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    return ranked[0].text;
  }

}

if (!FilterManager.cacheCleaner) FilterManager.init();
module.exports = FilterManager;
