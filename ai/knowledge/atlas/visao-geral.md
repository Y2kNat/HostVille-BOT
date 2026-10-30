# Atlas — Sistema de Imóveis (visão para o usuário)

## O que é
O **Atlas** é o sistema de registro de **imóveis** (casas, apartamentos, comércios etc.) do servidor HostVille GVRP. Todo imóvel do mapa RP passa por aqui: registrar, consultar, mudar status.

## Respostas diretas
- **Onde registro meu imóvel?** No canal de registro <#1491408052015071342>, clicando no botão **"🏠 Registrar Imóvel"** do painel. Não é por comando de texto.
- **Onde meu imóvel aparece depois de registrado?** No canal de imóveis <#1491408375882317896>.
- **Custa alguma coisa registrar?** Não. O sistema não tem preço, venda nem aluguel.
- **O registro é por qual bot?** Pelo painel do Atlas (clique no botão) — quem registra é quem clica, não precisa de comando.

## Comandos do Atlas (prefixo `;`)
Só existem estes comandos com `;` (ponto e vírgula):
`;help`, `;list`, `;search`, `;info`, `;stats`, `;neighborhoods` (alias `;bairros`), `;vizinhanca`, `;minhasprops`, `;status`, `;reformar`, `;abandonar`, `;invadir`, `;gangue`, `;policia`, `;interditar`, `;investigar`, `;liberar`.

Apenas o dono do servidor: `/houseregister`, `/housechannel`, `;delete`, `;backup`, `;export`.

## Comandos que NÃO existem
- `/bairros` → o certo é `;bairros` (com ponto e vírgula). ⚠️ Não invente `/`.
- `/tipos` → **não existe**. A lista de tipos aparece dentro do registro (select do botão).
- `/registrar`, `/imovel`, `/house` → não existem.

## Fonte
`Atlas/index.js:60` (prefixo `;`), configuração `Atlas/data/configs/servidores/guild-928614664840052757.json`.