# Vehix — Sistema de Veículos (visão para o usuário)

## O que é
O **Vehix** é o sistema de **registro de veículos** do servidor. Cada veículo tem **placa**, **modelo**, **cor**, **ano** e **preço**, e o registro é por **tier** (cada tier tem limite de veículos pessoais e teto de preço).

## Respostas diretas
- **Onde registro meu veículo?** Clicando no botão **"Registrar Veículo"** no painel do canal <#1490896133982257152>. Não é por comando de texto.
- **Onde os veículos aparecem?**
  - Veículos **pessoais**: <#1491018710247542834>.
  - Veículos de **trabalho**: <#1501248576938967170>.
- **Precisa de algo para registrar?** Sim — precisa ter **cargo de tier** (participe das sessões aos sábados).
- **Posso registrar qualquer preço?** Não — o preço não pode passar do **teto do seu tier**.

## Comandos do Vehix (prefixo `'` — aspa simples)
`'help` (alias `'ajuda`, `'comandos`), `'listar` (alias `'listvehicles`), `'buscar` (alias `'searchvehicle`), `'stats` (alias `'estatisticas`).

Apenas dono/admin: `'deletar`, `'remover`, `'repost`/`'reenviar`, `'restaurar`/`'restore`, `'verify`, `'bloquear`, `'desbloquear`, `'bloqueadas`, `'limpar`, `'exportar`/`'exportdata`, `'backup`, `'anunciar`, `'sandbox`/`'arena` (manutenção/teste), além dos slash `/register`, `/registered`, `/workcars` (só owner).

## Comandos que NÃO existem
- `/registrar-veiculo`, `/veiculo` — o registro é pelo **botão do painel**.
- Não existe lista fixa de categorias (SUV, Esportivo etc.) nem listas de modelos/cores — esses campos são **texto livre**.

## Fonte
`Vehix/modules/config.js` (prefixo `'`), `Vehix/data/guilds.json` (canais).