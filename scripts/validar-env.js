require('dotenv').config();
const fs = require('fs');
const path = require('path');

const OBRIGATORIAS = ['TOKEN', 'CLIENT_ID', 'OWNER_ID', 'KILO_API_KEY', 'MONGO_URI'];
const NOVAS = {
    IMAGE_ANALYZER_ENABLED: 'false',
    IMAGE_ANALYZER_CHANNEL_ID: '',
    IMAGE_ANALYZER_MODEL: '',
    TASK_MAX_TOKENS: '8000',
};

const faltando = OBRIGATORIAS.filter(k => !process.env[k]);
if (faltando.length) {
    console.error('❌ Obrigatórias ausentes:', faltando.join(', '));
    process.exit(1);
}

const ausentes = Object.keys(NOVAS).filter(k => process.env[k] === undefined);
if (ausentes.length) {
    console.warn('⚠ Novas variáveis ausentes (features ficam no default):');
    for (const k of ausentes) console.warn(`   ${k}=${NOVAS[k]}`);
}

const lidas = new Set(
    fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8')
        .match(/process\.env\.[A-Z_0-9]+/g)
        .map(s => s.replace('process.env.', ''))
);
const noEnv = Object.keys(process.env)
    .filter(k => /^[A-Z][A-Z_0-9]{2,}$/.test(k))
    .filter(k => !lidas.has(k))
    .filter(k => !['NODE_ENV', 'PATH', 'HOME', 'PWD', 'TERM', 'SHELL'].includes(k));

if (noEnv.length) {
    console.warn('⚠ Variáveis no .env que o config.js não lê (possível typo):');
    for (const k of noEnv) console.warn(`   ${k}`);
}

console.log('✅ .env validado');