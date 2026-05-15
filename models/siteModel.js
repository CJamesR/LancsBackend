const mongoose = require('mongoose');

const siteSchema = new mongoose.Schema({
    name: {type: String, required: true}, // Contoh: "Gudang Utama"
    location: {type: String},

    // 👑 PEMILIK UTAMA (Dulu adminId)
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // 👔 DAFTAR ADMIN BESERTA HAK AKSESNYA
    admins: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        // Daftar spesifik alat yang boleh dikelola Admin ini
        allowedDevices: [{
            type: String
        }],
        // Matrix Hak Akses (Granular Permissions)
        permissions: {
            canAddDevice: { type: Boolean, default: false },
            canRemoveDevice: { type: Boolean, default: false },
            canEditConfig: { type: Boolean, default: false },
            canControlDevice: { type: Boolean, default: false },
            canExportData: { type: Boolean, default: false },
            canClearData: { type: Boolean, default: false }
        }
    }],

    members: [{
        userId: {type: mongoose.Schema.Types.ObjectId, ref: 'User'},
        role: {type: String, enum: ['admin', 'member'], default: 'member'},
        joinedAt: {type: Date, default: Date.now}
    }],

    // 📦 DAFTAR SEMUA ALAT DI SITE INI
    devices: [{type: String}]
}, {
    timestamps: true
});

module.exports = mongoose.model('Site', siteSchema);