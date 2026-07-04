module.exports = {
    // Mensagem de boas-vindas
    welcomeMessage: `Bem-vindo(a), {user}! 👋
É um prazer ter você em nosso servidor. Aqui você está dando início à sua jornada em nossa comunidade, e esperamos que tenha uma ótima experiência conosco!
Aqui você poderá desenvolver seu personagem, criar sua história e evoluir dentro da cidade de forma realista e envolvente, sempre respeitando o ambiente e os outros jogadores.
Nosso objetivo é proporcionar uma experiência divertida, organizada e imersiva para todos os membros.
Seja bem-vindo e aproveite sua nova vida na cidade! 🌆`,

    // Pergunta inicial
    firstQuestion: `Baseado na sua história, qual será seu emprego 👷? 
Recomendamos os empregos públicos: 
🚔 **Polícia** - ☠️ **SWAT** - 🧑‍🚒 **Bombeiros** - 💊 **SAMU**

Gostaria de seguir com os cargos públicos? (responda com **sim** ou **não**)`,

    // Se responder SIM
    responseYes: `Maravilha! Para seguir com os cargos públicos, é necessário que realize o preenchimento do formulário:
📝 **Formulário:** https://hostville.com/formulario-publico

Após o preenchimento, nossa equipe irá analisar seu perfil. Boa sorte! 🍀`,

    // Se responder NÃO
    responseNo: `Ok! Temos disponíveis os empregos abaixo:

🚕 **Taxista** - Transporte passageiros pela cidade
🔧 **Mecânico** - Conserte veículos na oficina
🏪 **Comerciante** - Gerencie sua própria loja
🚚 **Entregador** - Faça entregas pela cidade
🍔 **Cozinheiro** - Trabalhe em restaurantes
🏥 **Médico** - Atenda no hospital
📰 **Jornalista** - Reporte notícias da cidade
⚖️ **Advogado** - Defenda clientes no tribunal
🔫 **Policial** - Patrulhe as ruas

Digite o nome do emprego para saber mais informações, ou digite **"formulário"** para o link de inscrição!`,

    // Informações de cada emprego (para IA responder)
    jobsInfo: {
        taxista: {
            description: 'Transporte passageiros pela cidade de forma legal.',
            requisitos: 'Carteira de motorista, veículo próprio.',
            salario: 'Ganhos por corrida',
            formulario: 'https://hostville.com/formulario-taxista'
        },
        mecanico: {
            description: 'Conserte e customize veículos na oficina.',
            requisitos: 'Curso de mecânica (dentro do jogo).',
            salario: 'Fixo + comissão por serviço',
            formulario: 'https://hostville.com/formulario-mecanico'
        },
        comerciante: {
            description: 'Gerencie sua própria loja na cidade.',
            requisitos: 'Capital inicial para montar o negócio.',
            salario: 'Lucro das vendas',
            formulario: 'https://hostville.com/formulario-comerciante'
        },
        entregador: {
            description: 'Faça entregas para empresas e moradores.',
            requisitos: 'Veículo (moto ou carro).',
            salario: 'Por entrega',
            formulario: 'https://hostville.com/formulario-entregador'
        },
        cozinheiro: {
            description: 'Trabalhe em restaurantes e lanchonetes.',
            requisitos: 'Nenhum requisito inicial.',
            salario: 'Fixo + gorjetas',
            formulario: 'https://hostville.com/formulario-cozinheiro'
        },
        medico: {
            description: 'Atenda pacientes no hospital da cidade.',
            requisitos: 'Curso de medicina (dentro do jogo).',
            salario: 'Fixo + plantões',
            formulario: 'https://hostville.com/formulario-medico'
        },
        jornalista: {
            description: 'Reporte notícias e eventos da cidade.',
            requisitos: 'Equipamento de câmera/foto.',
            salario: 'Por matéria',
            formulario: 'https://hostville.com/formulario-jornalista'
        },
        advogado: {
            description: 'Defenda clientes no tribunal e escritório.',
            requisitos: 'Curso de direito (dentro do jogo).',
            salario: 'Por caso',
            formulario: 'https://hostville.com/formulario-advogado'
        },
        policial: {
            description: 'Patrulhe as ruas e mantenha a ordem.',
            requisitos: 'Curso da academia de polícia.',
            salario: 'Fixo + promoções',
            formulario: 'https://hostville.com/formulario-policial'
        }
    }
};
