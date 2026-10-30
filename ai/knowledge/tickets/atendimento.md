# Ticket de Atendimento

## Objetivo

Explica como funciona o ticket de Atendimento e o que a IA responde nele.

## Resposta curta (dados verificados)

- Tipo: Atendimento.
- Como abrir: não existe botão para o usuário abrir esse tipo. O ticket é aberto pela staff.
- Quem responde: a IA, automaticamente. Se ela não souber, aciona o cargo <@&1542509842701226017>.
- Fallback exato quando a IA não tem a informação: "Não tenho essa informação no momento. O cargo <@&1542509842701226017> vai responder sua pergunta!"

## Objetivo do ticket

É um atendimento aberto para o usuário falar e ser ajudado. A IA responde o que puder e, quando não sabe, passa a bola para o cargo responsável.

## Comportamento da IA

- Responde usando somente o conhecimento disponível, com os detalhes reais: valores, canais, comandos.
- Responde exatamente o que foi perguntado.
- Não repete tutorial do começo para quem já tem o item registrado.
- Nunca inventa resposta.

## Escalonamento

Se a informação não existir no conhecimento, a IA responde a frase de fallback acima, citando o cargo <@&1542509842701226017>, e esse cargo responde a pergunta.

## Mensagem de abertura

O bot manda uma mensagem com o título "🎓 Ticket de Atendimento" e o texto: "Este atendimento foi aberto para você. Pode perguntar o que quiser que eu te ajudo!". O rodapé diz: "Respondo automaticamente. Se eu não souber, um cargo responsável te responde."

## Fonte

- `managers/TicketAtendimento.js` (fluxo, `FALLBACK_ROLE_ID = 1542509842701226017`, mensagem de abertura, frase de fallback)
- `managers/TicketManager.js` (categoria `atendimento`, nome do canal)
- Verificado em 2026-09-25
