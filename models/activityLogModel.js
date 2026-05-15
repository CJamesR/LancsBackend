const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        required: true
    },
    // Contoh action: "Menambahkan Node_1", "Mengubah nama Site", "Menghapus Admin"
    action: {
        type: String,
        required: true
    },
    // Detail tambahan (opsional) jika ingin menyimpan data lebih lengkap
    details: {
        type: Object
    }
}, {
    timestamps: true // Otomatis membuat createdAt (sebagai timestamp aktivitas)
});

module.exports = mongoose.model('ActivityLog', activityLogSchema);