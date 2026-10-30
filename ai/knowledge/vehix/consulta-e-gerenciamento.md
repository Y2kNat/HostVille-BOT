# Vehix — Consultar e gerenciar veículos

## Respostas diretas
- **Como vejo os veículos do servidor?** `'listar` (paginado, 5 por página com botões).
- **Como busco um veículo?** `'buscar <placa ou id>`.
- **Como vejo as estatísticas?** `'stats`.
- **Como deletar um veículo?** `'deletar <id>` — **somente owner/admin**.
- **Bloquear uma placa?** `'bloquear <placa> [motivo]` (owner); `'desbloquear <placa>`; ver bloqueadas com `'bloqueadas`.

## Comandos (prefixo `'` — aspa simples)
`'help`/`'ajuda`/`'comandos`, `'listar`/`'listvehicles`, `'buscar`/`'searchvehicle`, `'stats`/`'estatisticas`, `'boost`/`'booster`.

**Owner/admin:** `'deletar`/`'deletevehicle`, `'remover`, `'repost`/`'reenviar`, `'restaurar`/`'restore`, `'verify`/`'verificar`, `'bloquear`/`'desbloquear`/`'bloqueadas`, `'limpar`/`'cleanup`, `'antigos` (registros com +30 dias), `'orfaos` (dados de quem saiu do servidor), `'exportar`/`'exportdata`, `'backup`, `'anunciar`/`'broadcast`, `'sandbox`/`'arena`.

**Slash (só owner):** `/register #canal`, `/registered #canal`, `/workcars #canal`, `/delete-channel #canal` (canal do painel de retirada), `/listuser @user` (lista os veículos de alguém).

## IMPORTANTE
- Prefixo é **`'`** (aspa simples). Não existe `/listar` etc.
- Não existe comando de **edição** de veículo — só deletar (owner/admin).
- Para apagar o **seu próprio** veículo existe o botão no painel de retirada (<#1553042999720542218>), com limite semanal. Ver doc de booster e retirada.

## Fonte
`Vehix/modules/prefixCommands.js`; `Vehix/modules/storage.js`, `Vehix/modules/panels.js`; `Vehix/modules/interactions.js`.