const AuditLog = require('../models/auditLogModel');

const SEVERITY = {
    INFO: 'INFO',
    WARNING: 'WARNING',
    CRITICAL: 'CRITICAL'
};

const EVENT = {
    SEC_COMPROMISE: 'HARDWARE_COMPROMISE_ATTEMPT',
    DATA_INTEGRITY: 'DATA_INTEGRITY_VIOLATION',
    AUTH_FAIL: 'AUTHENTICATION_FAILURE',
    SYS_ERROR: 'SYSTEM_ERROR',
    DEVICE_REG: 'DEVICE_REGISTERED'
};

const EVENT_SEVERITY_MAP = {
    [EVENT.SEC_COMPROMISE]: SEVERITY.CRITICAL,
    [EVENT.DATA_INTEGRITY]: SEVERITY.WARNING,
    [EVENT.AUTH_FAIL]: SEVERITY.WARNING,
    [EVENT.SYS_ERROR]: SEVERITY.CRITICAL,
    [EVENT.DEVICE_REG]: SEVERITY.INFO
};

const logEvent = async (eventType, source, message, details = {}) => {
    try {
        const autoSeverity = EVENT_SEVERITY_MAP[eventType] || SEVERITY.INFO;

        await AuditLog.create({ 
            eventType, 
            severity: autoSeverity, 
            source, 
            message, 
            details 
        });
    } catch (err) {
        console.error('❌ Gagal menulis Audit Log:', err.message);
    }
};

module.exports = { EVENT, logEvent };