# Limpeza de mensagens (purge)

## Objetivo

Explica o comando de apagar mensagens em massa.

## Resposta curta (dados verificados)

- Comando: `/purge quantidade`
- Quantidade válida: de 1 a 100 mensagens.
- Permissão necessária: Gerenciar Mensagens.
- Sem permissão, o bot responde "❌ Sem permissão.".

## Como funciona

O comando apaga a quantidade informada de mensagens mais recentes do canal onde foi usado.

## Limites

| Limite | Valor |
|---|---|
| Mínimo | 1 mensagem |
| Máximo | 100 mensagens |

Valores fora desse intervalo são bloqueados pelo próprio Discord antes de o bot receber o comando.

## Permissões

- Necessária: **Gerenciar Mensagens** no canal.
- Sem essa permissão, o bot recusa com "❌ Sem permissão.".

## Regras

- O purge só funciona no canal em que o comando foi digitado.
- O bot precisa da permissão de Gerenciar Mensagens no canal específico.
- Não existe confirmação dupla. O comando executa direto.
- Mensagem apagada pelo purge não pode ser recuperada pelo bot.

## Fonte

- `commands/mod/purge.js` (`amount` de 1 a 100, permissão ManageMessages, mensagem de recusa)
- Verificado em 2026-09-25
