const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
    serialID: {type: String, required: true,unique: true},
    name: {type: String, default: "New Gateway"},
    isClaimed: {type: Boolean, default: false},
    siteId: {type: mongoose.Schema.Types.ObjectId, ref: 'Site', default: null},
    
    devicePassword: {type: String, default: null}, 
    minTemp: {type: Number, default: 15},
    maxTemp: {type: Number, default: 35},
    lastActive: {type: Date, default: null},
    isOnline: {type: Boolean, default: false}},
{
    timestamps: true 
});

module.exports = mongoose.model('Device', deviceSchema);