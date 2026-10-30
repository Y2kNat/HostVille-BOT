# Tickets — acesso, permissões e limites

## Objetivo

Reúne as regras de acesso e os limites do sistema de tickets.

## Resposta curta (dados verificados)

- Todos os tickets são privados: só o dono e a staff veem o canal.
- Categoria onde os tickets são criados: `1466936076366118912`.
- Limite configurado: 5 tickets por usuário. Atenção: esse valor está configurado, mas hoje não é aplicado na criação do ticket.
- Para fechar: botão "🔒 Fechar Ticket" ou comando `/close`.
- Para a staff assumir: botão "🙋 Assumir".

## Privacidade

O canal do ticket é criado com o `@everyone` sem permissão de ver. Só o dono do ticket e a staff recebem acesso de ver, enviar e ler histórico.

## Cargos e canais de staff

| Dado | Valor |
|---|---|
| Servidor da staff | `1519076712413925416` (Administração HostVille) |
| Canal da staff | <#1519107076943777872> |
| Cargo de staff dos tickets | <@&1392306051415539774> |
| Canal de logs | <#1483646073284198551> |

## Limite de tickets

O comando `/ticket-config` grava um valor de máximo de tickets por usuário. O valor configurado no servidor principal é **5**.

Atenção: esse limite não é verificado na criação do ticket. Na prática, hoje um usuário consegue abrir quantos tickets quiser. Não prometa ao usuário que existe um limite de 5 tickets, porque isso não está sendo aplicado.

## Comandos de ticket

| Comando | O que faz | Quem usa |
|---|---|---|
| `/close` | Fecha o ticket do canal atual, com motivo opcional. | Staff |
| `/adicionar` | Adiciona alguém ao ticket atual. O tipo de acesso 1 permite ver e ler; 2 permite ver, ler e escrever. | Staff |
| `/ticket-setup` | Cria o painel de atendimento com botões. | Staff |
| `/ticket-config` | Conecta o servidor principal ao servidor da staff, define cargo de staff, canal de logs e máximo de tickets. | Dono do bot |

## Regras

- Um ticket por assunto. Se o assunto mudar, abra outro ticket.
- Não abra ticket para conversa social. Para isso, use o chat.
- O ticket de denúncia não tem IA. Ele coleta os dados e envia para a staff.
- Depois que a denúncia é registrada, o ticket não aceita mais nada.

## Fonte

- `managers/TicketManager.js` (permissões, categoria, botões)
- `db.json` → `tickets.connections` (canais, cargo, `maxTicketsPerUser: 5`)
- `commands/ticket/close.js`, `commands/ticket/adicionar.js`, `commands/ticket/ticketconfig.js`, `commands/ticket/ticketsetup.js`
- Verificado em 2026-09-25
