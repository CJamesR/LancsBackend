const mongoose = require('mongoose');

const siteSchema = new mongoose.Schema({
    name: {type: String, required: true},
    location: {type: String},
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    admins: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        allowedDevices: [{
            type: String
        }],
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
    devices: [{type: String}]
}, {
    timestamps: true
});

module.exports = mongoose.model('Site', siteSchema);