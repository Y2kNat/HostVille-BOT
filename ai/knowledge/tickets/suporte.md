# Ticket de Suporte

## Objetivo

Explica como funciona o ticket de Suporte e o que a IA responde nele.

## Resposta curta (dados verificados)

- Tipo: Suporte.
- Como abrir: canal <#1491169677970505738> → botão de Suporte.
- Quem responde: a IA, automaticamente.
- Indicação: descrever o que está acontecendo, com detalhes.
- Quando a IA não sabe: ela responde "Vou chamar um staff" e a staff é acionada.

## Objetivo do ticket

O usuário tem um problema técnico ou precisa de ajuda prática. Ele descreve o que está acontecendo e a IA tenta resolver.

## Diferença para Dúvidas

| | Dúvidas | Suporte |
|---|---|---|
| O usuário quer | Entender como algo funciona | Resolver algo que está dando errado |
| Mensagem de abertura | "Pode perguntar sobre RP, frequência, regras..." | "Pode falar o que está acontecendo que vou te ajudar!" |
| Rodapé | "Nenhuma dúvida é boba" | "Descreva seu problema em detalhes" |

Se a dúvida for "como funciona X", é Dúvidas. Se for "X está dando erro e não consigo", é Suporte.

## Comportamento da IA

- Responde exatamente o que foi perguntado: erro → só a solução; comando → o comando e o que faz.
- Não repete tutorial do zero para quem já tem o item registrado.
- Usa a base de conhecimento como fonte e não inventa resposta.

## Escalonamento

Quando a IA não tem a informação, responde "Vou chamar um staff".

## Mensagem de abertura

O bot manda uma mensagem com o título "🆘 Ticket de Suporte" e o texto: "Você abriu um ticket de suporte. Pode falar o que está acontecendo que vou te ajudar!".

## Fonte

- `managers/TicketSuporte.js` (fluxo, mensagem de abertura, fallback)
- `managers/TicketManager.js` (categoria `suporte`, nome do canal)
- Verificado em 2026-09-25
