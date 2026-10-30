# Atlas — Consultar e buscar imóveis

## Respostas diretas
- **Como vejo os imóveis registrados?** Use `;list` (mostra até 10 imóveis, dá pra filtrar por bairro: `;list <bairro>`).
- **Como acho um imóvel por rua ou ID?** Use `;search <termo>` — busca por rua ou pelo ID (ex.: `;search ATLAS-1777331307737-8263`).
- **Como vejo os detalhes de um imóvel + foto?** Use `;info <id>`.
- **Como vejo MEUS imóveis?** Use `;minhasprops`.
- **Como vejo os bairros disponíveis?** `;bairros` (alias `;neighborhoods`) — mostra os bairros e quantos imóveis cada um tem.
- **Como vejo os imóveis de um bairro?** `;vizinhanca <bairro>`.
- **Como vejo as estatísticas do servidor?** `;stats`.
- **Como vejo todas as opções?** `;help`.

## Comandos (prefixo `;`)
| Comando | O que faz |
|---------|-----------|
| `;list [bairro]` | Lista imóveis (10 por vez), com filtro opcional por bairro |
| `;search <termo>` | Busca por rua ou ID |
| `;info <id>` | Detalhes do imóvel + foto |
| `;stats` | Estatísticas do servidor (imóveis etc.) |
| `;neighborhoods` / `;bairros` | Lista bairros com nº de imóveis |
| `;vizinhanca <bairro>` | Imóveis de um bairro |
| `;minhasprops` | Imóveis do usuário |
| `;help` | Central de ajuda |

## IMPORTANTE
- Não existe `/list`, `/search`, `/info` com barra. O prefixo do Atlas é **`;`**.
- Não existe `/bairros` — o certo é `;bairros`.

## Fonte
`Atlas/index.js:1070-1292` (;help a ;minhasprops).