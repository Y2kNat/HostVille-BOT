#!/data/data/com.termux/files/usr/bin/bash
# HostVille BOT — sobe com o gateway do Kilo Code
#
# POR QUE NAO INICIA NADA LOCAL:
# A IA do bot é 100% remota agora: o Kilo AI Gateway
# (https://ai-gateway.kilo.ai/api/v1) fala o protocolo OpenAI e autentica
# com KILO_API_KEY. Não há daemon, não há signin interativo, não há modelo
# para "puxar" — só a chave e o nome do modelo no .env.
#
# Este script é o MESMO do ~/start-main.sh (o que o start-system.sh chama
# de verdade). Fica aqui para quem prefere o caminho dentro do projeto.
#
# Uso:
#   bash start-main.sh              # primeiro plano
#   bash start-main.sh --background # destacado
set -u

DIR="/data/data/com.termux/files/home/HostVille-BOT"
cd "$DIR" || { echo "❌ Não encontrei $DIR"; exit 1; }

# garante as chaves do Kilo no .env (sem sobrescrever o que ja existe)
grep -q "^KILO_API_KEY=" .env || printf '\nKILO_API_KEY=\n' >> .env
grep -q "^KILO_BASE_URL=" .env || printf 'KILO_BASE_URL=https://ai-gateway.kilo.ai/api/v1\n' >> .env
grep -q "^KILO_DEFAULT_MODEL=" .env || printf 'KILO_DEFAULT_MODEL=\n' >> .env

# mata APENAS a instância deste bot (HostVille-BOT).
# NAO usa pkill -f "node index.js": isso mataria os outros bots
# (Utility, Warn, Atlas, Vehix, Ascend, Insight) que tambem rodam
# node index.js em pastas diferentes. Mata só o deste DIR.
MY_PIDS=$(pgrep -f "node index.js" 2>/dev/null || true)
for pid in $MY_PIDS; do
    cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || echo "")
    if [ "$cwd" = "$DIR" ]; then
        kill "$pid" 2>/dev/null
    fi
done
sleep 1

# Nao chama `node` do PATH: neste aparelho o PATH tem /usr/local/bin na
# frente, e ali mora o node do proot-distro, que QUEBRA dentro do tmux
# ("invalid ELF header" no libc.so). Os outros bots usam o do Termux.
NODE="/data/data/com.termux/files/usr/bin/node"
[ -x "$NODE" ] || NODE="$(command -v node 2>/dev/null || true)"

LOG="logs/bot-$(date +%d-%m-%Y).log"
mkdir -p logs

echo "🤖 Iniciando HostVille BOT (gateway Kilo)..."
if [ "${1:-}" = "--background" ]; then
    # Nao redireciona o stdout para o log: o utils/logger.js JA grava
# cada linha no arquivo. Redirecionar tambem duplicava tudo.
    nohup "$NODE" index.js >/dev/null 2>&1 &
    disown 2>/dev/null || true
    echo "✅ Bot iniciado em background (PID $!)"
else
    # O stdout vai para o painel do tmux (da para ver o bot ao vivo);
    # o arquivo de log continua limpo porque o logger ja grava nele.
    exec "$NODE" index.js
fi
