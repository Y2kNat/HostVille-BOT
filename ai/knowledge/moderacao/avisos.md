# Sistema de avisos (warn)

## Objetivo

Explica o sistema de avisos do bot.

## Resposta curta (dados verificados)

- Aplicar aviso: `/warn usuário motivo`
- Ver avisos: `/warnings usuário`
- Limpar todos os avisos: `/clearwarns usuário`
- Não existe limite de quantidade de avisos. Não existe punição automática por acúmulo de avisos.

## Como funciona

### `/warn`

Aplica um aviso a um membro. O motivo é obrigatório.

O bot registra: usuário avisado, motivo, qual staff aplicou e a data. Depois manda um embed com o motivo, o staff responsável e a data, e notifica o usuário.

### `/warnings`

Mostra todos os avisos de um usuário. Se o usuário não tiver nenhum aviso, o bot responde "✅ Nenhum aviso registrado."

### `/clearwarns`

Remove todos os avisos de um usuário de uma vez.

## Permissões

| Comando | Quem pode usar |
|---|---|
| `/warn` | Staff e administradores (cargos administrativos configurados no bot) |
| `/warnings` | Staff e administradores |
| `/clearwarns` | Staff e administradores |

Quem pode ser avisado: qualquer membro do servidor.

"Staff" aqui significa os cargos administrativos cadastrados no bot, não a permissão do Discord em si.

## Regras

- O motivo é obrigatório ao aplicar um aviso.
- O motivo fica registrado mesmo que o usuário seja avisado em outro ticket.
- Aviso não é punição automática. O bot não bane nem expulsa sozinho por acúmulo.
- Aviso não expira sozinho hoje.

## Fonte

- `commands/mod/warn.js` (motivo obrigatório, embed, registro)
- `commands/mod/warnings.js` (listagem, mensagem de vazio)
- `commands/mod/clearwarns.js` (limpeza)
- `db.json` → `warnings` (persistência)
- `managers/WarningManager.js`
- Verificado em 2026-09-25
