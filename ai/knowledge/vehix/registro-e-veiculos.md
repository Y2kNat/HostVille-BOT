# Vehix — Como registrar um veículo

## Resposta curta
- Canal de registro: <#1490896133982257152>
- Botão: "Registrar Veículo"
- Campos do formulário: Placa, Modelo, Cor, Ano e Preço (USD)
- Tipo: Veículo Pessoal (🚗) ou Veículo de Trabalho (🔧)
- Ao final: enviar a foto no chat
- Resultado: o veículo é publicado no canal do tipo escolhido e o usuário recebe um ID no formato `VEH-1777331307737-1234`

## Campos do formulário
| Campo | Regra |
|-------|-------|
| **Placa** | 4 a 10 caracteres, diferença **maiúscula/minúscula importa** (ex.: `ABC1234`, `XYZ9E99`), **única por servidor**, não pode estar bloqueada |
| **Modelo** | 2 a 50 caracteres |
| **Cor** | 2 a 30 caracteres (texto livre) |
| **Ano** | Número de 4 dígitos, de 1900 até o ano atual + 1 |
| **Preço (USD)** | Número maior que 0, **sem símbolos** ("$"), válido na América do Sul – não pode passar do teto do seu tier (contando o seu booster, se tiver) |

## Tipo de veículo
- **Veículo Pessoal (🚗):** tem **limite por tier** (ver doc de limites).
- **Veículo de Trabalho (🔧):** **sem limite de quantidade**.
- Se você já atingiu o limite de pessoais, o registro é bloqueado.

## Foto
- Anexo no chat onde você clicou; **PNG, JPG, JPEG, GIF ou WEBP**, máx. **10MB**, **1 imagem**.
- Você tem **5 minutos**. Pode cancelar digitando `cancelar`.

## IMPORTANTE
- Precisa de **cargo de tier** para registrar (são 7 tiers, do TIER_1 ao TIER_7).
- Registrar **não é comando** — é o botão do painel no <#1490896133982257152>.

## Fonte
`Vehix/modules/registration.js` (modal e validações), `Vehix/modules/validation.js` (campos), `Vehix/data/guilds.json` (canais).