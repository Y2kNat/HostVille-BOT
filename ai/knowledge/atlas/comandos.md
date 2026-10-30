# Atlas — Comandos de administração (só do dono)

## Respostas diretas
- **Apagar um imóvel:** `;delete <id>` (somente owner).
- **Backup:** `;backup create` e `;backup list` (somente owner).
- **Exportar dados:** `;export` (alias `;exportar`) — gera JSON com imóveis/gangues/polícia (somente owner).
- **Configurar canais:** `/houseregister #canal` (define o canal do painel de registro) e `/housechannel #canal` (define o canal onde os imóveis aparecem) — slash **somente owner**.

## Erros de permissão
- Slash usado por quem não é owner → `Permissão Negada` — "Apenas o {owner} pode usar comandos slash."

## IMPORTANTE
- `/houseregister` e `/housechannel` são os **únicos** comandos slash do Atlas (e só o dono usa).
- Todo o resto do Atlas usa prefixo `;`.

## Fonte
`Atlas/index.js:684-816` (slash), `2042-2153` (;delete, ;backup, ;export).