const mongoose = require('mongoose');

const pendingInviteSchema = new mongoose.Schema({
    email: { type: String, required: true },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    token: { type: String, required: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    expiresAt: { 
        type: Date, 
        default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // Berlaku 7 hari
    }
}, { timestamps: true });

// Otomatis hapus dokumen jika sudah expired
pendingInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PendingInvite', pendingInviteSchema);