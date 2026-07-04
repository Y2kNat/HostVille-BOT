module.exports = {
    registro: {
        questions: [
            {
                keywords: ['registro', 'registrar', 'cadastro', 'cadastrar', 'inscrever'],
                response: '📌 Para se registrar, acesse o canal <#ID_DO_CANAL> e siga o passo a passo fixado.'
            },
            {
                keywords: ['veiculo', 'veículo', 'carro', 'moto', 'automovel'],
                response: '🚗 O registro de veículos é feito no painel em jogo: /registrar-veiculo.'
            },
            {
                keywords: ['aprovado', 'aprovação', 'demora', 'tempo', 'quanto tempo'],
                response: '⏰ O tempo de aprovação é de até 24 horas.'
            },
            {
                keywords: ['reprovado', 'recusado', 'negado', 'rejeitado'],
                response: '❌ Verifique o motivo no canal de registro e tente novamente.'
            }
        ]
    },
    suporte: {
        questions: [
            {
                keywords: ['ip', 'conectar', 'entrar', 'conexão', 'connect'],
                response: '🌐 IP: jogar.hostville.com | Porta: 30120\nF8 → connect jogar.hostville.com'
            },
            {
                keywords: ['bug', 'erro', 'problema', 'crash', 'travando'],
                response: '🐛 Reporte bugs no canal <#bugs> com prints e passo a passo.'
            },
            {
                keywords: ['whitelist', 'wl', 'pass', 'senha'],
                response: '📋 Whitelist: preencha o formulário em <#whitelist>. Análise em até 24h.'
            },
            {
                keywords: ['discord', 'link', 'convite', 'dc'],
                response: '🔗 Discord: https://discord.gg/hostville'
            },
            {
                keywords: ['regras', 'regra', 'normas', 'proibido', 'permitido'],
                response: '📜 Leia as regras em <#regras> para evitar punições.'
            },
            {
                keywords: ['staff', 'admin', 'adm', 'moderador', 'equipe'],
                response: '👥 Equipe disponível das 08h às 22h.'
            },
            {
                keywords: ['doar', 'doação', 'vip', 'compra', 'preço', 'valor'],
                response: '💎 Planos VIP: <#doacoes> ou https://hostville.com/doar'
            },
            {
                keywords: ['denuncia', 'denunciar', 'reportar', 'hacker', 'cheater'],
                response: '🚨 Use /report no jogo com provas (prints/vídeos).'
            }
        ]
    }
};
