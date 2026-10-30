// ============================================================
// SYSTEM: secrets.js  (NUNCA preencher com valores reais)
// ============================================================
// Lista de NOMES das variáveis de ambiente usadas por cada bot.
// Os VALORES vivem somente nos arquivos `.env` de cada bot e JAMAIS
// devem ser lidos, copiados, persistidos ou informados pela IA.
// Este arquivo documenta apenas a NOMENCLATURA, para entendimento.
// ============================================================

module.exports = {
  envVarNames: {
    ascend: [
      'DISCORD_TOKEN', 'OWNER_ID', 'LINK_CHANNEL', 'LOG_CHANNEL',
      'TIER_1', 'TIER_2', 'TIER_3', 'TIER_4', 'TIER_5', 'TIER_6', 'TIER_7',
      'TIER_1_SESSION', 'TIER_2_SESSION', 'TIER_3_SESSION', 'TIER_4_SESSION',
      'TIER_5_SESSION', 'TIER_6_SESSIONS', 'TIER_7_SESSIONS'
    ],
    atlas: ['TOKEN', 'OWNER_ID'],
    vehix: [
      'TOKEN', 'OWNER_ID',
      'TIER_1_ROLE', 'TIER_2_ROLE', 'TIER_3_ROLE', 'TIER_4_ROLE',
      'TIER_5_ROLE', 'TIER_6_ROLE', 'TIER_7_ROLE',
      'TIER_1_MAX_PRICE', 'TIER_2_MAX_PRICE', 'TIER_3_MAX_PRICE',
      'TIER_4_MAX_PRICE', 'TIER_5_MAX_PRICE', 'TIER_6_MAX_PRICE',
      'TIER_7_MAX_PRICE',
      'TIER_1_SESSIONS', 'TIER_2_SESSIONS', 'TIER_3_SESSIONS',
      'TIER_4_SESSIONS', 'TIER_5_SESSIONS', 'TIER_6_SESSIONS',
      'TIER_7_SESSIONS',
      'SELF_DELETE_WEEKLY_LIMIT', 'SELF_DELETE_TIMEZONE',
      'BOOST_LEVEL_1_ROLE', 'BOOST_LEVEL_2_ROLE', 'BOOST_LEVEL_3_ROLE',
      'BOOST_NOTIFICATION_CHANNEL_ID', 'VERIFY_ON_STARTUP',
      'REPUBLISH_PANELS_ON_STARTUP'
    ]
  },

  // REGRAS
  processingRules: [
    'Nunca exibir o valor de qualquer variável de ambiente.',
    'Se um valor exposto aparecer no texto, substituir por "[segredo oculto]".',
    'Arquivos .env não devem ser citados além do nome da variável.',
    'IDs reais do único servidor (guild, canais, cargos, tiers) estão documentados na KB; dados de USUÁRIOS e segredos continuam fora.'
  ]
};