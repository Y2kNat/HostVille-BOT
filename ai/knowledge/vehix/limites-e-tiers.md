# Vehix — Limites e tiers de veículos

## Respostas diretas
- **Quantos veículos pessoais posso ter?** Depende do tier: **3, 3, 3, 4, 5, 5 e 6** (TIER_1→3). Veículo de **trabalho: ilimitado**.
- **Qual o teto de preço por tier?**
  | Tier | Cargo/Sessões | Preço máximo (USD) | Veículos pessoais |
  |------|---------------|--------------------|-------------------|
  | 1 🥉 | 0 sessões | 80.000 | 3 |
  | 2 🥈 | 5 sessões | 150.000 | 3 |
  | 3 🥇 | 8 sessões | 175.000 | 3 |
  | 4 💎 | 13 sessões | 200.000 | 4 |
  | 5 👑 | 20 sessões | 250.000 | 5 |
  | 6 🏅 | 40 sessões | 350.000 | 5 |
  | 7 💠 | 60 sessões | 450.000 | 6 |
- **Esse teto pode ser maior?** Sim, se você tiver **cargo de Booster**: o teto final é o valor da tabela **multiplicado** (×1,15, ×1,25 ou ×1,40). Ver doc de booster e retirada.
- **Ultrapassou o teto do tier?** O registro é bloqueado e sugere evoluir o tier.
- **O que a verificação automática faz?** Remove veículos se: o dono saiu do servidor, ficou sem cargo de tier, preço acima do teto do tier (já contando o booster), ou veículos pessoais acima do limite (remove os **mais caros** que sobraram).

## IMPORTANTE
- Vale o **maior tier** que o membro tem (1 a 7).
- Os cargos/tetos são os listados acima (config atual do servidor).

## Fonte
`Vehix/modules/config.js:77-119` (tiers e limites), `Vehix/.env` (TIER_1 a TIER_7),