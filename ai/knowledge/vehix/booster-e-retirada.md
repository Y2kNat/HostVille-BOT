# Vehix — Booster e retirada de veículo

## Respostas diretas
- **O que é o Booster?** É o sistema que **aumenta o teto de preço** do seu tier. O valor final do veículo é `teto do seu tier × multiplicador do seu booster`.
- **Quais são os níveis de booster e o que multiplicam?**
  | Nível | Boosts | Multiplicador | Efeito no teto (ex.: TIER_1 = 80.000) |
  |-------|--------|---------------|---------------------------------------|
  | Nível 1 🥉 | 1 a 5 boosts | ×1,15 | 92.000 |
  | Nível 2 🥈 | 6 a 13 boosts | ×1,25 | 100.000 |
  | Nível 3 🥇 | 14 ou mais boosts | ×1,40 | 112.000 |
- **Como vejo meu booster?** `'boost` ou `'booster` — mostra o nível atual, o multiplicador, o teto base do seu tier e o limite já multiplicado, além do histórico de mudanças.
- **Os cargos de booster são dados pelo Discord?** Sim. A staff atribui manualmente; o bot só **observa** o cargo e recalcula o multiplicador (verificação diária). O bot não conta, não cria e não remove boost.
- **Se meu booster cair, o que acontece?** O teto volta ao valor base do tier e, se algum veículo estiver acima do novo teto, ele é sinalizado para remoção pela verificação automática.
- **Como apago meu próprio veículo?** No canal de **retirada de veículo** (<#1553042999720542218>) há o botão **"Deletar um veículo"**. O fluxo inteiro é por botões e privado: escolher tipo (pessoal ou trabalho) → escolher veículo → confirmar. A ação é **permanente**.
- **Quantas vezes posso apagar por semana?** **3 veículos por semana**. A semana do limite **começa aos domingos**.
- **Posso cancelar a retirada?** Sim, até o final, pelo botão de cancelar do próprio painel.

## IMPORTANTE
- O limite semanal de retirada (3) é separado do limite de veículos por tier: apagar não devolve vaga de tier, só remove o registro.
- A verificação automática (que roda ao ligar o bot e depois disso periodicamente) remove veículos de quem saiu do servidor, perdeu o cargo de tier, está com preço acima do teto (considerando o booster) ou acima do limite de veículos pessoais.
- Comandos novos: `'boost`/`'booster`, `'antigos` (limpa registros com +30 dias), `'orfaos` (limpa dados de quem não está mais no servidor), `'verificar`/`'verify`.

## Fonte
`Vehix/modules/config.js:77-85` (limites por tier), `125-217` (boost), `219-244` (self-delete), `Vehix/.env` (TIER_1..7, BOOST_LEVEL_*, SELF_DELETE_WEEKLY_LIMIT), `Vehix/data/guilds.json` (canais), `Vehix/modules/registration.js:34-37` e `verification.js:51-52` (multiplicador no teto).
