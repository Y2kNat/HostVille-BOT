# Central de Atendimento — onde abrir ticket

## Objetivo

Explica onde o usuário abre um ticket e quais tipos existem.

## Resposta curta (dados verificados)

- Canal da Central de Atendimento: <#1491169677970505738>
- O canal tem um painel chamado "Central de Atendimento" com 3 botões.
- Botões disponíveis: Dúvidas, Suporte, Denúncias.
- O ticket do tipo Atendimento não tem botão próprio: ele é aberto pela staff.

## Fluxo real

1. O usuário entra em <#1491169677970505738>.
2. Escolhe o botão do tipo de ticket.
3. O bot cria um canal de texto privado só para ele e para a staff.
4. O canal fica dentro da categoria de tickets `1466936076366118912`.
5. No canal, o usuário pergunta e a IA responde.
6. Para encerrar, usa o botão "🔒 Fechar Ticket" ou o comando `/close`.

## Nome dos canais de ticket

O bot cria o canal com o nome `🎫・<tipo>-<número>` com número de 4 dígitos.

| Tipo | Nome gerado |
|---|---|
| Denúncia | `🎫・denuncia-0001` |
| Suporte | `🎫・suporte-0001` |
| Dúvidas | `🎫・duvida-0001` |
| Atendimento | `🎫・atendimento-0001` |

## Botões dentro do ticket

| Botão | customId | O que faz |
|---|---|---|
| 🔒 Fechar Ticket | `ticket_close` | Encerra o ticket. |
| 🙋 Assumir | `ticket_claim` | A staff assume o atendimento. |

## Permissões do canal de ticket

O canal é criado com o `@everyone` sem poder ver. Só o dono do ticket e a staff conseguem ver e escrever. Isso significa que o ticket é privado.

## Fonte

- `db.json` → `tickets.panels` (canal `1491169677970505738`, mensagem `1521369878936944812`, título "Central de Atendimento")
- `managers/TicketManager.js` (criação do canal, categoria `1466936076366118912`, permissões, botões, padrão de nome)
- `commands/ticket/ticketsetup.js` (criação do painel)
- Verificado em 2026-09-25
