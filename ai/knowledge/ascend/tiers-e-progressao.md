# Ascend — Tiers e progressão

## Respostas diretas
- **Como subo de tier?** Acumulando **sessões** (participar do server no dia da sessão = +1 sessão). Ao bater a quantidade certa, o cargo é trocado automaticamente.
- **Quais são os tiers?**
  | Tier | Nome | Sessões necessárias |
  |------|------|---------------------|
  | TIER_1 🥉 | Iniciante | 0 (entra assim) |
  | TIER_2 🥈 | Aprendiz | 5 |
  | TIER_3 🥇 | Intermediário | 8 |
  | TIER_4 💎 | Avançado | 13 |
  | TIER_5 👑 | Mestre | 20 |
  | TIER_6 🏅 | Lenda | 40 |
  | TIER_7 💠 | Imortal | 60 |
- **São 7 tiers no total**, do Iniciante (0 sessões) ao Imortal (60 sessões).
- **Como vejo meu progresso?** `/mytier` — mostra tier atual, sessões feitas/necessárias, % na barra de progresso, "Faltam X sessões", ranking e cooldown.
- **Alternativas:** `$tier [@user]`, `$sessoes [@user]`, `$ranking` / `$top`.
- **Sair do servidor e voltar?** O Ascend ajusta suas sessões conforme o **cargo** que você tem (sync automático).
- **Faltar sessão tem punição?** **Não.** Você só não ganha +1 sessão; não existe rebaixamento nem strike.

## Comandos (prefixo `$`)
`$tier`, `$sessoes`, `$ranking`, `$top` e slash `/mytier`.

## IMPORTANTE
- Prefixo é `$` (`$tier`, `$sessoes`). Não existem `/tier` nem `/sessoes`.
- Sempre que você participa de uma sessão, a promoção é verificada na hora.
- As cores dos cargos: TIER_1 cinza, TIER_2 verde, TIER_3 azul, TIER_4 roxo, TIER_5 dourado, TIER_6 laranja, TIER_7 vinho.

## Fonte
`Ascend/index.js:67-76` (nomes/emojis/cores), `config.json` (tiers 1-7), `.env` (TIER_1 a TIER_7).