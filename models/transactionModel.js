const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    req_id: { 
        type: String, 
        required: true, 
        unique: true 
    },
    gateway_mac:{
        type: String,
        required: true
    },
    node_mac:{
        type: String,
        required: true
    },
    type: { 
        type: String, 
        enum: ['gateway', 'node'], 
        required: true
    },
    status: { 
        type: String, 
        enum: ['pending', 'pending_delete', 'completed', 'deleted', 'failed'], 
        default: 'pending' 
    },
    createdAt: { 
        type: Date, 
        default: Date.now, 
        expires: 86400 
    } // Otomatis terhapus setelah 24 jam (TTL)
});

module.exports = mongoose.model('Transaction', transactionSchema);