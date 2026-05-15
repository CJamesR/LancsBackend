const express = require('express');
const router = express.Router();
const Device = require('../models/device'); 
const Site = require('../models/siteModel'); 
const ActivityLog = require('../models/activityLogModel'); // 🔥 TAMBAHAN
const { protect, checkSiteRole } = require('../middleware/authMiddleware');

// =========================================================================
// 1. API SIMULASI: LIHAT ALAT YANG NGANGGUR
// =========================================================================
router.get('/sim/available', protect, async (req, res) => {
    try {
        const availableDevices = await Device.find({ isClaimed: false }).select('serialID name');

        const dataFrontend = availableDevices.map(device => ({
            _id: device._id,
            serialID: device.serialID,
            name: (device.name && device.name.trim() !== "") ? device.name : device.serialID
        }));
        
        res.json({
            success: true,
            message: "Simulasi: Berikut adalah daftar alat yang terdeteksi di sekitar Anda.",
            data: dataFrontend
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// 2. API SIMULASI: KLAIM ALAT KE DALAM SITE
// =========================================================================
router.post('/sim/claim', protect, checkSiteRole(['owner', 'admin']), async (req, res) => {
    try {
        let { serialID, siteId, deviceName, newPassword } = req.body || {};

        if (serialID && serialID.includes('-')) {
            serialID = serialID.replace(/-/g, '_'); 
        }
        
        if (!serialID || !siteId) {
            return res.status(400).json({ success: false, message: "Gagal: Data serialID dan siteId wajib dikirim!" });
        }

        const site = await Site.findById(siteId);
        
        const device = await Device.findOne({ serialID: serialID });
        if (!device) {
            return res.status(404).json({ success: false, message: "Gagal: Alat tidak ditemukan di database." });
        }
        if (device.isClaimed) {
            return res.status(400).json({ success: false, message: "Alat ini sudah diklaim oleh Site lain." });
        }

        // Eksekusi Klaim
        device.isClaimed = true;
        device.siteId = siteId;
        device.name = deviceName || device.serialID; 
        device.devicePassword = newPassword; 
        await device.save();

        if (!site.devices.includes(serialID)) {
            site.devices.push(serialID);
        }
        
        site.admins.forEach(admin => {
            if (!admin.allowedDevices.includes(serialID)) {
                admin.allowedDevices.push(serialID);
            }
        });
        
        await site.save();

        // 🔥 CATAT AKTIVITAS
        const userId = req.user?.userId || req.user?._id;
        await ActivityLog.create({
            userId: userId,
            siteId: siteId,
            action: `Added node ${device.name}`
        });

        res.json({ success: true, message: `Berhasil! Alat ${device.name} telah ditambahkan ke Site ${site.name}.` });

    } catch (error) {
        console.error("❌ Error Claim NFC:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;