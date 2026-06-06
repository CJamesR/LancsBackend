const mongoose = require('mongoose');

// =========================================================================
// NODE MODEL
// Mewakili satu sensor anak (ESP8266/ESP32 kecil) yang terhubung ke Gateway
// via ESP-NOW. RealID = MAC Address hardware node itu sendiri.
//
// Relasi hierarki:
//   Site → Gateway (gatewayId) → Node (model ini)
//
// Catatan kompatibilitas:
//   Model Device lama tetap ada untuk node yang sudah terdaftar sebelum
//   arsitektur Gateway. Node baru (yang datanya lewat Gateway) masuk ke
//   model ini. Migrasi penuh dilakukan nanti setelah semua hardware aktif.
// =========================================================================
const nodeSchema = new mongoose.Schema({

    // MAC Address node — identifier hardware, unik per unit fisik
    // Ini yang disebut RealID di payload MQTT
    serialId: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },

    // Gateway induk — diisi saat data pertama kali masuk dari gateway tersebut
    gatewayId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Gateway',
        default: null,
        index: true
    },

    // Shortcut ke site (redundan dengan gateway.siteId, tapi mempercepat query)
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        default: null
    },

    // Nama yang bisa diubah user lewat Flutter
    name: {
        type: String,
        default: null   // null = belum diberi nama, tampilkan serialId saja
    },

    // Status & data terakhir — di-cache di sini agar dashboard tidak perlu
    // query ke koleksi sensor_* setiap kali render
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: null },

    // Cache data sensor terakhir (diupdate setiap data MQTT masuk)
    lastTemperature: { type: Number, default: null },
    lastHumidity: { type: Number, default: null },

    // Batas alarm suhu
    minTemp: { type: Number, default: 15 },
    maxTemp: { type: Number, default: 35 }

}, {
    timestamps: true
});

module.exports = mongoose.model('Node', nodeSchema);