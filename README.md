<p align="center">
  <img src="https://www.image2url.com/r2/default/images/1777332207044-62c22e8f-5ca3-4415-8445-b1aed5c90971.png" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/branch-dev-orange?style=for-the-badge">
  <img src="https://img.shields.io/badge/status-em_desenvolvimento-yellow?style=for-the-badge">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-7.0.0-4f46e5?style=for-the-badge">
  <img src="https://img.shields.io/badge/node-18%2B-22c55e?style=for-the-badge">
  <img src="https://img.shields.io/badge/discord.js-v14-5865F2?style=for-the-badge">
  <img src="https://img.shields.io/badge/mongodb-Mongoose-47A248?style=for-the-badge">
</p>

<h1 align="center">𝙷𝚘𝚜𝚝𝚅𝚒𝚕𝚕𝚎 • 𝙱𝙾𝚃</h1>

<p align="center">
Bot multifuncional para Discord com Inteligência Artificial, moderação avançada, tickets inteligentes, memória contextual e automações.
</p>

<p align="center">
<b>Made by Y2k_Nat</b>
</p>

---

# ✦ Sobre

O **HostVille BOT** é uma plataforma completa para servidores Discord, reunindo IA, moderação, atendimento automático, sistema de tickets, memória de conversas e diversas ferramentas administrativas.

Toda a IA utiliza o **Kilo Code AI Gateway** (`KILO_BASE_URL`, `KILO_DEFAULT_MODEL`), com memória armazenada em **MongoDB**.

---

# ✦ Recursos

```txt
🤖 Inteligência Artificial
🧠 Memória contextual
🎭 Personalidades da IA
🎫 Tickets inteligentes
🛡 Sistema completo de moderação
⚠ Sistema de advertências
🚫 Anti Spam
🔗 Anti Links
📊 Estatísticas
👋 Sistema de boas-vindas
🖼 Análise de imagens
🎤 Suporte a mensagens de voz
📈 Aprendizado contextual
⚙ Configuração por servidor
```

---

# ✦ Inteligência Artificial

✔ Conversa naturalmente

✔ Possui memória das conversas

✔ Aprende o contexto do servidor

✔ Múltiplos modos de personalidade

✔ Atendimento automático

✔ Responde dúvidas

✔ Mantém contexto entre mensagens

---

# ✦ Sistema de Tickets

• Suporte

• Dúvidas

• Denúncias

• Atendimento utilizando IA

• Respostas automáticas

---

# ✦ Sistema de Moderação

✔ Advertências

✔ Kick

✔ Ban

✔ Timeout

✔ Limpeza de mensagens

✔ Anti Spam

✔ Anti Links

✔ Filtro de palavras

✔ Logs

---

# ✦ Memória

As conversas ficam armazenadas no MongoDB.

Isso permite que a IA:

- lembre conversas anteriores;
- mantenha contexto;
- adapte suas respostas ao servidor;
- utilize informações importantes durante o atendimento.

---

# ✦ IA

A IA funciona utilizando:

• Kilo Code AI Gateway

• Modelo configurável no `.env`

• MongoDB

• Personalidades configuráveis

• Contexto de conversas

---

# ✦ Banco de Dados

MongoDB

Coleções utilizadas:

• Chat Memory

• Context Memory

• Staff Learning

• Configurações

• Estatísticas

---

# ✦ Tecnologias

```json
{
  "discord.js": "^14",
  "mongoose": "^9",
  "dotenv": "^16",
  "chalk": "^4"
}
```

---

# ✦ Configuração

1. `npm ci`
2. `cp .env.example .env` e preencha
3. `npm run validar:env`
4. `npm start`

---

# ✦ Testes

```bash
npm ci
npm run test:all
```

> O `test:all` roda cada arquivo de teste em loop e não para no primeiro erro.
> Os testes live (`kilo.live`, `kilo-fallback`) ficam de fora.

---

# ✦ MemoryWatcher

> O `MemoryWatcher` está desligado desde a v6.0.0. O código fica em
> `managers/MemoryWatcher.js` para referência. Pendings criados pelo
> `StaffLearner` não são executados.

---

# ✦ Objetivos

✔ Atendimento inteligente

✔ Automação

✔ Organização da staff

✔ Moderação completa

✔ IA personalizada

✔ Memória contextual

✔ Sistema escalável

---

# ✦ Status

🟢 Online

⚡ Em desenvolvimento constante

🧠 IA integrada

💾 MongoDB

🤖 Kilo AI

---

<p align="center">
<b>© 2026 HostVille BOT • Made by Y2k_Nat</b>
</p>
