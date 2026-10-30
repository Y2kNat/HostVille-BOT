# Atlas — Ações da polícia

## Respostas diretas
- **Como interditar um imóvel?** `;interditar <id> <motivo>` — quem tem cargo de polícia.
- **Como investigar um imóvel?** `;investigar <id>` — cargo de polícia.
- **Como liberar?** `;liberar <id>` — cargo de polícia.
- **O que acontece?** A interdição/Investigação fica marcada no imóvel (`policeStatus`) e notifica o dono no canal de imóveis; enquanto interditado/investigado, o dono **não consegue mudar o status** do imóvel.
- **Como configurar cargos de polícia?** `;policia cargo add @cargo` / `;policia cargo remove @cargo` / `;policia cargos` — só o dono do servidor.

## IMPORTANTE
- Prefixo é `;` (`;interditar`, `;investigar`, `;liberar`). Não existem `/interditar` etc.
- Cargo de polícia é configurado no servidor — quem não tem o cargo não usa esses comandos.

## Fonte
`Atlas/index.js:1764-1988` (;policia, ;interditar, ;investigar, ;liberar). Config: `Atlas/data/configs/cargos/policia.json`.