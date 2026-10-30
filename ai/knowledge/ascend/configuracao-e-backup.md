# Ascend — Configuração e backup (só do dono)

## Respostas diretas
- **Configurar tudo?** `/config` — painel do dono para editar tiers, link, dias extras e configurações gerais.
- **Controlar sessão?** `/acess <data>|<hora>` — agenda/remove dia extra (`data` no formato YYYY-MM-DD), define horário (`hora` HH:MM) e, sem argumentos, alterna abrir/cancelar/fechar a sessão manual. Só o dono.
- **Backup?** `$backup` (manual, só dono). Há backup automático a cada 6h.

## IMPORTANTE
- `/config` e `/acess` são **somente owner**.
- Prefixo `$` para comandos de texto.

## Fonte
`Ascend/index.js:3019-3252` (/config, /acess), `2405-2449` ($backup), `2807-2817` (auto backup).