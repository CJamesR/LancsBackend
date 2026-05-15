const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    siteId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        required: true
    },
    deviceId: {
        type: String,
        required: true
    },
    type:{
        type: String,
        enum: ['ALERT_HIGH_TEMP', 'ALERT_LOW_TEMP', 'STATUS_ONLINE', 'STATUS_OFFLINE'],
        required: true
    },
    title: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    isReadBy: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }]},
    {timestamps: true});

module.exports = mongoose.model('Notification', notificationSchema);