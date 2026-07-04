const config = require('../config');

function isAdmin(member) {
    if (!member) return false;
    if (!config.ADMIN_ROLES || config.ADMIN_ROLES.length === 0) return false;
    return member.roles.cache.some(role => 
        config.ADMIN_ROLES.includes(role.id) || config.ADMIN_ROLES.includes(role.name)
    );
}

function isStaff(userId) {
    return config.STAFF_USER_ID.includes(userId);
}

function hasPermission(member, permission) {
    if (!member) return false;
    return member.permissions.has(permission);
}

module.exports = { isAdmin, isStaff, hasPermission };