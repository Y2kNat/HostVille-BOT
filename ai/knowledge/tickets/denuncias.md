# Ticket de Denúncia

## Objetivo

Explica como funciona o ticket de Denúncia. Importante: este ticket NÃO usa IA. Ele é um formulário guiado.

## Resposta curta (dados verificados)

- Tipo: Denúncia.
- Como abrir: canal <#1491169677970505738> → botão de Denúncias.
- Quem responde: a staff. Não existe IA neste ticket.
- O bot faz 3 perguntas, uma de cada vez, e envia o resumo para a staff.

## Fluxo real (3 perguntas)

| Etapa | Pergunta que o bot faz | O que é validado |
|---|---|---|
| 1️⃣ | "Quem você deseja denunciar?" (nome ou ID do jogador) | Mínimo 2 caracteres. Guarda até 256. |
| 2️⃣ | "Qual o motivo da denúncia?" (descreva o que aconteceu) | Mínimo 10 caracteres. Guarda até 1024. |
| 3️⃣ | "Você tem provas?" (prints, vídeos, testemunhas) | Aceita links, descrições e imagens anexadas. |

Depois da 3ª resposta o bot envia o resumo para a staff e confirma com o embed "✅ Denúncia Registrada".

O resumo enviado à staff vai para o canal <#1519107076943777872> e menciona o cargo <@&1392306051415539774>, com os campos: Denunciante, Ticket, Servidor, Quando, Denunciado, Motivo e Provas.

Se o envio para a staff falhar, o bot mantém a denúncia aberta na etapa 3 e pede para o usuário tentar de novo mais tarde.

Depois de concluída, a denúncia não aceita mais nada naquele ticket. O bot responde que a denúncia já foi registrada e que, se precisar, o usuário deve abrir um novo ticket.

## Mensagem de abertura

O bot manda uma mensagem com o título "🚨 Ticket de Denúncia" e o texto: "Você abriu um ticket de denúncia. Vamos seguir alguns passos para registrar sua denúncia corretamente." O rodapé diz: "Todas as informações são confidenciais".

## Diferença para os outros tickets

| | Dúvidas | Suporte | Atendimento | Denúncia |
|---|---|---|---|---|
| IA responde | Sim | Sim | Sim | **Não** |
| Tipo de interação | Pergunta | Problema | Pergunta | Formulário guiado |
| Coleta de dados | Não | Não | Não | Sim: acusado, motivo, provas |

## Fonte

- `managers/TicketDenuncias.js` (as 4 etapas, validações, envio à staff, ausência de IA)
- `managers/TicketManager.js` (categoria `denuncias`, nome do canal)
- Verificado em 2026-09-25
