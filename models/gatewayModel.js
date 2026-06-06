const mongoose = require('mongoose');

// =========================================================================
// GATEWAY MODEL
// Mewakili satu unit Gateway (ESP32 induk) yang sudah terdaftar di sistem.
// Relasi: Satu Gateway → banyak Node (lihat nodeModel.js)
//
// Cara kerja pendaftaran:
//   1. Gateway menyala → kirim MQTT topik LancsSK/gateway/register
//   2. Server verifikasi user_token (JWT) → UPSERT dokumen ini
//   3. Gateway kini terikat ke ownerId dan siap terima data dari node
// =========================================================================
const gatewaySchema = new mongoose.Schema({

    // MAC Address hardware — identifier utama, unik per unit fisik
    mac: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },

    // Pemilik — diisi saat handleGatewayRegister berhasil verifikasi JWT
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },

    // Nama yang bisa diubah user lewat Flutter
    name: {
        type: String,
        default: null   // null berarti belum diberi nama, Flutter tampilkan mac saja
    },

    // Site tempat Gateway beroperasi (diisi saat user assign ke site)
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        default: null
    },

    // Status koneksi — diupdate setiap data masuk via MQTT
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: null },

    // Mode FSM hardware saat ini (referensi saja, kendali ada di firmware)
    // 2 = Operasional (ESP-NOW aktif, data mengalir)
    // 3 = Pairing    (BLE aktif, ESP-NOW mati)
    currentMode: {
        type: Number,
        enum: [2, 3],
        default: 2
    }

}, {
    timestamps: true
});

module.exports = mongoose.model('Gateway', gatewaySchema);