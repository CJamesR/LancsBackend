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
    action: {
        type: String,
        required: true
    },
    details: {
        type: Object
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('ActivityLog', activityLogSchema);