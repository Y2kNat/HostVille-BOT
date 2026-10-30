// ============================================================
// SYSTEM: config.js  (NÃO É ARQUIVO EXECUTADO)
// ============================================================
// Configuração de arquitetura para o futuro sistema de IA local.
// Nenhum valor real de ambiente deve ser gravado aqui.
// Variáveis reais vivem apenas nos arquivos `.env` de cada bot
// e NÃO devem ser copiadas (ver secrets.js).
// ============================================================

module.exports = {
  // Caminho raiz da base de conhecimento (leitura RAG)
  knowledgeBasePath: 'ai/knowledge',

  // Índice legível por máquina dos documentos
  indexFile: 'ai/knowledge/index.json',

  // Sistemas indexáveis por domínio
  domains: {
    ascend: 'progressão por tiers e sessões (sábados / dias extras)',
    atlas: 'imóveis RP, gangues, polícia (bairros e tipos fixos)',
    vehix: 'veículos pessoais e de trabalho por tier'
  },

  // Bot de referência por domínio (para resolução de comandos)
  bots: {
    ascend: { folder: 'Ascend', entry: 'index.js', prefix: '$' },
    atlas: { folder: 'Atlas', entry: 'index.js', prefix: ';' },
    vehix: { folder: 'Vehix', entry: 'index.js', prefix: "'" }
  },

  // OBSERVAÇÃO DE SEGURANÇA
  // Nunca incluir aqui: tokens de bot, OWNER_ID, IDs de canais/cargos,
  // URIs de banco, chaves de API ou caminhos de backup internos.
};