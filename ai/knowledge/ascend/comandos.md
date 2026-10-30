# Ascend — Todos os comandos

## Prefixo: `$` (cifrão)

| Comando | O que faz | Quem usa |
|---------|-----------|----------|
| `$ping` | Latência do bot | Todos |
| `$tier [@user]` | Ver tier de um usuário | Todos |
| `$sessoes [@user]` | Sessões, tier e ranking de alguém | Todos |
| `$ranking` / `$top` | Top 10 por tier/sessões | Todos |
| `$link` | Solicitar o link da sessão (igual ao botão) | Todos |
| `$info` | Info do bot e config atual | Todos |
| `$backup` | Backup manual | Só owner |
| `$help` / `$ajuda` | Central de ajuda | Todos |

## Slash
| Comando | O que faz | Quem usa |
|---------|-----------|----------|
| `/mytier` | Seu perfil de tier/progresso | Todos |
| `/config` | Painel de configuração | Só owner |
| `/acess` | Controla sessão/dias extras | Só owner |

## IMPORTANTE
- Prefixo é **`$`**, não `!` nem `/`.
- Não existem `/tier`, `/sessoes`, `/ranking`, `/link`.

## Fonte
`Ascend/index.js:1897-2501` (slashes + prefix), `3037-3252` (handlers).