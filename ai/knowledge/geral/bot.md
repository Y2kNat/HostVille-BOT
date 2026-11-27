# HostVille • BOT — visão geral

## Objetivo

Define o que é o HostVille • BOT, em quais servidores ele atua e o que ele faz e não faz.

## Identificação

| Dado | Valor |
|---|---|
| Nome | HostVille • BOT |
| Versão | 6.3.1 |
| Cor | #341539 |
| Servidor principal (comunidade) | HostVille GVRP [ROBLOX] — `928614664840052757` |
| Servidor da staff | Administração HostVille — `1519076712413925416` |
| Aplicação (client ID) | `1473705296101900420` |

## Servidores

O bot é multi-servidor. Ele opera no servidor da comunidade e envia o atendimento para o servidor da staff.

| Servidor | ID | Papel |
|---|---|---|
| HostVille GVRP [ROBLOX] | `928614664840052757` | Comunidade. Onde o usuário abre ticket e usa os comandos. |
| Administração HostVille | `1519076712413925416` | Staff. Recebe os tickets. Monitoramento ativo. |

## Canais internos relevantes

| Canal | ID | Função |
|---|---|---|
| Canal da staff | `1519107076943777872` | Onde a staff acompanha os tickets. |
| Canal de logs | `1483646073284198551` | Registro de tickets e ações. |
| Central de Atendimento | `1491169677970505738` | Painel com os botões para abrir ticket. |

## O que o bot faz

- Responde tickets de Dúvidas, Suporte e Atendimento com IA, usando a base de conhecimento.
- Coleta denúncias em um formulário guiado de 4 etapas.
- Modera: avisos, silencios, expulsões, banimentos, limpeza de mensagens.
- Filtra palavras ofensivas, links e convites não permitidos.
- Bloqueia spam por volume de mensagens.
- Envia relatório diário de estatísticas para a staff.
- Faz backup, gera relatórios e mantém o painel administrativo.

## O que o bot NÃO faz

- Não registra veículos. Veículos são do sistema **Vehix**.
- Não registra imóveis. Imóveis são do sistema **Atlas**.
- Não cria sessões nem links de sessão. Isso é do sistema **Ascend**.
- Não tem sistema de economia, moeda, pagamento ou transferência de dinheiro entre jogadores.
- Não tem sistema de aeroporto,spawn ouolehada.

## Fonte

- `config.js` (nome, versão, cor, valores padrão)
- `db.json` → `tickets.connections` (nomes e IDs dos servidores, canais, cargo de staff)
- `deploy.js`, `events/ready.js` (registro da aplicação e dos comandos)
- Verificado em 2026-09-25
