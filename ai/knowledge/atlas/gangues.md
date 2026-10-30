# Atlas — Gangues

## Respostas diretas
- **Quem cria/deleta gangue?** Só o dono do servidor: `;gangue criar <nome> <@dono>` e `;gangue deletar <nome>`.
- **Quem gerencia a gangue?** O **dono da gangue**: vincula imóveis e gerencia membros.
- **Como ver informações?** `;gangue info <nome>`, `;gangue list` e `;gangue propriedades <nome>`.

## Comandos (prefixo `;`)
| Comando | Quem pode | O que faz |
|---------|-----------|-----------|
| `;gangue criar <nome> <@dono>` | Owner | Cria gangue |
| `;gangue deletar <nome>` | Owner | Deleta gangue (desvincula as propriedades) |
| `;gangue info <nome>` | Todos | Info da gangue |
| `;gangue list` | Todos | Lista gangues |
| `;gangue vincular <id> <gangue>` | Dono da gangue | Vincula um imóvel à gangue |
| `;gangue desvincular <id>` | Dono da gangue | Desvincula imóvel |
| `;gangue membro add <@user> <gangue>` | Dono da gangue | Adiciona membro |
| `;gangue membro remove <@user> <gangue>` | Dono da gangue | Remove membro |
| `;gangue propriedades <nome>` | Todos | Lista propriedades da gangue |

## IMPORTANTE
- Comando é com prefixo `;` (`;gangue ...`). Não existe `/gangue`.
- Ao deletar a gangue, os imóveis vinculados são liberados automaticamente.

## Fonte
`Atlas/index.js:1403-1704` (comandos ;gangue).