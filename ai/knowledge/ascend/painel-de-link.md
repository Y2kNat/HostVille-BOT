# Ascend — Painel de link

## Respostas diretas
- **Onde fica o painel de link?** No canal <#1491167442544627923> (id: `LINK_CHANNEL`).
- **O que o painel mostra?** O status da sessão (aberta/aguardando/cancelada/finalizada/fechada), contagem/tiers e o botão **"Solicitar Link de Acesso"**.
- **O painel atualiza sozinho?** Sim, a cada **1 minuto**.
- **Antes das 19:00?** Libera só quando o horário configurado chega ("Sessão não iniciada").
- **Depois da sessão?** Sem usar, o painel marca "Sessão Finalizada".

## IMPORTANTE
- O link liberado é o do server **HostVille** no Roblox (nome "HostVille"). Ele pode ser trocado pelo dono em `/config`.
- A sessão é válida **apenas no dia liberado**.

## Fonte
`Ascend/index.js:2679-2735` (atualização do painel), `config.json:5-11` (link), `.env` (canal do painel).