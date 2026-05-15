const mongoose = require('mongoose');

const inviteSchema = new mongoose.Schema({
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    siteName: { type: String, required: true },
    inviterName: { type: String, required: true },
    recipientEmail: { type: String, required: true, lowercase: true },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' }
}, { 
    timestamps: true // Otomatis bikin createdAt (Waktu kirim)
});

module.exports = mongoose.model('Invite', inviteSchema);