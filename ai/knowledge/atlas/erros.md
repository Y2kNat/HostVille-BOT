# Atlas — Erros comuns e soluções

## Respostas diretas
- **"Formato Inválido" ao registrar** → a foto não era uma imagem. Envie **PNG, JPG, JPEG, GIF ou WEBP**.
- **"Imagem Muito Grande"** → a imagem passou de **10MB**. Reduza e tente de novo.
- **"Canal Não Configurado"** → o dono precisa configurar `/housechannel` antes.
- **"Canal Inválido"** → canal de imóveis não encontrado (config do dono).
- **Registro parou sem mensagem (bairro/tipo)** → o tempo de 60s esgotou. Clique no botão **"Registrar Imóvel"** de novo e escolha rápido.
- **"Tempo Esgotado" na foto** → passou de 2 minutos. Clique no botão novamente e anexe a foto no tempo.
- **"Permissão Negada" em slash** → só o dono usa `/houseregister` e `/housechannel`.
- **Tentei mudar o status e não vai** → só o dono do imóvel pode, e não pode enquanto estiver sob ação policial.
- **Quero editar rua/cor/tipo** → não existe edição. Só status; apagar é só o dono (`;delete <id>`).

## IMPORTANTE
- Sempre registrar pelo **botão do painel** no <#1491408052015071342>; não existe comando `/registrar`.

## Fonte
`Atlas/index.js:939-1057` (validações de imagem/erros), `1296-1396` (status).