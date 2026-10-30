const kb = require('../ai/knowledge-loader');
const rules = require('../ai/system/internal-rules');

// O prompt é MONTADO a partir de ai/system/internal-rules.js.
// Não escreva regra aqui: edite aquele arquivo.

function lista(items) {
    return items.map(item => '- ' + item).join('\n');
}

function taskBlock() {
    return `SUA TAREFA: responda a pergunta do usuário usando SOMENTE o CONHECIMENTO acima.

FORMATO DA RESPOSTA (obrigatório):
${lista(rules.format)}

Se faltar informação no CONHECIMENTO, responda SÓ: "${rules.FALLBACK}"`;
}

function antiInventionBlock() {
    return `COMO USAR O CONHECIMENTO:
${lista(rules.knowledge)}`;
}

function commandsBlock() {
    return `COMANDOS QUE EXISTEM (não invente outros):
${lista(rules.commands)}`;
}

function securityBlock() {
    return `SEGURANÇA:
${lista(rules.security)}`;
}

function responseRules() {
    return [taskBlock(), antiInventionBlock(), commandsBlock(), securityBlock()].join('\n\n');
}

function withKnowledge(question, extra = '') {
    const { context, docs } = kb.buildContext(question);
    let block = '';
    if (context) block = `CONHECIMENTO DA BASE (${docs.join(', ')}):\n${context}\n\n`;
    return block + responseRules() + (extra ? '\n\n' + extra : '');
}

module.exports = {
    antiInventionBlock,
    withKnowledge,
    responseRules,
    taskBlock,
    commandsBlock,
    securityBlock
};
