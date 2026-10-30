# Atlas — Como registrar um imóvel (guia do usuário)

## Resposta curta
- Canal de registro: <#1491408052015071342>
- Botão: "🏠 Registrar Imóvel"
- Formulário: Rua/Avenida, Ponto de Referência e Cor
- Depois: escolher o bairro e o tipo de imóvel
- Ao final: enviar a foto no chat
- Resultado: o imóvel é publicado no canal <#1491408375882317896> e o usuário recebe um ID no formato `ATLAS-1777331307737-8263`

## Detalhes de cada campo
- **Rua/Avenida:** endereço do imóvel (ex.: "Rua das Palmeiras, 123"). Máx. 100 caracteres.
- **Ponto de Referência:** local de referência na cidade (ex.: "Próximo ao supermercado"). Máx. 100.
- **Cor:** cor da casa (ex.: "Branca"). Máx. 30. É texto livre — não tem lista.
- **Bairro (select):** só existem **3 bairros**:
  - Greenville 🌳
  - Brookemere 🌊
  - Horton 🏔️
- **Tipo (select):** só existem estes tipos: **Casa 🏠, Apartamento 🏢, Comércio 🏪, Delegacia 👮, Autódromo 🏎️, Outro 📦**.
- **Foto:** anexo no chat, formato **PNG, JPG, JPEG, GIF ou WEBP**, máximo **10MB**. Nada de links de fora — precisa ser anexo.

## Tempo limite
- Bairro e tipo: **60 segundos** para escolher (se demorar, o registro para em silêncio).
- Foto: **2 minutos** para anexar.

## IMPORTANTE (para não confundir o usuário)
- **Não existe comando `/bairros` nem `/tipos`.** A lista de bairros é dada também pelo comando `;bairros` (e `;neighborhoods`). A lista de tipos aparece só dentro do registro.
- Registrar imóvel **não é comando** — é sempre pelo **botão do painel**.

## Fonte
`Atlas/index.js`: botão `register_house` (820), modal `house_modal` (860), selects (868/920), foto (939-965), publicação (1011). Bairros (100), tipos (107-114). Config: `registerChannelId`/`housesChannelId` em `Atlas/data/configs/servidores/guild-928614664840052757.json`.