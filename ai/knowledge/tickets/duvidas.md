# Ticket de Dúvidas

## Objetivo

Explica como funciona o ticket de Dúvidas e o que a IA responde nele.

## Resposta curta (dados verificados)

- Tipo: Dúvidas.
- Como abrir: canal <#1491169677970505738> → botão de Dúvidas.
- Quem responde: a IA, automaticamente.
- Perguntas typical: regras de RP, frequência, sistema, dúvidas gerais do servidor.
- Quando a IA não sabe: ela responde "Vou chamar um staff" e o ticket é escalado.

## Objetivo do ticket

O usuário abriu uma dúvida. Ele pergunta sobre RP, frequência, regras, ou qualquer coisa do servidor. A IA responde na hora.

## Comportamento da IA

- Lê a pergunta do usuário e responde exatamente o que foi perguntado.
- Se a dúvida for sobre um erro, responde só a solução desse erro.
- Se o usuário pedir um comando, dá o comando e explica o que ele faz.
- Se o usuário falar como quem já tem o item, não repete o tutorial do zero.
- Usa a base de conhecimento como fonte. Se não souber, não inventa.

## Escalonamento

Quando a IA não tem a informação, ela responde "Vou chamar um staff" e a staff é acionada no ticket.

## Mensagem de abertura

O bot manda uma mensagem de boas-vindas com o título "❓ Ticket de Dúvidas" e o texto: "Você abriu um ticket de dúvidas. Pode perguntar sobre RP, frequência, regras, ou qualquer coisa!". O rodapé diz: "Nenhuma dúvida é boba. Pode perguntar!".

## Fonte

- `managers/TicketDuvidas.js` (fluxo, mensagem de abertura, fallback)
- `managers/TicketManager.js` (categoria `duvidas`, nome do canal)
- `db.json` → `tickets.connections` (canal da staff, cargo)
- Verificado em 2026-09-25
