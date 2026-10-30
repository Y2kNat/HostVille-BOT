# Vehix — Comandos (resumo)

## Prefixo: `'` (aspa simples)
`'help` (`'ajuda`, `'comandos`) — central de ajuda.

| Comando | O que faz | Quem usa |
|---------|-----------|----------|
| `'listar` | Lista veículos (paginado) | Todos |
| `'buscar <placa/id>` | Busca veículo | Todos |
| `'stats` | Estatísticas do servidor | Todos |
| `'deletar <id>` | Remove veículo | Só owner/admin |
| `'bloquear <placa> [motivo]` | Bloqueia placa | Só owner |
| `'desbloquear <placa>` | Desbloqueia placa | Só owner |
| `'bloqueadas` | Lista placas bloqueadas | Só owner |

## Slash (só owner)
`/register #canal` — canal do painel de registro; `/registered #canal` — canal de veículos pessoais; `/workcars #canal` — canal de veículos de trabalho.

## IMPORTANTE
- Prefixo é **`'`** — não existe `/help` etc. para usuário.
- Registrar veículo é feito pelo **botão do painel** no <#1490896133982257152>, não por comando.

## Fonte
`Vehix/modules/prefixCommands.js:1046-1128` (;help), `Vehix/modules/interactions.js`, `Vehix/modules/interactions.js`.