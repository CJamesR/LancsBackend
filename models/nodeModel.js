const mongoose = require('mongoose');

const nodeSchema = new mongoose.Schema({
    nodeID: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    gateID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Gateway',
        default: null,
        index: true
    },
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        default: null
    },
    name: {
        type: String,
        default: null   
    },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: null },

    lastTemperature: { type: Number, default: null },
    lastHumidity: { type: Number, default: null },

    minTemp: { type: Number, default: 15 },
    maxTemp: { type: Number, default: 35 }

}, {
    timestamps: true
});

module.exports = mongoose.model('Node', nodeSchema);