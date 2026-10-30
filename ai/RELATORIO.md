# Relatório Final — Análise dos Bots e Knowledge Base

> Gerado após auditoria profunda de `Ascend/index.js`, `Atlas/index.js` e
> `Vehix/index.js` **e dos JSONs de configuração** (`data/configs/**`,
> `data/guilds/**/config.json`, `data/guilds.json`). Nenhum arquivo `.env`, log
> ou dado de usuário foi lido. A Knowledge Base foi **reconstruída do zero** em
> docs granulares, todos com `## Fonte` apontando faixas de linhas verificadas
> no código ou o caminho+chave da configuração quando o valor vem de um JSON.

> **Atualização (auditoria de validação código→config→KB):** os 22 docs foram
> revalidados linha a linha contra o código real dos 3 bots. Discrepâncias
> encontradas e **corrigidas nos docs** estão listadas na seção 7.

## 1. Funcionalidades por bot

### Ascend — Progressão por tiers (prefixo `$`, v9.0)
- **Tiers**: até 5 níveis de `TIER_1..5` + `TIER_X_SESSION` (quantidade de
  sessões). Nomes/cores/emojis padrão de 1 a 5. `sessionsNeeded` do servidor
  real: **0 / 5 / 8 / 13 / 20**.
- **Sessões**: sábados automáticos + dias extras (`extraDates`) + `sessionTime`
  (HH:MM) com countdown + cancelamento manual (se auto-reseta à meia-noite).
- **Painel de link**: `Embeds.linkPanel` com status (liberada, aguardando
  horário, cancelada, finalizada, fechada); botão `request_link`; modal exige
  digitar exatamente `CONFIRMAR`; limite diário (padrão 1), cooldown (padrão
  5 min); DM falha → sessão já registrada ("queima" o limite).
- **Config**: painel `/config` (owner) com 5 controles (`cfg_geral`, `cfg_session`,
  `cfg_date`, `cfg_link`, select `cfg_tier`); `/acess` cicla sessão/dia extra.
- **Comandos**: `/mytier`, `/config`, `/acess`; `$ping`, `$tier`, `$sessoes`,
  `$ranking`/`$top`, `$link`, `$info`, `$backup`, `$help`/`$ajuda`.
- **Entrada/saída**: `guildMemberAdd` dá Tier 1 + perfil; `guildMemberRemove`
  inativa; `guildMemberUpdate` sincroniza cargo de tier com banco.
- **Persistência**: `data/guilds/928614664840052757/{config,users,sessions,joins}.json`;
  backup automático a cada 6h + `$backup`.

### Atlas — Registro de imóveis RP (prefixo `;`)
- **Config**: `/houseregister #canal` (envia painel + botão `register_house`);
  `/housechannel #canal` — ambos apenas owner.
- **Registro**: botão → modal `house_modal` (rua/referência/cor) → select
  bairro (`neighborhood_select`) → select tipo (`type_select`) → foto (2 min,
  máx 10MB, PNG/JPG/JPEG/GIF/WEBP, baixada via `downloadImage` com follow de
  redirects). ID `ATLAS-<ts>-<rand>`; salvo em `data/imoveis/<tipo>/`.
- **Bairros/tipos**: Greenville 🌳, Brookemere 🌊, Horton 🏔️; casa, apartamento,
  comércio, delegacia, autódromo, outro.
- **Status RP**: `;status`, `;reformar`, `;abandonar` (dono); `;invadir` (ação
  pública, notifica dono no canal de imóveis). Status policial **bloqueia**
  alteração de status pelo dono.
- **Gangues** (`;gangue`): criar/deletar (owner); vincular/desvincular/membro
  (dono da gangue); info/list/propriedades (todos).
- **Polícia** (`;policia`): cargos · add/remove/cargos (owner);
  `;interditar <id> <motivo>`, `;investigar`, `;liberar` (cargo policial).
- **Admin**: `;delete` (owner, remove imagem local), `;backup create/list`,
  `;export`/`;exportar` (arquivo anexado e apagado após 60s).
- **Persistência**: `data/imoveis/*.json`, `data/configs/servidores/`,
  `data/configs/cargos/{gangs,policia}.json`, `images/`, `logs/`, `backups/`.

### Vehix — Registro de veículos por tier (prefixo `'`, v2.0)
- **Config**: `/register #canal` (painel + botão `register_vehicle`),
  `/registered #canal` (pessoais) e `/workcars #canal` (trabalho) — owner,
  exige texto e Anexar Arquivos.
- **Registro**: botão → modal `vehicle_modal` (placa/modelo/cor/ano/preço) →
  select `vehicle_type_select` (Pessoal 🚗 / Trabalho 🔧) → foto (5 min, máx
  10MB; `cancelar` cancela). Coletor em `client.activeCollectors`.
- **Validações**: placa 4–10 caracteres **case-sensitive** (`Placa Inválida`,
  `Placa Duplicada`, `Placa Bloqueada` via `blocked_plates.json`); modelo 2–50;
  cor 2–30; ano 1900–atual+1; preço numérico; preço ≤ `TIER_X_MAX_PRICE`
  (`Preço Excede o Limite`); sem tier → `Sem Tier`; limite pessoais → erro.
- **Tiers/limites**: `TIER_X_MAX_PRICE` reais 80k/150k/175k/200k/250k;
  `vehicleLimit` 3 (tiers 1-3), 4 (tier 4), 5 (tier 5). Trabalho ilimitado.
- **Admin (prefixo, owner)**: stats, listar, buscar, reenviar, bloquear/
  desbloquear/bloqueadas, exportar, backup criar/listar, restaurar, verificar,
  limpar usuarios/antigos/orfaos, anunciar, help. `deletevehicle`/`deletar`/
  `remover` **owner ou cargo Administrador**.

## 2. Knowledge Base (reconstruída)

```
ai/
├── RELATORIO.md
├── README.md              (dentro de knowledge/)
├── knowledge/
│   ├── index.json         (índice RAG: id, path, category, topics, commands)
│   ├── ascend/            (8 docs)
│   │   ├── visao-geral.md
│   │   ├── tiers-e-progressao.md
│   │   ├── sessoes.md
│   │   ├── painel-de-link.md
│   │   ├── solicitar-link.md
│   │   ├── configuracao-e-backup.md
│   │   ├── comandos.md
│   │   └── erros.md
│   ├── atlas/             (8 docs)
│   │   ├── visao-geral.md
│   │   ├── registro-de-imoveis.md
│   │   ├── consulta-e-busca.md
│   │   ├── status-e-acoes-rp.md
│   │   ├── gangues.md
│   │   ├── policia.md
│   │   ├── comandos.md
│   │   └── erros.md
│   └── vehix/             (6 docs)
│       ├── visao-geral.md
│       ├── registro-e-veiculos.md
│       ├── limites-e-tiers.md
│       ├── consulta-e-gerenciamento.md
│       ├── comandos.md
│       └── erros.md
└── system/
    ├── config.js          (arquitetura/domínios/prefixos)
    ├── permissions.js     (public/admin/internal por comando)
    ├── secrets.js         (apenas NOMES de variáveis .env)
    └── internal-rules.js  (regras de segurança da IA)
```

Convenções aplicadas em todos os docs: `Objetivo`, `Comando` exato, `Pré-condições`,
`Fluxo` (entrada→validação→regras→processamento→banco→resultado), `Falhas` com
**mensagens reais** em pt-BR, `Dados`, `Permissões`, `Dependências` e `## Fonte`
(caminho + faixa de linhas verificadas). Ausências são marcadas como
"Não identificado no código analisado."

## 3. Informações protegidas (não documentadas)

Regra (definida pelo dono): **podem entrar na KB configurações e IDs reais
necessários ao funcionamento do servidor único**; a única barreira absoluta são
**segredos/credenciais** e **dados privados de usuários**.

- Tokens e valores de `.env` (apenas nomes são citados em `system/secrets.js`).
- `OWNER_ID`; contas/credenciais; webhooks; MONGO_URI; API keys; JWT; cookies.
- Dados individuais de usuários: joins, sessions, users, imóveis, veículos,
  placas, saldos, membros/gangues reais (`gangs.json` com `ownerId`/`members`).
- Logs de execução e backups internos.
- Mecanismos de backup/restauração/deleção são referenciados apenas como
  restritos ao owner.

### IDs/configurações reais INCLUÍDOS na KB (servidor único 928614664840052757)

- **Guild ID** real: `928614664840052757` (HostVille GVRP) — citado nos paths.
- **Ascend**: cargos de tier via `<@&...>` (`config.json` → `tiers.TIER_X.roleId`),
  `sessionsNeeded` 0/5/8/13/20, `settings.*` (sessionTime 19:00, maxDailyRequests 1,
  cooldown 5 min, autoBackup 6h, allowExtraDays false), link name/description.
- **Atlas**: `registerChannelId` `<#1491408052015071342>`, `housesChannelId`
  `<#1491408375882317896>`, cargos policiais `<@&...>` (3)
  (`data/configs/servidores/guild-<id>.json` e `data/configs/cargos/policia.json`).
- **Vehix**: `registrationChannelId` `<#1490896133982257152>`,
  `vehiclesChannelId` `<#1491018710247542834>`, `workCarsChannelId`
  `<#1501248576938967170>` (`data/guilds.json`), preços máximos e limites de tier.
- `blocked_plates.json` encontra-se vazio atualmente — sem placas bloqueadas.

Ficaram **fora** por serem segredos/dados privados: valores de `.env` (tokens),
`OWNER_ID`, `configuredBy`, URL completa (tratada como dado de sessão), e todos
os dados individuais de usuários/gangues.

## 4. Lacunas/notas

- **Ascend**: `sessionsNeeded` 0/5/8/13/20 é o valor real do servidor;
  cargos de tier confirmados no `config.json` (a fonte de verdade é o
  `config.json` após a 1ª criação — **exceto** `syncAll`/`guildMemberUpdate`,
  que usam `TIERS_CONFIG` do `.env` para o mínimo de sessões; ver seção 6).
- **Atlas**: sem paginação em `;list` (fixo 10 itens); `;search` retorna o
  primeiro resultado por rua/ID.
- **Vehix**: exatamente **todos** os comandos de prefixo exigem owner (exceto
  `delete` = owner/Admin); não há consultas públicas via prefixo. Estados de
  verificação automática (verify) são citados genericamente.

## 5. Riscos potenciais (observação, sem expor código)

- **Ascend**: no `$link`/modal, a sessão é registrada **antes** do envio da DM;
  se a DM falhar ou o modal não for respondido a tempo, o limite diário pode
  ser "queimado" sem o usuário receber o link.
- **Ascend**: a sessão é considerada "finalizada" assim que `currentTime >=
  sessionTime`, **independentemente de alguém ter usado o link** — o código
  checa joins mas o valor não é usado no retorno (`isSessionFinished` 754-795).
- **Vehix**: ajuste automático de limite (remover veículos que excedem o tier)
  pode afetar veículos pessoais quando o cargo/tier muda — mudanças devem ser
  conferidas pelo dono.
- **Geral**: valores numéricos (limits, prices, sessions) vêm do `.env`/config
  e podem divergir do escrito se o dono alterar; a KB cita os valores reais
  atuais e a fonte (caminho+diretório) para revalidação. Canais/cargos citados
  como menções (`<#id>`/`<@&id>`) também têm origem explícita; devem ser
  revalidados se o dono trocar os canais.

## 6. Auditoria de validação (código → config → KB) — correções aplicadas

Todos os docs foram reescritos/verificados linha a linha. Discrepâncias
encontradas e corrigidas:

### Ascend
1. `tiers-e-progressao.md` — remover afirmação de que nomes/cores/emojis são
   personalizáveis via `/config`. **Correto:** só `role_id`, `sessions` e
   `name` são editáveis; `emoji`/`color` são fixos no código (`TIER_EMOJIS`/
   `TIER_COLORS` 35-57).
2. `configuracao-e-backup.md` — `config.json` real de tiers só tem
   `roleId`+`sessionsNeeded`; `settings` reais não têm `enableCountdown`/
   `showMemberCount`/`notifications` (só no default de criação, sem modal de
   edição). Fontes corrigidas (select `cfg_tier` 3639-3652; modal 1733-1771).
3. `tiers-e-progressao.md` — documentar que `syncAll` (502) e
   `guildMemberUpdate` (2968) usam `TIERS_CONFIG` (.env) para o mínimo de
   sessões, não o `config.json` (na prática coincidem: 0/5/8/13/20).
4. `sessoes.md` — remover "finaliza quando passa do horário **E** alguém usou
   o link" (o retorno real é só `currentTime >= sessionTime`); intervalos: o de
   1 min só detecta a transição para sessão liberada (2679-2735), o painel não
   é atualizado "a cada minuto".
5. `solicitar-link.md` — welcomeMessage **não** inclui a data da sessão;
   `$link` em DM retorna **silenciosamente** (handler ignora `!message.guild`).
6. `painel-de-link.md` — textos reais do aguardo: `**Tempo restante:**` e
   `**Horário previsto:**` (e não "Início previsto").

### Atlas
1. `comandos.md` — **crítico**: `;policia cargos` NÃO é para todos os membros;
   o bloco `;policia` inteiro exige owner (gate no início, linha 1767), incluída
   a listagem. Movido para a seção owner. O help do bot não marca esse comando
   como owner — anotado como problema do bot, não da KB.
2. `registro-de-imoveis.md`/`erros.md` — o timeout dos selects de bairro/tipo
   é **silencioso** (o `CollectionError` é engolido); "Tempo Esgotado" só
   aparece no passo da **foto**. Label real do campo `street` = `📍 Rua/Avenida`
   (não 🏠).
3. `consulta-e-busca.md` — `;info` não-encontrado usa **backticks** no ID
   (`Imóvel com ID \`{id}\` não encontrado.`), não negrito.
4. `policia.md` — `;search` usa "🚔 Status Policial"; `;info` usa
   "🚔 Situação Policial" (não eram idênticos).
5. `status-e-acoes-rp.md` — IDs em backticks em `;status`/`;reformar`/
   `;abandonar`; sucesso do `;abandonar` é sempre `ABANDONADO` (masculino),
   sem variação gênero do imóvel.

### Vehix
1. `consulta-e-gerenciamento.md` — **crítico**: `'blockplate`/`'bloquear`
   **NÃO remove** o veículo já registrado com a placa; apenas impede registros
   futuros (`isPlateBlocked` no modal). Para retirar um veículo usa `'deletar`.
2. `erros.md`/`comandos.md` — "Acesso Negado" SÓ existe nos comandos slash;
   comandos de prefixo negam **em silêncio**. Rótulo real: `Permissões
   Insuficientes` (plural) e permissão `Embeds` (não "Embed Links"); o singular
   `Permissão Insuficiente` é usado apenas para **Anexar Arquivos**.
3. `erros.md` — no slash, a checagem de owner vem **antes** da de servidor;
   não-owner em DM recebe "Acesso Negado".
4. `consulta-e-gerenciamento.md` — `'listar`/listVehiclesPaginated (3122-3137)
   **não exibe o proprietário** (placa, modelo, cor, ano, preço, tipo, ID); a
   imagem do `'buscar` é a **foto do veículo** (`attachment.url`), não "capa
   do dono".
5. `limites-e-tiers.md` — não existem `getUserLimit`/`countUserVehicles`/
   `getTierLimit`; a contagem usa `getUserPersonalVehicles().length`;
   `TIER_CONFIG` é 70-96. Corrigido.
6. `registro-e-veiculos.md` — título real do painel: `🚗 SISTEMA DE REGISTRO
   DE VEÍCULOS` (não "por Tier"); dados em um único arquivo `data/vehicles.json`
   (não por usuário); a imagem é anexo/mensagem separada (não está no embed).
7. `visao-geral.md` — `imageUrl` é URL remota (`attachment.url`), não caminho
   local; backups em `Vehix/backups/` (não `data/backups/`); sem recurso de
   "sync" (só `verify`/`verifyAndCleanVehicles`); `PLATE_REGEX` não existe;
   3260 linhas (não 3263); setters de canais em 226-248.

### Preços em USD (Vehix)
- Confirmado no `.env` do servidor: `TIER_1..5_MAX_PRICE` = 80k/150k/175k/
  200k/250k e `TIER_1..5_SESSIONS` 0/5/8/13/20. O painel pede **"Valor em
  dólar (USD)"** (`formatPriceUSD`, linha 504); docs ajustados para não sugerir
  Real.

## 7. Próximos passos sugeridos

1. Carregar `ai/knowledge/*` + `index.json` numa coleção RAG (split por doc →
   embeddings → modelo local) e testar com perguntas dos usuários.
2. Adicionar testes de "prompt injection" (pedir token/código/owner) validando
   `system/internal-rules.js`.
3. Revisar com o dono limites/tiers atuais periodicamente (fonte `.env`).