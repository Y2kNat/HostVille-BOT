# Atlas — Status e ações de RP

## Respostas diretas
- **Como mudo o status do meu imóvel?** `;status <id> <status>` sendo o **dono** do imóvel.
- **Status possíveis:** `disponivel` (🟢 Disponível), `construcao` (🚧 Em Construção), `abandonada` (🏚️ Abandonada), `reforma` (🔨 Em Reforma).
- **Atalhos:** `;reformar <id>` (marca em reforma) e `;abandonar <id>` (marca abandonada).
- **Não funciona?** Só o **dono** do imóvel muda o status. Enquanto o imóvel estiver sob ação policial (interditado/investigado), o status não pode ser alterado.

## Ações RP
- **;invadir <id>** — registra uma invasão RP do imóvel e **notifica o dono** no canal de imóveis.
- **;gangue** — comandos de gangues (ver doc gangues).
- **;policia / ;interditar / ;investigar / ;liberar** — ações da polícia (ver doc policia).

## IMPORTANTE
- **Não existe comando de edição** do imóvel (mudar rua/cor/tipo). Só dá para mudar o **status** e (dono do servidor) apagar.
- Não existe `/status` com barra — o prefixo é `;`.

## Fonte
`Atlas/index.js:1296-1396` (;status, ;reformar, ;abandonar), `1992-2038` (;invadir).