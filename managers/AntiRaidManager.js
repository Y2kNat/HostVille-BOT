const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const { logInfo, logWarn, logError, logSuccess } = require('../utils/logger');
const { isStaff } = require('../utils/permissions');

/**
 * AntiRaidManager — detecção e neutralização de raids (Fase 1).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * O QUE É
 * ═══════════════════════════════════════════════════════════════════════
 * Um raid é uma ação coordenada de destruição: um executor (pessoa ou bot
 * comprometido) apaga canais em massa, bane membros em massa ou dispara
 * @everyone repetidamente. Este manager conta essas ações por executor,
 * dentro de uma janela deslizante (default 3 min), e BANE o executor quando
 * o limite estoura — antes que o estrago continue.
 *
 * Por que BAN e não kick: kick é reversível e o executor volta com o
 * convite; num raid o objetivo é cortar o acesso na hora. Ban é a resposta
 * proporcional a uma ação destrutiva em massa.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * COMO IDENTIFICA O EXECUTOR
 * ═══════════════════════════════════════════════════════════════════════
 * - channelDelete / channelCreate / guildBanAdd → via Audit Log (fetchAuditLogs).
 * - @everyone / @here → direto do `messageCreate` (autor da mensagem).
 *
 * Se o executor NÃO for identificado (audit log fora do ar, sem permissão
 * View Audit Log, ou entrada ainda não registrada), NÃO bane: loga como
 * "desconhecido". Banir o alvo errado num raid seria pior que não banir.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WHITELIST
 * ═══════════════════════════════════════════════════════════════════════
 * Quem não é banido nem sob raid:
 *   - owner do servidor, o próprio bot, staff da rede, ANTI_RAID_TRUSTED
 *   - membro no servidor há >= 1 dia
 *   - membro com cargo admin há >= 1 dia (rastreado em admin-grants.json)
 *   - bot no servidor há >= 1 dia e fora da lista de suspeitos
 *
 * A regra dos "3 dias" do dono: membros com >= 3 dias ficam sob ATENÇÃO
 * (não são whitelist por tempo de casa, mas o são por staff/owner/trusted).
 * A whitelist por tempo é de 1 dia — quem tem menos de 1 dia de servidor é
 * o perfil típico de conta descartável de raid e NÃO é protegido.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * PERSISTÊNCIA (arquivo local, como warnings.json / ChatMemory)
 * ═══════════════════════════════════════════════════════════════════════
 * O bot roda no Termux, onde a rede cai. Perder o registro de "quem ganhou
 * cargo admin quando" significa perder a whitelist de admin legítimo — e um
 * restart no meio de um raid daria passe livre para o executor. Por isso a
 * escrita é síncrona e atômica (tmp + rename).
 */

const FILE_GRANTS = process.env.ANTIRAID_GRANTS_FILE
    ? path.resolve(process.env.ANTIRAID_GRANTS_FILE)
    : path.join(__dirname, '..', 'data', 'antiraid-admin-grants.json');

const FILE_INCIDENTS = process.env.ANTIRAID_INCIDENTS_FILE
    ? path.resolve(process.env.ANTIRAID_INCIDENTS_FILE)
    : path.join(__dirname, '..', 'data', 'antiraid-incidents.json');

/** 1 dia em ms. Usado para "cargo admin há >= 1 dia" (whitelist de admin legítimo). */
const UM_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Whitelist por TEMPO DE CASA.
 *
 * 0 (default) = DESLIGADO: nenhum membro comum é protegido só por ter conta
 * antiga. É o modo mais seguro contra raid — uma conta estabelecida
 * comprometida (o caso perigoso) continua sujeita ao ban.
 *
 * > 0 = membros com >= N dias de servidor são considerados "lista de atenção"
 * (estabelecidos) e NÃO são banidos automaticamente. Ajuste conforme a
 * tolerância do servidor. A staff/owner/trusted são sempre whitelist à parte.
 */
const TRUST_DAYS = parseInt(process.env.ANTI_RAID_TRUST_DAYS) || 0;
const TRUST_MS = TRUST_DAYS * UM_DIA_MS;

/**
 * Estado em memória: Map<guildId, Map<executorId, { deletes:[], creates:[], bans:[], everyones:[] }>>.
 * Timestamps em ms. Podado a cada record() pela janela deslizante.
 */
const estado = new Map();

/** Cooldown por executor após trigger, para não repetir o ban em rajada. */
const cooldown = new Map();
const COOLDOWN_MS = 60 * 1000;

/** Lock por executor: evita dois triggers concorrentes banindo o mesmo. */
const emBan = new Set();

/** Cache do client, injetado no boot (precisa dele para buscar canal/guild). */
let _client = null;

/** Se o bot não tiver permissão de ler audit log, a feature se desliga. */
let auditDisponivel = null; // null = ainda não checado

// ─── Persistência (admin grants) ──────────────────────────────────────────

function atomicWrite(file, conteudo) {
    const tmp = file + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, conteudo);
    fs.renameSync(tmp, file);
}

function carregarGrants() {
    try {
        const o = JSON.parse(fs.readFileSync(FILE_GRANTS, 'utf8'));
        return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    } catch (e) {
        return {};
    }
}

function salvarGrants(obj) {
    try {
        atomicWrite(FILE_GRANTS, JSON.stringify(obj, null, 2));
    } catch (e) {
        logError('AntiRaid: falha ao gravar admin-grants.json: ' + e.message);
    }
}

function registrarIncidente(registro) {
    try {
        let lista = [];
        try {
            const o = JSON.parse(fs.readFileSync(FILE_INCIDENTS, 'utf8'));
            if (Array.isArray(o)) lista = o;
        } catch (e) { /* arquivo ainda não existe */ }
        lista.push(registro);
        // teto de 200 incidentes para o arquivo não crescer sem limite
        if (lista.length > 200) lista = lista.slice(-200);
        atomicWrite(FILE_INCIDENTS, JSON.stringify(lista, null, 2));
    } catch (e) {
        logError('AntiRaid: falha ao gravar incidentes: ' + e.message);
    }
}

// ─── Whitelist ────────────────────────────────────────────────────────────

/**
 * O executor é confiável e NÃO deve ser banido por raid?
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} executorId
 * @returns {Promise<boolean>}
 */
async function isWhitelisted(guild, executorId) {
    if (!guild || !executorId) return true; // na dúvida, não pune

    // 1. owner do servidor
    if (guild.ownerId === executorId) return true;

    // 2. o próprio bot
    if (_client && _client.user && _client.user.id === executorId) return true;

    // 3. lista manual de confiáveis
    if (Array.isArray(config.ANTI_RAID.TRUSTED) && config.ANTI_RAID.TRUSTED.includes(executorId)) return true;

    // 4. staff da rede (lista global, mesmo bypass da moderação)
    if (isStaff(executorId)) return true;

    let member = null;
    try {
        member = await guild.members.fetch(executorId).catch(() => null);
    } catch (e) { member = null; }
    if (!member) return true; // não achou o membro → não pune (evita falso positivo)

    const entrouHa = member.joinedAt ? (Date.now() - member.joinedAt.getTime()) : Infinity;

    // 5. membro comum: só é whitelist se TRUST_DAYS > 0 E tiver tempo de casa
    //    >= TRUST_DAYS (a "lista de atenção" de membros estabelecidos).
    //    Default TRUST_DAYS=0 → nenhum membro comum é protegido por tempo,
    //    porque o threat model é justamente uma conta estabelecida virando
    //    raid. Ela é monitorada, mas o gatilho bane mesmo assim.
    const temCargoAdmin = Array.isArray(config.ADMIN_ROLES)
        && config.ADMIN_ROLES.some(r => member.roles.cache.has(r));
    if (!temCargoAdmin && TRUST_MS > 0 && entrouHa >= TRUST_MS) return true;

    // 6. membro com cargo admin: precisa ter o cargo há >= 1 dia
    if (temCargoAdmin) {
        if (entrouHa < UM_DIA_MS) return false; // admin que acabou de entrar
        const grants = carregarGrants();
        const doGuild = grants[guild.id] || {};
        const registro = doGuild[executorId];
        if (!registro || !registro.grantedAt) {
            // tem o cargo mas não sabemos desde quando: pede o registro do
            // evento. Se não há, tratamos como admin legítimo para não punir
            // staff por falta de rastreamento — mas logamos.
            return true;
        }
        return (Date.now() - registro.grantedAt) >= UM_DIA_MS;
    }

    // 7. bot (member.user.bot) com >= 1 dia e fora dos suspeitos
    if (member.user && member.user.bot) {
        return entrouHa >= UM_DIA_MS;
    }

    // membro comum com < 1 dia de servidor: NÃO é whitelist
    return false;
}

// ─── Rastreamento de cargos admin (guildMemberUpdate) ──────────────────────

/**
 * Chamado no guildMemberUpdate: registra quando um membro ganha/perde um
 * cargo que está em ADMIN_ROLES, para a whitelist saber "admin desde quando".
 *
 * @param {import('discord.js').GuildMember} oldMember
 * @param {import('discord.js').GuildMember} newMember
 */
function onMemberUpdate(oldMember, newMember) {
    try {
        if (!newMember || !newMember.guild) return;
        const idsAdmin = Array.isArray(config.ADMIN_ROLES) ? config.ADMIN_ROLES : [];
        if (idsAdmin.length === 0) return;

        const antes = oldMember && oldMember.roles ? oldMember.roles.cache : new Map();
        const depois = newMember.roles.cache;

        const ganhou = idsAdmin.find(id => !antes.has(id) && depois.has(id));
        const perdeu = idsAdmin.find(id => antes.has(id) && !depois.has(id));

        if (!ganhou && !perdeu) return;

        const grants = carregarGrants();
        const guildId = newMember.guild.id;
        if (!grants[guildId]) grants[guildId] = {};

        if (ganhou) {
            grants[guildId][newMember.id] = { roleId: ganhou, grantedAt: Date.now() };
            logInfo(`AntiRaid: cargo admin ${ganhou} concedido a ${newMember.user ? newMember.user.tag : newMember.id} — registrado para whitelist`);
        } else if (perdeu && grants[guildId][newMember.id]) {
            delete grants[guildId][newMember.id];
        }
        salvarGrants(grants);
    } catch (e) {
        logError('AntiRaid: erro no onMemberUpdate: ' + e.message);
    }
}

// ─── Verificação de permissão de audit log (boot) ──────────────────────────

/**
 * Verifica, no boot, se o bot consegue ler o Audit Log. Sem isso a detecção
 * por channelDelete/create/ban fica cega e a feature deve avisar.
 *
 * @param {import('discord.js').Client} client
 */
async function verificarPermissoes(client) {
    try {
        if (!config.ANTI_RAID.ENABLED) return;
        for (const guild of client.guilds.cache.values()) {
            const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
            if (!me) continue;
            const pode = me.permissions.has('ViewAuditLog');
            if (!pode) {
                auditDisponivel = false;
                logWarn(`AntiRaid: sem permissão "View Audit Log" em ${guild.name} — detecção por delete/create/ban fica cega (só @everyone funciona).`);
            } else if (auditDisponivel === null) {
                auditDisponivel = true;
            }
        }
        if (auditDisponivel !== false) {
            logInfo(`AntiRaid: ativo (janela ${config.ANTI_RAID.WINDOW_MS / 1000}s | deletes>=${config.ANTI_RAID.DELETE_THRESHOLD} | bans>=${config.ANTI_RAID.BAN_THRESHOLD} | @everyone>=${config.ANTI_RAID.EVERYONE_THRESHOLD})`);
        }
    } catch (e) {
        logWarn('AntiRaid: não consegui verificar permissões de audit log: ' + e.message);
    }
}

// ─── Contadores e gatilho ─────────────────────────────────────────────────

function getEstadoGuild(guildId) {
    if (!estado.has(guildId)) estado.set(guildId, new Map());
    return estado.get(guildId);
}

function getEntrada(guildId, executorId) {
    const g = getEstadoGuild(guildId);
    if (!g.has(executorId)) {
        g.set(executorId, { deletes: [], creates: [], bans: [], everyones: [] });
    }
    return g.get(executorId);
}

function limparEstado(guildId, executorId) {
    const g = estado.get(guildId);
    if (g) g.delete(executorId);
}

function contar(arr, now) {
    return arr.filter(t => now - t < config.ANTI_RAID.WINDOW_MS);
}

/**
 * Registra uma ação destrutiva do executor e checa os limites. Se algum
 * estourou, dispara o ban (uma vez por cooldown/lock).
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} executorId
 * @param {'deletes'|'creates'|'bans'|'everyones'} tipo
 */
async function record(guild, executorId, tipo) {
    if (!config.ANTI_RAID.ENABLED) return;
    if (!guild || !executorId) return;

    const now = Date.now();

    // cooldown: recém-baniu esse executor, ignora novas ações por 60s
    const cooldownAte = cooldown.get(guild.id + ':' + executorId) || 0;
    if (now < cooldownAte) return;

    // executor já está sendo banido (lock): não duplica
    const chaveLock = guild.id + ':' + executorId;
    if (emBan.has(chaveLock)) return;

    const entrada = getEntrada(guild.id, executorId);
    if (!entrada[tipo]) entrada[tipo] = [];
    entrada[tipo].push(now);

    // poda tudo que saiu da janela
    entrada.deletes = contar(entrada.deletes, now);
    entrada.creates = contar(entrada.creates, now);
    entrada.bans = contar(entrada.bans, now);
    entrada.everyones = contar(entrada.everyones, now);

    const motivos = [];
    if (entrada.deletes.length >= config.ANTI_RAID.DELETE_THRESHOLD) motivos.push(`${entrada.deletes.length} canais apagados`);
    if (entrada.creates.length >= config.ANTI_RAID.CREATE_THRESHOLD) motivos.push(`${entrada.creates.length} canais criados`);
    if (entrada.bans.length >= config.ANTI_RAID.BAN_THRESHOLD) motivos.push(`${entrada.bans.length} membros banidos`);
    if (entrada.everyones.length >= config.ANTI_RAID.EVERYONE_THRESHOLD) motivos.push(`${entrada.everyones.length} @everyone/@here`);

    if (motivos.length === 0) return;

    await trigger(guild, executorId, {
        motivos,
        deletes: entrada.deletes.length,
        creates: entrada.creates.length,
        bans: entrada.bans.length,
        everyones: entrada.everyones.length,
    });
}

// ─── Resposta: banir + alertar ────────────────────────────────────────────

async function trigger(guild, executorId, resumo) {
    const chaveLock = guild.id + ':' + executorId;
    if (emBan.has(chaveLock)) return;
    emBan.add(chaveLock);

    try {
        // whitelist final (checada na hora do gatilho, com dados frescos)
        if (await isWhitelisted(guild, executorId)) {
            logInfo(`AntiRaid: ${executorId} atingiu limite mas é whitelisted — ignorado (${resumo.motivos.join(', ')})`);
            limparEstado(guild.id, executorId);
            return;
        }

        let member = null;
        try {
            member = await guild.members.fetch(executorId).catch(() => null);
        } catch (e) { member = null; }

        const user = member ? member.user : null;
        const tag = user ? user.tag : executorId;
        const motivoBan = `Anti-Raid: ${resumo.motivos.join(', ')} em ${config.ANTI_RAID.WINDOW_MS / 1000}s`;

        let banOk = false;
        try {
            // Se o executor ainda tiver cargo admin, tenta remover antes de
            // banir (ban de quem tem cargo acima do bot falha).
            if (member && member.bannable === false && member.moderatable) {
                try { await member.roles.remove(member.roles.cache.filter(r => r.permissions.has('Administrator'))); } catch (e) {}
            }
            await guild.members.ban(executorId, { reason: motivoBan + ' (HostVille • Anti-Raid)' });
            banOk = true;
            logSuccess(`Anti-Raid: ${tag} (${executorId}) BANIDO — ${resumo.motivos.join(', ')}`);
        } catch (e) {
            logError(`Anti-Raid: falha ao banir ${tag} (${executorId}): ${e.message}`);
        }

        // cooldown mesmo se o ban falhou, para não martelar o audit log
        cooldown.set(chaveLock, Date.now() + COOLDOWN_MS);
        limparEstado(guild.id, executorId);

        // persiste o incidente
        registrarIncidente({
            ts: Date.now(),
            guildId: guild.id,
            guildName: guild.name,
            executorId,
            executorTag: tag,
            banOk,
            resumo,
        });

        await enviarAlerta(guild, executorId, tag, resumo, member, banOk);
    } finally {
        emBan.delete(chaveLock);
    }
}

function dataBR(ts) {
    try {
        return new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    } catch (e) { return String(ts); }
}

/**
 * Envia o embed de alerta no canal configurado (ou LOG_CHANNEL_ID como
 * fallback). Inclui os detalhes do suspeito: conta recente, tempo de
 * servidor, cargos.
 */
async function enviarAlerta(guild, executorId, tag, resumo, member, banOk) {
    try {
        const canalId = config.ANTI_RAID.ALERT_CHANNEL_ID || config.LOG_CHANNEL_ID;
        if (!canalId || !_client) {
            logWarn('Anti-Raid: sem canal de alerta configurado — incidente só no console/arquivo.');
            return;
        }

        const canal = _client.channels.cache.get(canalId)
            || await _client.channels.fetch(canalId).catch(() => null);
        if (!canal || !canal.send) {
            logWarn(`Anti-Raid: canal de alerta ${canalId} não encontrado.`);
            return;
        }

        const user = member ? member.user : null;
        const criacaoConta = user ? user.createdAt : null;
        const contaRecente = criacaoConta && (Date.now() - criacaoConta.getTime()) < 7 * UM_DIA_MS;
        const entrouHa = member && member.joinedAt ? (Date.now() - member.joinedAt.getTime()) : null;
        const membroNovo = entrouHa !== null && entrouHa < UM_DIA_MS;
        const cargos = member ? member.roles.cache.filter(r => r.id !== guild.id).map(r => r.name) : [];

        const embed = new EmbedBuilder()
            .setColor(banOk ? 0xED4245 : 0xEB459E)
            .setTitle(banOk ? '🚨 Anti-Raid: executor banido' : '🚨 Anti-Raid: tentativa de ban falhou')
            .addFields(
                { name: 'Usuário', value: `${tag ? '@' + tag : executorId}\nID: \`${executorId}\``, inline: false },
                { name: 'Ações em ' + (config.ANTI_RAID.WINDOW_MS / 1000) + 's', value: resumo.motivos.join(', '), inline: false },
                { name: 'Conta criada em', value: criacaoConta ? `${dataBR(criacaoConta.getTime())}${contaRecente ? ' ⚠️ **conta recente (<7 dias)**' : ''}` : 'desconhecido', inline: true },
                { name: 'Entrou no servidor', value: member && member.joinedAt ? `${dataBR(member.joinedAt.getTime())}${membroNovo ? ' ⚠️ **membro novo (<1 dia)**' : ''}` : 'desconhecido', inline: true },
                { name: 'Cargos', value: cargos.length ? cargos.slice(0, 15).join(', ') : 'nenhum', inline: false },
                { name: 'Ban', value: banOk ? 'aplicado ✅' : 'falhou ❌ (verificar hierarquia de cargos)', inline: true },
                { name: 'Servidor', value: `${guild.name} (\`${guild.id}\`)`, inline: true },
            )
            .setFooter({ text: 'HostVille • Anti-Raid' })
            .setTimestamp();

        await canal.send({ content: member ? `<@${executorId}>` : undefined, embeds: [embed] });
    } catch (e) {
        logError('Anti-Raid: falha ao enviar alerta: ' + e.message);
    }
}

// ─── Identificação do executor via Audit Log ──────────────────────────────

/**
 * Busca o executor de uma ação no audit log. Retorna o ID do executor ou
 * null. `targetId` é o ID do alvo (canal banido/deletado/criado) para casar
 * a entrada certa quando houver mais de uma recente.
 *
 * @param {import('discord.js').Guild} guild
 * @param {number} type tipo de ação do audit log (10 create, 12 delete, 22 ban)
 * @param {string} [targetId]
 * @returns {Promise<string|null>}
 */
async function executorDoAudit(guild, type, targetId) {
    try {
        const auditLogs = await guild.fetchAuditLogs({ type, limit: 5 });
        const agora = Date.now();
        for (const entry of auditLogs.entries.values()) {
            if (agora - entry.createdTimestamp > 30000) continue; // só ações recentes
            if (targetId && entry.target && entry.target.id !== targetId) continue;
            return entry.executor ? entry.executor.id : null;
        }
        return null;
    } catch (e) {
        return null;
    }
}

// ─── Handlers dos eventos ─────────────────────────────────────────────────

/** channelDelete: apaga canal → conta delete do executor. */
async function handleChannelDelete(channel) {
    try {
        if (!config.ANTI_RAID.ENABLED || !channel || !channel.guild) return;
        if (!await antiRaidLigado(channel.guild.id)) return;
        const executorId = await executorDoAudit(channel.guild, 12, channel.id);
        if (!executorId) {
            logWarn('Anti-Raid: delete de canal sem executor identificado (desconhecido).');
            return;
        }
        await record(channel.guild, executorId, 'deletes');
    } catch (e) {
        logError('AntiRaid: erro no handleChannelDelete: ' + e.message);
    }
}

/** channelCreate: cria canal → conta create do executor. */
async function handleChannelCreate(channel) {
    try {
        if (!config.ANTI_RAID.ENABLED || !channel || !channel.guild) return;
        if (!await antiRaidLigado(channel.guild.id)) return;
        const executorId = await executorDoAudit(channel.guild, 10, channel.id);
        if (!executorId) return;
        await record(channel.guild, executorId, 'creates');
    } catch (e) {
        logError('AntiRaid: erro no handleChannelCreate: ' + e.message);
    }
}

/** guildBanAdd: bane membro → conta ban do executor. */
async function handleGuildBanAdd(guild, user) {
    try {
        if (!config.ANTI_RAID.ENABLED || !guild || !user) return;
        if (!await antiRaidLigado(guild.id)) return;
        const executorId = await executorDoAudit(guild, 22, user.id);
        if (!executorId) {
            logWarn('Anti-Raid: ban sem executor identificado (desconhecido).');
            return;
        }
        await record(guild, executorId, 'bans');
    } catch (e) {
        logError('AntiRaid: erro no handleGuildBanAdd: ' + e.message);
    }
}

/** @everyone / @here: autor da mensagem → conta menção massiva. */
async function handleEveryoneMention(message, userId) {
    try {
        if (!config.ANTI_RAID.ENABLED || !message || !message.guild || !userId) return;
        if (message.author && message.author.bot) return;
        if (!await antiRaidLigado(message.guild.id)) return;
        // Só conta se a menção realmente pegou (@everyone tem permissão ou
        // o texto tem o padrão cru). mentions.everyone já reflete isso.
        const pegou = message.mentions && (message.mentions.everyone || /@everyone|@here/.test(message.content || ''));
        if (!pegou) return;
        await record(message.guild, userId, 'everyones');
    } catch (e) {
        logError('AntiRaid: erro no handleEveryoneMention: ' + e.message);
    }
}

// ─── Feature gate ─────────────────────────────────────────────────────────

/**
 * A feature anti_raid do FeatureRegistry desliga por servidor. O registro de
 * eventos é global, então cada handler consulta o gate. require lazy evita
 * ciclo (FeatureRegistry não importa o AntiRaidManager).
 */
async function antiRaidLigado(guildId) {
    try {
        const Features = require('./FeatureRegistry');
        return Features.ligadoSync('anti_raid', guildId);
    } catch (e) {
        return config.ANTI_RAID.ENABLED;
    }
}

// ─── Boot ─────────────────────────────────────────────────────────────────

/**
 * Injetar o client e verificar permissões. Chamado no ready.js.
 * @param {import('discord.js').Client} client
 */
async function start(client) {
    _client = client;
    await verificarPermissoes(client);
}

const AntiRaidManager = {
    start,
    handleChannelDelete,
    handleChannelCreate,
    handleGuildBanAdd,
    handleEveryoneMention,
    onMemberUpdate,
    // exportados para teste
    _record: record,
    _isWhitelisted: isWhitelisted,
    _estado: estado,
    _cooldown: cooldown,
};

module.exports = AntiRaidManager;