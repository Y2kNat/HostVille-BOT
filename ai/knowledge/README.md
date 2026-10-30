# Knowledge Base do HostVille • BOT

Fonte da verdade da IA. A IA gera a linguagem; estes documentos generate the fatos.

Reconstruída a partir do comportamento real do código em **2026-09-25**.

## Regra de ouro

```
Código > Configuração estruturada > Mensagens do bot > Documentação > KB antiga
```

Se um documento e o código discordam, o código vence e o conflito vai para o relatório de auditoria.

## Estrutura

```
ai/knowledge/
├── index.json          índice com title, keywords, commands, priority, source, confidence
├── geral/              o bot, comandos, idioma e tom
│   ├── bot.md
│   ├── comandos.md
│   └── idioma-e-tom.md
├── tickets/            os 4 tipos de ticket
│   ├── painel.md
│   ├── duvidas.md
│   ├── suporte.md
│   ├── atendimento.md
│   ├── denuncias.md
│   └── limites-e-acesso.md
├── moderacao/          avisos, punições, limpeza, filtros
│   ├── avisos.md
│   ├── silencio-expulsao-banimento.md
│   ├── purge.md
│   └── filtro-spam-links.md
├── vehix/              veículos
├── atlas/              imóveis
└── ascend/             sessões e tiers
```

### Por que não existem `veiculos/`, `imoveis/`, `sessoes/` e `sistemas/`

Para não duplicar informação (§19 do manifesto):

- veículos = sistema **Vehix** → `vehix/`
- imóveis = sistema **Atlas** → `atlas/`
- sessões e tiers = sistema **Ascend** → `ascend/`
- `sistemas/` seria apenas um índice de `vehix/`, `atlas/` e `ascend/`

### Por que não existe `economia/`

O HostVille não tem sistema de economia, moeda, pagamento ou transferência. Não existe código que documente isso, então não foi inventado. A regra está escrita em `geral/bot.md` e no prompt, para a IA negar o que não existe.

## Formato dos documentos

```md
# Título

## Objetivo
O que o documento responde.

## Resposta curta (dados verificados)
- Fatos que a IA precisa, em forma de dado, não de frase pronta.

## Regras / Dados
...

## Fonte
- `arquivo:linha` — o que foi lido para escrever este documento
- Verificado em 2026-09-25
```

A seção `## Fonte` é de manutenção. O retriever pode cortá-la do contexto.

## Campos do `index.json`

| Campo | Uso |
|---|---|
| `id` | Identificador do documento |
| `title` | Título, lido do `#` do arquivo |
| `path` | Caminho relativo à raiz do projeto |
| `category` | `geral`, `tickets`, `moderacao`, `vehix`, `atlas`, `ascend` |
| `keywords` | Termos de retrieval |
| `commands` | Comandos reais mencionados no documento |
| `priority` | 1 a 10. Regra específica > configuração > geral |
| `source` | Arquivos-fonte lidos na auditoria |
| `confidence` | `high`, `medium`, `low` |
| `lastVerified` | Data da última verificação contra o código |

## O que NÃO entra aqui

- Tokens, senhas, Mongo URI, API keys, webhooks, cookies. §32
- `TOKEN`, `MONGO_URI`, `PUSHER_KEY`, `ACCESS_CODE` e `OWNER_ID` existem em `.env`, mas só o nome do papel é documentado, nunca o valor.
- Dados pessoais de usuários (o `data/chatMemory.json` contém mensagens reais de jogadores e não é indexado).
- Frases prontas de resposta. Os documentos guardam fatos; a IA escreve.

## Como o retriever escolhe

`ai/knowledge-loader.js`:

1. Normaliza a pergunta (gíria, sinônimos, acentos).
2. Detecta a **arena**: `vehix`, `atlas` ou `ascend`. Documentos de outra arena são eliminados para não misturar regras. Documentos de `geral`, `tickets` e `moderacao` nunca são eliminados.
3. Pontua por palavra-chave, título, comando e intenção (`deletar`, `registro`, `bloquear`, `consultar`), com peso de prioridade.
4. Extrai só o trecho relevante do documento, incluindo a seção de dados e a seção seguinte quando há orçamento.
5. Se a pergunta trouxer Mixing systems, avisa o modelo para não misturar.

Teto de contexto: **2400 caracteres** (ver §38/§39 do manifesto: cabe em `num_ctx=4096` junto com as regras).
