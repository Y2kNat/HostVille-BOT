# Silêncio, expulsão e banimento

## Objetivo

Explica as três punições diretas: timeout, kick e ban.

## Resposta curta (dados verificados)

| Comando | O que faz | Parâmetros |
|---|---|---|
| `/timeout` | Silencia um usuário temporariamente | `usuário`, `minutos` (1 a 40320), `motivo` opcional |
| `/kick` | Expulsa um membro do servidor | `usuário`, `motivo` opcional |
| `/ban` | Bane um usuário do servidor | `usuário`, `motivo` opcional |

40320 minutos é o limite do Discord e equivale a 28 dias.

## Permissões necessárias

| Comando | Permissão Discord |
|---|---|
| `/timeout` | Moderate Members (Moderar Membros) |
| `/kick` | Kick Members (Expulsar Membros) |
| `/ban` | Ban Members (Banir Membros) |

Quem não tiver a permissão recebe "❌ Sem permissão.".

## Mensagens do bot

| Comando | Resposta ao staff |
|---|---|
| `/timeout` | "🔇 <usuário> foi silenciado por X minutos. Motivo: ..." |
| `/kick` | "👢 <usuário> foi expulso. Motivo: ..." |
| `/ban` | "🔨 <usuário> foi banido. Motivo: ..." |

O motivo fica anexado no registro da ação do Discord, sempre com o identificador do bot. Quando o motivo não é informado, o bot usa "Sem motivo especificado".

## Regras

- O silenciamento é temporário e tem prazo máximo de 28 dias por definição do Discord.
- O silenciamento expira sozinho. Kick e ban são permanentes.
- Estas punições não têm confirmação dupla. O bot executa direto ao receber o comando de quem tem a permissão.
- Quem usa o comando precisa ter a permissão correspondente. O bot confere antes de executar.
- Não existe punição automática por aviso. Aviso e punição são separados.

## Fonte

- `commands/mod/timeout.js` (minutos de 1 a 40320, permissão Moderate Members)
- `commands/mod/kick.js` (permissão Kick Members)
- `commands/mod/ban.js` (permissão Ban Members)
- `config.js` → `SPAM.MUTE_DURATION` (usado só no bloqueio por spam, não pelo `/timeout`)
- Verificado em 2026-09-25
