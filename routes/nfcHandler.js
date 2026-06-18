const express = require('express');
const router = express.Router();
const Device = require('../models/device'); 
const Gateway = require('../models/gatewayModel');
const Site = require('../models/siteModel'); 
const ActivityLog = require('../models/activityLogModel'); 
const { protect, checkSiteRole } = require('../middleware/authMiddleware');
const getSensorModel = require('../models/sensorModel');
const mqttHandler = require('../mqtt/mqttHandler');

// =========================================================================
// 1. API SIMULASI: LIHAT ALAT YANG NGANGGUR
// =========================================================================
router.get('/sim/available', protect, async (req, res) => {
    try {
        const availableDevices = await Device.find({ isClaimed: false, isOnline: true }).select('serialID name');

        const dataFrontend = availableDevices.map(device => ({
            _id: device._id,
            serialID: device.serialID,
            name: device.serialID
        }));

        if (dataFrontend.length === 0){
            return res.json({
                success: true,
                message: 'No Device is currently active and available for claiming.',
                data: []
            });
        }
        
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
// 2. KLAIM ALAT DARI NFC (DUKUNGAN DEVICE LAMA & GATEWAY BARU)
// =========================================================================
router.post('/claim', protect, checkSiteRole(['owner', 'admin']), async (req, res) => {
    try {
        const { serialID, siteId, deviceName, newPassword } = req.body;

        if (!serialID || !siteId) {
            return res.status(400).json({ success: false, message: "Serial ID dan Site ID wajib diisi." });
        }

        const site = await Site.findById(siteId);
        if (!site) return res.status(404).json({ success: false, message: "Site tidak ditemukan." });

        const userId = req.user?.userId || req.user?._id;
        let isLegacyDevice = false;

        // A. Coba cari di model Device lama terlebih dahulu
        let device = await Device.findOne({ serialID: serialID });
        
        if (device) {
            if (device.isClaimed) {
                return res.status(400).json({ success: false, message: "Alat ini sudah diklaim oleh Site lain." });
            }
            device.isClaimed = true;
            device.siteId = siteId;
            device.name = deviceName || device.serialID; 
            device.devicePassword = newPassword; 
            await device.save();
            isLegacyDevice = true;
        } else {
            // B. Jika tidak ada di Device lama, daftarkan sebagai Gateway Baru
            let gateway = await Gateway.findOne({ mac: serialID });
            
            if (gateway && gateway.siteId) {
                return res.status(400).json({ success: false, message: "Gateway ini sudah diklaim oleh Site lain." });
            }

            if (!gateway) {
                // Buat dokumen Gateway baru langsung saat diklaim
                gateway = new Gateway({
                    mac: serialID.toUpperCase(),
                    ownerId: userId,
                    siteId: siteId,
                    name: deviceName || serialID,
                    isOnline: false
                });
            } else {
                gateway.ownerId = userId;
                gateway.siteId = siteId;
                gateway.name = deviceName || gateway.name;
            }
            await gateway.save();
        }

        // Sinkronisasi data ke dalam Site
        if (!site.devices.includes(serialID)) {
            site.devices.push(serialID);
        }
        
        site.admins.forEach(admin => {
            if (!admin.allowedDevices.includes(serialID)) {
                admin.allowedDevices.push(serialID);
            }
        });
        
        await site.save();

        // Catat aktivitas klaim di sistem
        await ActivityLog.create({
            userId: userId,
            siteId: siteId,
            action: `Added ${isLegacyDevice ? 'device' : 'gateway'} ${deviceName || serialID}`
        });

        res.json({ success: true, message: `Berhasil! Alat ${deviceName || serialID} telah ditambahkan ke Site ${site.name}.` });

    } catch (error) {
        console.error("❌ Error Klaim NFC:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// 3. HAPUS ALAT (REMOVE DEVICE)
// =========================================================================
router.delete('/:siteId/devices/:serialID', protect, checkSiteRole(['owner', 'admin']), async (req, res) => {
    try {
        const { siteId, serialID } = req.params;

        const site = await Site.findById(siteId);
        if (!site) return res.status(404).json({ success: false, message: "Site tidak ditemukan." });

        if (!site.devices.includes(serialID)) {
            return res.status(404).json({ success: false, message: "Alat tidak terdaftar di Site ini." });
        }

        // Hapus dari Site
        site.devices = site.devices.filter(id => id !== serialID);
        site.admins.forEach(admin => {
            admin.allowedDevices = admin.allowedDevices.filter(id => id !== serialID);
        });
        await site.save();

        // Kembalikan status di database
        let device = await Device.findOne({ serialID: serialID });
        if (device) {
            device.isClaimed = false;
            device.siteId = null;
            await device.save();
        } else {
            // Hapus asosiasi dari Gateway jika itu adalah Gateway baru
            let gateway = await Gateway.findOne({ mac: serialID });
            if (gateway) {
                gateway.siteId = null;
                gateway.ownerId = null; // Lepaskan kepemilikan
                await gateway.save();
            }
        }

        const userId = req.user?.userId || req.user?._id;
        await ActivityLog.create({
            userId: userId,
            siteId: siteId,
            action: `Removed device ${serialID}`
        });

        res.json({ success: true, message: "Alat berhasil dilepaskan dari Site." });

    } catch (error) {
        console.error("❌ Error Remove Device:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Konsep awal Delete
// router.delete('/:siteId/gateways/:mac', protect, checkSiteRole(['owner', 'admin']), async (req, res) => {
//     try {
//         const { siteId, mac } = req.params;
//         const userId = req.user?.userId || req.user?._id;

//         // Cari wujud fisik Gateway di basis data
//         let gateway = await Gateway.findOne({ mac: mac.toUpperCase(), siteId: siteId });
        
//         if (!gateway) {
//             return res.status(404).json({ success: false, message: "Gateway tidak ditemukan atau sudah tidak berada di Site ini." });
//         }

//         // =======================================================
//         // LANGKAH 2a: CASCADING NODE (Sapu Bersih Sensor Anak)
//         // =======================================================
//         const deletedNodes = await Node.deleteMany({ gatewayId: gateway._id });
//         console.log(`🗑️ [CASCADING] Menghapus ${deletedNodes.deletedCount} node yang menginduk ke Gateway ${mac}`);

//         // =======================================================
//         // LANGKAH 2b: UNLINK DARI SITE (Bersihkan Array Dashboard)
//         // =======================================================
//         const site = await Site.findById(siteId);
//         if (site) {
//             site.devices = site.devices.filter(id => id !== mac.toUpperCase());
//             if (site.admins && site.admins.length > 0) {
//                 site.admins.forEach(admin => {
//                     admin.allowedDevices = admin.allowedDevices.filter(id => id !== mac.toUpperCase());
//                 });
//             }
//             // Ini adalah site.save() untuk menyimpan perubahan pemutusan relasi alat
//             await site.save(); 
//         }

//         // =======================================================
//         // LANGKAH 3: MANAJEMEN DATA TIME-SERIES (Opsional Wiping)
//         // =======================================================
//         const { clearData } = req.query;
//         if (clearData === 'true') {
//             try {
//                 const SensorModel = getSensorModel(mac.toUpperCase());
//                 await mongoose.connection.db.dropCollection(SensorModel.collection.name);
//                 console.log(`🧹 [LANGKAH 3] Koleksi historis ${SensorModel.collection.name} dimusnahkan.`);
//             } catch (err) {
//                 console.log(`⚠️ [LANGKAH 3] Koleksi historis tidak ditemukan untuk dihapus.`);
//             }
//         } else {
//             console.log(`💾 [LANGKAH 3] Data historis dipertahankan (Soft Delete / Orphan).`);
//         }

//         try {
//             // Mengirim perintah dengan format {"cmd": "factory_reset"} ke topik spesifik Gateway
//             mqttHandler.sendGatewayCommand(mac.toUpperCase(), "factory_reset");
//             console.log(`🔌 [LANGKAH 4] Perintah factory_reset dikirim via MQTT ke Gateway ${mac}`);
//         } catch (err) {
//             console.error(`⚠️ [LANGKAH 4] Gagal mengirim perintah cabut akses ke perangkat keras:`, err.message);
//         }

//         // =======================================================
//         // PERSIAPAN: ORPHAN GATEWAY (Kembalikan ke status yatim)
//         // =======================================================
//         gateway.siteId = null;
//         gateway.ownerId = null;
//         gateway.name = null;
//         gateway.isOnline = false;
//         await gateway.save();

//         // Catat log aktivitas
//         await ActivityLog.create({
//             userId: userId,
//             siteId: siteId,
//             action: `Removed gateway ${mac} and unlinked ${deletedNodes.deletedCount} nodes`
//         });

//         res.status(200).json({ 
//             success: true, 
//             message: `Gateway ${mac} dan node di bawahnya berhasil dihapus.`,
//         });

//     } catch (error) {
//         console.error("❌ Error Remove Gateway:", error);
//         res.status(500).json({ success: false, error: error.message });
//     }
// });
module.exports = router;