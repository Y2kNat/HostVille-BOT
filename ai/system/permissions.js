// ============================================================
// SYSTEM: permissions.js  (FONTE ÚNICA — este arquivo É lido)
// ============================================================
// PUBLIC  = a IA explica e orienta usuários comuns
// ADMIN   = a IA explica, mas SEMPRE dizendo quem pode usar
//           (ex.: "'deletar <id> — somente owner/admin").
//           Antes este arquivo proibia explicar comandos admin;
//           isso conflitava com o objetivo do bot de suporte,
//           que é responder a pergunta do usuário. A restrição
//           que permanece é não ensinar a OPERAR coisa restrita
//           a terceiros (backup, restauração, limpeza de dados).
// ============================================================

module.exports = {
  // Comandos que a IA pode explicar e orientar usuários comuns
  publicCommands: [
    // Ascend
    '$ping', '$tier', '$sessoes', '$ranking', '$top', '$link', '$info',
    '$help', '$ajuda', '/mytier', 'request_link', 'link_modal',
    // Atlas (membros)
    ';help', ';list', ';search', ';info', ';stats', ';neighborhoods',
    ';bairros', ';vizinhanca', ';minhasprops', ';status', ';reformar',
    ';abandonar', ';invadir', ';gangue info|list|vincular|desvincular|membro|propriedades',
    // Vehix botão
    'register_vehicle', 'vehicle_modal', 'vehicle_type_select'
  ],

  // Comandos restritos — a IA pode dizer QUE existem e são de acesso
  // restrito, mas não ensinar o funcionamento a usuários comuns.
  adminCommands: [
    // Ascend (owner)
    '/config', '/acess', '$backup', 'cfg_geral', 'cfg_session', 'cfg_date',
    'cfg_link', 'cfg_tier', 'access_day', 'link_config', 'config_geral',
    // Atlas (owner e/ou cargos)
    '/houseregister', '/housechannel', ';gangue criar', ';gangue deletar',
    ';policia', ';interditar', ';investigar', ';liberar', ';delete',
    ';backup', ';export', ';exportar',
    // Vehix (owner; delete também Admin)
    '/register', '/registered', '/workcars',
    "'stats", "'listvehicles", "'listar", "'searchvehicle", "'buscar",
    "'reenviar", "'repost", "'restaurar_veiculos", "'blockplate", "'bloquear",
    "'unblockplate", "'desbloquear", "'listblocked", "'bloqueadas",
    "'cleanup", "'limpar", "'broadcast", "'anunciar", "'verify", "'verificar",
    "'exportdata", "'exportar", "'backup", "'restaurar", "'restore",
    "'deletevehicle", "'deletar", "'remover"
  ],

  // NUNCA executar / são funções internas dos bots
  internalOnly: [
    'updateLinkPanel',        // Ascend — re-renderiza painel
    'createBackup',           // Ascend/Atlas/Vehix
    'TierManager.promote',    // Ascend
    'verifyAndClean',         // Vehix
    'DB', 'db.*', 'setConfig', 'clearDBCache',
    'downloadImage'           // Atlas — baixa imagem do registro
  ],
};