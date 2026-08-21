// models/auditLogModel.js
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    eventType: { type: String, required: true }, 
    severity: { type: String, enum: ['INFO', 'WARNING', 'CRITICAL'], default: 'INFO' },
    source: { type: String, required: true }, 
    message: { type: String, required: true },
    details: { type: mongoose.Schema.Types.Mixed }, 
    createdAt: { type: Date, default: Date.now, expires: '90d' }
});

module.exports = mongoose.model('AuditLog', auditLogSchema);