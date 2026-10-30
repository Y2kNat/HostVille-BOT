# Comandos do HostVille • BOT

## Objetivo

Catálogo dos comandos do bot, com o que cada um faz e quem pode usar. Serve para a IA dizer qual comando usar sem inventar nome.

## Resposta curta (dados verificados)

- São 26 comandos registrados.
- Todos os comandos do bot começam com `/` (barra).
- Comandos de moderação: `/warn`, `/warnings`, `/clearwarns`, `/timeout`, `/kick`, `/ban`, `/purge`.
- Comandos de ticket: `/ticket`, `/close`, `/adicionar`, `/ticket-setup`, `/ticket-config`.
- Comando para pedir ajuda: `/help`.

## Comandos de informação (qualquer usuário)

| Comando | O que faz |
|---|---|
| `/ping` | Verifica a latência do bot. |
| `/help` | Mostra a lista de comandos do bot. |
| `/avatar` | Mostra o avatar de um usuário. |
| `/serverinfo` | Mostra informações do servidor. |
| `/userinfo` | Mostra informações de um usuário. |

## Comandos de moderação

| Comando | O que faz | Quem pode usar |
|---|---|---|
| `/warn` | Aplica um aviso a um membro. Motivo obrigatório. | Administradores |
| `/warnings` | Lista os avisos de um usuário. | Administradores |
| `/clearwarns` | Remove todos os avisos de um usuário. | Administradores |
| `/timeout` | Silencia temporariamente. De 1 a 40320 minutos. | Quem tem Moderate Members |
| `/kick` | Expulsa um membro. | Quem tem Kick Members |
| `/ban` | Bane um usuário. | Quem tem Ban Members |
| `/purge` | Apaga de 1 a 100 mensagens. | Quem tem Gerenciar Mensagens |

## Comandos de ticket

| Comando | O que faz | Quem pode usar |
|---|---|---|
| `/ticket` | Abre um ticket no canal atual. | Quem tem Gerenciar Canais |
| `/close` | Fecha o ticket do canal atual, com motivo. | Quem tem Gerenciar Canais |
| `/adicionar` | Adiciona alguém ao ticket. Tipo 1 permite ver e ler; tipo 2 permite ver, ler e escrever. | Quem tem Gerenciar Canais, Ver Canal, Enviar e Ler Histórico |
| `/ticket-setup` | Cria o painel de atendimento com botões. | Administradores |
| `/ticket-config` | Conecta o servidor principal ao servidor da staff. | Administradores |

## Comandos de configuração

| Comando | O que faz | Quem pode usar |
|---|---|---|
| `/filter` | Gerencia palavras ofensivas customizadas. | Administradores |
| `/linksettings` | Configura o filtro anti-link. | Administradores |
| `/autointeraction` | Liga ou desliga as interações automáticas. | Administradores |
| `/maintenance` | Liga ou desliga a manutenção do bot, com motivo opcional. | Dono ou Administradores |
| `/autointeraction` | Liga ou desliga as interações automáticas do bot. | Administradores |
| `/modtest` | Testa um texto no filtro de moderação e mostra a decisão, **sem apagar nada e sem dar warn**. | Administradores |
| `/ai-ticket` | Liga ou desliga a resposta automática da IA **no ticket atual**. Precisa estar dentro do ticket. | Administradores |
| `/adm` | Abre o painel administrativo, por senha de acesso. | Quem tiver a senha |
| `/private` | Envia uma mensagem da staff para um usuário, por senha. | Quem tiver a senha |
| `/report` | Gera e envia o relatório de estatísticas para a staff, por senha. | Quem tiver a senha |

## Filtro de moderação

O filtro é automático e não é comando: ele roda em toda mensagem antes da IA.

| Comando | O que faz |
|---|---|
| `/filter add <palavra>` | Staff adiciona palavra que **sempre** bloqueia. |
| `/filter remove <palavra>` | Remove a palavra. |
| `/filter list` | Lista as palavras da staff. |
| `/filter disable` | Desliga o filtro **só neste canal**. Os outros canais seguem filtrando. |
| `/filter enable` | Religa o filtro neste canal. |
| `/filter status` | Mostra se o filtro está ativo no canal e quantas palavras a staff cadastrou. |
| `/modtest <texto>` | Mostra o que o filtro decidiria: veredito, severidade, categoria, confiança, termos encontrados e motivo. Não pune ninguém. |

Quando a IA de moderação está indisponível, a resposta sai com `aiStatus` de falha.
Isso **não significa que o texto é limpo**: significa que não deu para classificar, e a
mensagem passa sem punição.

## IA do ticket

Por padrão a IA responde automaticamente em todo ticket aberto. A staff pode
desligar isso **num ticket específico**, sem afetar os outros nem a IA do servidor.

| Comando | O que faz |
|---|---|
| `/ai-ticket off` | Desliga a resposta automática no ticket atual. |
| `/ai-ticket on` | Religa. |
| `/ai-ticket status` | Mostra se está ligada e quem é o dono do ticket. |

Com a IA desligada, o bot **não deixa o usuário sem resposta**: avisa no canal e
chama a equipe. O ticket de **denúncia** não é afetado, porque ele já é um
formulário guiado e nunca usou IA.

Mudança vale só para o ticket atual.

Punição automática por acúmulo de avisos:

| Avisos | Punição |
|---|---|
| 5 | Silenciado por 1 hora |
| 10 | Silenciado por 6 horas |
| 15 | Silenciado por 24 horas |

## Regras

- Não existe comando para registrar veículo, imóvel ou criar sessão. Cada um desses pertence a outro sistema: Vehix, Atlas e Ascend.
- Os nomes são exatos. `/ticketconfig` não existe: o nome é `/ticket-config`. `/ticketsetup` não existe: o nome é `/ticket-setup`.
- Ao indicar um comando, sempre use `/` na frente.

## Fonte

- `events/interactionCreate.js` (mapa oficial dos 23 comandos registrados)
- `commands/**` (descrições e parâmetros de cada comando)
- `utils/permissions.js` (definição de administrador)
- `config.js` (`ADMIN_ROLES`, `STAFF_USER_ID`, `ACCESS_CODE`, `OWNER_ID`)
- Verificado em 2026-09-25
