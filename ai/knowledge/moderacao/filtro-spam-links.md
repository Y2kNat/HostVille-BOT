# Filtro de palavras, links e spam

## Objetivo

Explica os três bloqueios automáticos do bot: palavras ofensivas, links e spam.

## Resposta curta (dados verificados)

- Palavras ofensivas: 196 palavras na lista padrão. A staff pode adicionar ou remover com `/filter`.
- Links: convites de Discord são apagados. Hoje nenhum domínio específico está bloqueado.
- Spam: mais de 5 mensagens em 5 segundos resulta em silenciamento de 60 segundos.

## 1. Filtro de palavras ofensivas

O bot tem uma lista padrão com 196 palavras consideradas ofensivas. Quando alguém envia uma delas, o bot toma a ação configurada.

Comando de gestão: `/filter`

| Opção | O que faz |
|---|---|
| `action` | Ação a executar. |
| `word` | Palavra a adicionar ou remover. |

A ação padrão configurada no servidor é a remoção da mensagem. A staff também pode cadastrar palavras próprias, que ficam salvas no servidor.

## 2. Filtro anti-link

Configuração: `/linksettings`

| Opção | O que faz |
|---|---|
| `action` | Ação (ativar, desativar, adicionar ou remover domínio). |
| `domain` | Domínio no formato `youtube.com`. |

Estado atual no servidor principal:

| Configuração | Valor | Efeito |
|---|---|---|
| Apagar convites | Ativado | Convites de Discord são apagados. |
| Domínios bloqueados | Nenhum | Nenhum domínio específico está bloqueado no momento. |

Quando a mensagem é bloqueada, o bot avisa e a mensagem é removida após alguns segundos. A staff recebe o registro no canal de logs.

## 3. Bloqueio por spam

Configuração interna, não há comando para mudar.

| Parâmetro | Valor | Significado |
|---|---|---|
| Quantidade | 5 | Mensagens dentro da janela. |
| Janela | 5 segundos | Tempo de contagem. |
| Silenciamento | 60 segundos | Duração do silenciamento automático. |
| Similaridade | 0.8 | Quão parecida duas mensagens precisam ser para contar como repetição. |

Como funciona: ao passar de 5 mensagens dentro de 5 segundos, o bot silencia o usuário por 60 segundos com o motivo "Spam detectado". Esse silenciamento é automático e não passa pelo comando `/timeout`.

## Como reclamar

Se você acha que foi bloqueado por engano, abra um ticket de Suporte e explique o que aconteceu.

## Fonte

- `data/offensiveWords.js` (196 palavras, regex de convite e de URL)
- `commands/config/filter.js` (gestão da lista, `isAdmin`)
- `commands/config/linksettings.js` (gestão de links, `isAdmin`)
- `managers/LinkManager.js` (remoção do link com atraso de 10 segundos)
- `managers/SpamManager.js` (janela, silenciamento)
- `config.js` → `SPAM` (5 / 5000 ms / 60000 ms / 0.8)
- `db.json` → `linkSettings` (`deleteInvites: true`, `allowedDomains: []`)
- Verificado em 2026-09-25
