const express = require('express');
const cors = require('cors');
const mongoose = require('../database/mongo');
const Credential = require('../models/Credential');
const Memory = require('../models/Memory');
const Pending = require('../models/Pending');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'hostville-secret-key-2024';

// ============================================
// MIDDLEWARE DE AUTENTICAÇÃO
// ============================================
function auth(req, res, next) {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) {
        res.status(401).json({ error: 'Token inválido' });
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        next();
    };
}

// ============================================
// ROTA: LOGIN
// ============================================
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    const cred = await Credential.findOne({ user: username, password, active: true });
    if (!cred) return res.json({ error: 'Usuário ou senha inválidos' });
    
    // Atualizar último login
    cred.lastLogin = new Date();
    await cred.save();
    
    const token = jwt.sign(
        { id: cred._id, user: cred.user, role: cred.role, guildId: cred.guildId },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
    
    res.json({ token, user: { name: cred.user, role: cred.role, guildId: cred.guildId } });
});

// ============================================
// ROTA: GERAR CREDENCIAL (SÓ FULL)
// ============================================
app.post('/api/credentials', auth, requireRole('full'), async (req, res) => {
    const { user, role, guildId, password } = req.body;
    
    if (!['full', 'owner', 'admin'].includes(role)) {
        return res.json({ error: 'Role inválida' });
    }
    
    await Credential.create({
        user,
        password,
        role,
        guildId: guildId || null,
        createdBy: req.user.user
    });
    
    res.json({ ok: true });
});

// ============================================
// ROTA: LISTAR CREDENCIAIS (SÓ FULL)
// ============================================
app.get('/api/credentials', auth, requireRole('full'), async (req, res) => {
    const credentials = await Credential.find({ active: true })
        .select('-password')
        .sort({ createdAt: -1 })
        .lean();
    res.json({ credentials });
});

// ============================================
// ROTA: DASHBOARD (TODOS AUTENTICADOS)
// ============================================
app.get('/api/dashboard', auth, async (req, res) => {
    const guildFilter = req.user.role !== 'full' ? { guildId: req.user.guildId } : {};
    
    const [ticketsAtivos, conhecimentos, conversas, pendentes] = await Promise.all([
        Memory.countDocuments({ category: 'ticket', understood: false, ...guildFilter }),
        Memory.countDocuments({ category: 'conhecimento', ...guildFilter }),
        Memory.countDocuments({ category: { $in: ['conversa', 'chat'] }, ...guildFilter }),
        Pending.countDocuments({ done: false, ...guildFilter })
    ]);
    
    res.json({ ticketsAtivos, conhecimentos, conversas, pendentes });
});

// ============================================
// ROTA: MEMÓRIAS (TODOS AUTENTICADOS)
// ============================================
app.get('/api/memories', auth, async (req, res) => {
    const { page = 1, limit = 50 } = req.query;
    const guildFilter = req.user.role !== 'full' ? { guildId: req.user.guildId } : {};
    
    const memories = await Memory.find(guildFilter)
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();
    
    const total = await Memory.countDocuments(guildFilter);
    
    res.json({ memories, total, page, pages: Math.ceil(total / limit) });
});

// ============================================
// ROTA: PENDÊNCIAS (TODOS AUTENTICADOS)
// ============================================
app.get('/api/pendings', auth, async (req, res) => {
    const guildFilter = req.user.role !== 'full' ? { 'data.guildId': req.user.guildId } : {};
    
    const pendings = await Pending.find({ done: false, ...guildFilter })
        .sort({ createdAt: -1 })
        .lean();
    
    res.json({ pendings });
});

// ============================================
// ROTA: ADICIONAR PENDÊNCIA (FULL E OWNER)
// ============================================
app.post('/api/pendings', auth, requireRole('full', 'owner'), async (req, res) => {
    const { type, data } = req.body;
    
    if (!['aprender', 'corrigir', 'comando', 'acao', 'responder', 'modo'].includes(type)) {
        return res.json({ error: 'Tipo inválido' });
    }
    
    await Pending.create({ type, data });
    res.json({ ok: true });
});

// ============================================
// ROTA: TICKETS (TODOS AUTENTICADOS)
// ============================================
app.get('/api/tickets', auth, async (req, res) => {
    const guildFilter = req.user.role !== 'full' ? { guildId: req.user.guildId } : {};
    
    const tickets = await Memory.find({ category: 'ticket', ...guildFilter })
        .sort({ timestamp: -1 })
        .limit(100)
        .lean();
    
    res.json({ tickets });
});

// ============================================
// INICIAR
// ============================================
const PORT = process.env.API_PORT || 3333;
app.listen(PORT, () => {
    console.log(`🔌 API rodando na porta ${PORT}`);
});