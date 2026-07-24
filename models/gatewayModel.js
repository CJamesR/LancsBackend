const mongoose = require('mongoose');

const gatewaySchema = new mongoose.Schema({
    mac: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },

    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },

    name: {
        type: String,
        default: null   
    },

    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        default: null
    },

    // Status koneksi — diupdate setiap data masuk via MQTT
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: null },

    currentMode: {
        type: Number,
        enum: [2, 3],
        default: 2
    }

}, {
    timestamps: true
});

module.exports = mongoose.model('Gateway', gatewaySchema);