const express = require('express');
const router = express.Router();
const Site = require('../models/siteModel');
const Device = require('../models/device');
const getSensorModel = require('../models/sensorModel');
const rateLimiter = require('express-rate-limit');

// 🔥 IMPORT BARU UNTUK FITUR FLUTTER
const ActivityLog = require('../models/activityLogModel');
const Invite      = require('../models/inviteModel');
const Gateway     = require('../models/gatewayModel');  // 🔥 NEW — Model Gateway
const Node        = require('../models/nodeModel');      // 🔥 NEW — Model Node
const mqttHandler = require('../mqtt/mqttHandler');      // 🔥 NEW — Trigger mode via MQTT
const siteController = require('../controllers/siteController');
const { protect, checkSiteRole } = require('../middleware/authMiddleware');

// =========================================================================
// HELPER — Ekstrak userId dari token JWT secara konsisten
// Catatan: protect sudah dijalankan di server.js sebelum sampai sini
// =========================================================================
const extractUserId = (req) => {
    const raw = req.user?._id ?? req.user?.userId ?? req.user?.id;
    if (!raw) throw new Error("User ID tidak ditemukan di token JWT. Periksa authMiddleware.");
    return raw.toString();
};

const apiLimiter = rateLimiter({
    windowMs: 1 * 60 * 1000,
    max: 20,
    message: {
        success: false, message: 'Terlalu banyak request. Coba lagi nanti'
    }
});

// // =========================================================================
// // 1. API GET DASHBOARD SITE
// // GET /api/flutter/sites/:siteId/dashboard
// // =========================================================================
// router.get('/sites/:siteId/dashboard', apiLimiter, async (req, res) => {
//     try {
//         const { siteId } = req.params;
//         const userId = extractUserId(req);

//         const site = await Site.findById(siteId).populate('ownerId', 'username');
//         if (!site) {
//             return res.status(404).json({ success: false, message: 'Site tidak ditemukan' });
//         }

//         // Cek Hak Akses
//         let allowedGateways = [];
//         const isOwner = site.ownerId._id.toString() === userId;
//         const adminRecord = site.admins.find(v => v.userId.toString() === userId);
//         // Tambahan untuk mendeteksi member
//         const memberRecord = site.members && site.members.find(m => m.userId.toString() === userId);

//         if (isOwner) {
//             allowedGateways = site.devices; 
//         } else if (adminRecord) {
//             allowedGateways = adminRecord.allowedDevices; 
//         } else if (memberRecord) {
//             // Member bisa melihat semua perangkat di dalam site
//             allowedGateways = site.devices; 
//         } else {
//             return res.status(403).json({ success: false, message: 'Akses ditolak ke Site ini' });
//         }

//         // Ambil data sensor terbaru
//         const devicesWithData = await Promise.all(
//             allowedGateways.map(async (deviceID) => {
//                 try {
//                     const deviceInfo = await Device.findOne({ serialID: deviceID });
//                     const deviceName = deviceInfo ? deviceInfo.name : `Sensor ${deviceID}`;

//                     const SensorModel = getSensorModel(deviceID);
//                     const latestData = await SensorModel.findOne().sort({ Waktu: -1 }).lean();

//                     // Perhitungan status Online
//                     let isOnline = false;
//                     if (latestData?.Waktu) {
//                         const diffMinutes = (new Date() - new Date(latestData.Waktu)) / (1000 * 60);
//                         isOnline = diffMinutes < 5;
//                     }

//                     return {
//                         id: deviceID,
//                         name: deviceName,
//                         temperature: latestData ? latestData.Suhu : null,
//                         humidity: latestData ? latestData.Kelembapan : null,
//                         lastUpdate: latestData ? latestData.Waktu : null,
//                         status: isOnline ? 'online' : 'offline'
//                     };
//                 } catch (err) {
//                     console.error(`❌ Error fetching data for device ${deviceID}:`, err.message);
//                     return { id: deviceID, name: `Error ${deviceID}`, status: 'error' };
//                 }
//             })
//         );

//         res.json({
//             success: true,
//             siteName: site.name,
//             ownerName: isOwner ? "Anda" : site.ownerId.username,
//             // Deteksi role apa yang sedang mengakses untuk dikirim ke frontend
//             role: isOwner ? 'owner' : (adminRecord ? 'admin' : 'member'),
//             data: devicesWithData
//         });

//     } catch (error) {
//         console.error("❌ Error Dashboard:", error);
//         res.status(500).json({ success: false, message: 'Server Error', error: error.message });
//     }
// });

// =========================================================================
// 2. API GET DEVICE DETAIL (GRAFIK)
// GET /api/flutter/device/:deviceId/detail
// =========================================================================
router.get('/device/:deviceId/detail', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const userId = extractUserId(req);

        const device = await Device.findOne({ serialID: deviceId });
        if (!device || !device.siteId) {
            return res.status(404).json({
                success: false,
                message: 'Alat tidak ditemukan atau belum dimasukkan ke Site'
            });
        }

        const site = await Site.findById(device.siteId);
        if (!site) {
            return res.status(404).json({ success: false, message: 'Site untuk alat ini tidak ditemukan.' });
        }

        // Variabel Hak Akses
        const isOwner = site.ownerId.toString() === userId;
        const isAdminAllowed = site.admins.some(
            a => a.userId.toString() === userId && a.allowedDevices.includes(deviceId)
        );
        // Tambahan untuk mengizinkan member melihat grafik
        const isMember = site.members && site.members.some(m => m.userId.toString() === userId);

        if (!isOwner && !isAdminAllowed && !isMember) {
            return res.status(403).json({ success: false, message: 'Akses ditolak ke data alat ini' });
        }

        const SensorModel = getSensorModel(deviceId);
        const latestData = await SensorModel.findOne().sort({ Waktu: -1 }).lean();

        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const historicalData = await SensorModel.find({
            Waktu: { $gte: twentyFourHoursAgo }
        })
        .sort({ Waktu: 1 })
        .select('Suhu Kelembapan Waktu')
        .lean();

        res.status(200).json({
            success: true,
            device: {
                id: deviceId,
                name: device.name,
            },
            current: latestData ? {
                temperature: latestData.Suhu,
                humidity: latestData.Kelembapan,
                lastUpdated: latestData.Waktu,
            } : null,
            history: historicalData.map(item => ({
                temperature: item.Suhu,
                humidity: item.Kelembapan,
                timestamp: item.Waktu
            }))
        });

    } catch (error) {
        console.error("❌ Error Device Detail:", error);
        res.status(500).json({ success: false, message: 'Error fetching device details', error: error.message });
    }
});

// =========================================================================
// 3. API INVITE MEMBER
// POST /api/flutter/sites/:siteId/invite
// =========================================================================
router.post('/sites/:siteId/invite', checkSiteRole(['owner', 'admin']), siteController.inviteUser);

// =========================================================================
// 4. API REMOVE MEMBER
// DELETE /api/flutter/sites/:siteId/members/:memberId
// =========================================================================
// Hapus member (owner & admin bisa akses)
router.delete('/sites/:siteId/members/:memberId', protect, siteController.removeMember);

// Hapus admin (owner saja)
router.delete(
    '/sites/:siteId/admins/:adminId',
    protect,
    checkSiteRole(['owner']),
    siteController.removeAdmin
);

// =========================================================================
// 5. API RENAME DEVICE
// PATCH /api/flutter/device/:id/rename
// =========================================================================
router.patch('/device/:id/rename', async (req, res) => {
    try {
        const { id } = req.params;
        const { newName } = req.body;
        const userId = extractUserId(req);

        const updatedDevice = await Device.findOneAndUpdate(
            { serialID: id }, 
            { name: newName }, 
            { new: true }
        );

        if (!updatedDevice) {
            return res.status(404).json({ success: false, message: "Perangkat tidak ditemukan" });
        }

        if (updatedDevice.siteId) {
            await ActivityLog.create({
                userId: userId,
                siteId: updatedDevice.siteId,
                action: `Renamed device to ${newName}`
            });
        }

        if (global.io) { 
            global.io.emit('device_renamed', { deviceId: updatedDevice.serialID, newName: updatedDevice.name }); 
        }

        res.status(200).json({ success: true, message: "Nama perangkat berhasil diubah", data: updatedDevice });
    } catch (error) {
        console.error("❌ Error Rename Device:", error);
        res.status(500).json({ success: false, error: "Gagal mengubah nama perangkat" });
    }
});

// =========================================================================
// 6. 🔥 NEW — GET PENDING INVITES UNTUK USER YANG LOGIN
// GET /api/flutter/invites/pending
// =========================================================================
router.get('/invites/pending', async (req, res) => {
    try {
        const userId = extractUserId(req);

        // Cari email user yang sedang login
        const User = require('../models/userModel');
        const currentUser = await User.findById(userId).select('email');
        if (!currentUser) {
            return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });
        }

        // Cari semua invite pending yang ditujukan ke email ini
        const invites = await Invite.find({
            recipientEmail: currentUser.email.toLowerCase(),
            status: 'pending'
        }).sort({ createdAt: -1 });

        const formattedInvites = invites.map(invite => ({
            _id: invite._id,
            siteId: invite.siteId,
            siteName: invite.siteName,
            inviterName: invite.inviterName,
            role: invite.role,
            createdAt: invite.createdAt
        }));

        res.json({
            success: true,
            count: formattedInvites.length,
            invites: formattedInvites
        });

    } catch (error) {
        console.error("❌ Error Get Pending Invites:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// 7. 🔥 NEW — RESPOND TO INVITE (ACCEPT / DECLINE)
// POST /api/flutter/invites/:inviteId/respond
// Body: { "action": "accept" | "decline" }
// =========================================================================
router.post('/invites/:inviteId/respond', async (req, res) => {
    try {
        const { inviteId } = req.params;
        const { action } = req.body;
        const userId = extractUserId(req);
        console.log("Menerima request Invite Respond:", req.params.inviteId, req.body);

        if (!action || !['accept', 'decline'].includes(action)) {
            return res.status(400).json({ success: false, message: 'action harus "accept" atau "decline".' });
        }

        // Temukan invite
        const invite = await Invite.findById(inviteId);
        if (!invite) {
            return res.status(404).json({ success: false, message: 'Undangan tidak ditemukan atau sudah direspons.' });
        }

        if (invite.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Undangan ini sudah berstatus "${invite.status}".` });
        }

        // Pastikan yang merespons adalah user yang diundang
        const User = require('../models/userModel');
        const currentUser = await User.findById(userId).select('email username');
        if (!currentUser || currentUser.email.toLowerCase() !== invite.recipientEmail) {
            return res.status(403).json({ success: false, message: 'Anda tidak berhak merespons undangan ini.' });
        }

        if (action === 'decline') {
            // Tolak — hapus record invite
            await Invite.findByIdAndDelete(inviteId);
            return res.json({ success: true, message: 'Undangan berhasil ditolak.' });
        }

        // ACCEPT — tambahkan user ke Site
        const site = await Site.findById(invite.siteId);
        if (!site) {
            await Invite.findByIdAndDelete(inviteId);
            return res.status(404).json({ success: false, message: 'Site tidak lagi tersedia. Undangan dihapus.' });
        }

        // Cek lagi apakah user sudah ada di site (double-check)
        const alreadyAdmin = site.admins.some(a => a.userId.toString() === userId.toString());
        const alreadyMember = site.members && site.members.some(m => m.userId.toString() === userId.toString());
        const isOwner = site.ownerId.toString() === userId.toString();

        if (!alreadyAdmin && !alreadyMember && !isOwner) {
            if (invite.role === 'admin') {
                site.admins.push({ userId: userId, allowedDevices: [], permissions: {} });
            } else {
                if (!site.members) site.members = [];
                site.members.push({ userId: userId, role: invite.role || 'member' });
            }
            await site.save();
        }

        // Catat aktivitas
        await ActivityLog.create({
            userId: userId,
            siteId: invite.siteId,
            action: `${currentUser.username} accepted invite and joined as ${invite.role}`
        });

        // Hapus invite setelah diterima
        await Invite.findByIdAndDelete(inviteId);

        res.json({
            success: true,
            message: `Berhasil bergabung ke Site "${site.name}" sebagai ${invite.role}.`,
            site: {
                id: site._id,
                name: site.name,
                role: invite.role
            }
        });

    } catch (error) {
        console.error("❌ Error Respond Invite:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// 8. 🔥 NEW — UPDATE FCM TOKEN DARI FLUTTER
// PATCH /api/flutter/user/fcm-token
// =========================================================================
router.patch('/user/fcm-token', async (req, res) => {
    try {
        const { fcmToken } = req.body;
        const userId = extractUserId(req);

        if (!fcmToken) {
            return res.status(400).json({ success: false, message: "Token FCM tidak boleh kosong" });
        }

        // Panggil model User dan update tokennya
        const User = require('../models/userModel');
        await User.findByIdAndUpdate(userId, { fcmToken: fcmToken });
        
        console.log(`✅ FCM Token berhasil diupdate untuk User ID: ${userId}`);
        res.json({ success: true, message: "Token FCM berhasil diperbarui" });
        
    } catch (error) {
        console.error("❌ Error Update FCM Token:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// 9. 🔥 NEW — DASHBOARD V2 (Struktur bercabang: Gateway → Nodes)
// GET /api/flutter/sites/:siteId/dashboard/v2
//
// Mengembalikan struktur hierarkis sesuai format:
// { gateways: [{ ...gatewayInfo, nodes: [...nodeInfo] }] }
//
// Endpoint v1 (/dashboard) TIDAK diubah — Flutter lama tetap berjalan.
// =========================================================================
router.get('/sites/:siteId/dashboard', apiLimiter, async (req, res) => {
    try {
        const { siteId } = req.params;
        const userId = extractUserId(req);

        const site = await Site.findById(siteId).populate('ownerId', 'username');
        if (!site) {
            return res.status(404).json({ success: false, message: 'Site tidak ditemukan.' });
        }

        // Validasi akses (sama dengan v1)
        const isOwner    = site.ownerId._id.toString() === userId;
        const adminRecord  = site.admins.find(a => a.userId.toString() === userId);
        const memberRecord = site.members && site.members.find(m => m.userId.toString() === userId);

        if (!isOwner && !adminRecord && !memberRecord) {
            return res.status(403).json({ success: false, message: 'Akses ditolak ke Site ini.' });
        }

        // Tentukan gateway MAC yang boleh dilihat user ini
        let allowedDeviceIds = [];
        if (isOwner || memberRecord) {
            allowedDeviceIds = site.devices; // semua perangkat
        } else if (adminRecord) {
            allowedDeviceIds = adminRecord.allowedDevices;
        }

        // Ambil semua Gateway milik site ini yang ada di allowedDeviceIds
        const gateways = await Gateway.find({
            mac: { $in: allowedDeviceIds.map(id => id.toUpperCase()) },
            siteId: siteId
        }).lean();

        // Untuk setiap Gateway, ambil semua Node anaknya
        const gatewaysWithNodes = await Promise.all(
            gateways.map(async (gw) => {
                const nodes = await Node.find({ gatewayId: gw._id }).lean();

                // Format node — data terakhir sudah di-cache di nodeModel
                const formattedNodes = nodes.map(node => ({
                    id: node._id,
                    serialId: node.serialId,
                    name: node.name || node.serialId,
                    status: node.isOnline ? 'online' : 'offline',
                    temperature: node.lastTemperature,
                    humidity: node.lastHumidity,
                    lastUpdate: node.lastSeen
                }));

                return {
                    id: gw._id,
                    serialId: gw.mac,
                    name: gw.name || gw.mac,
                    status: gw.isOnline ? 'online' : 'offline',
                    currentMode: gw.currentMode,
                    lastSeen: gw.lastSeen,
                    nodes: formattedNodes
                };
            })
        );

        res.json({
            success: true,
            siteName: site.name,
            role: isOwner ? 'owner' : (adminRecord ? 'admin' : 'member'),
            data: gatewaysWithNodes
        });

    } catch (error) {
        console.error('❌ Error Dashboard v2:', error);
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
});

// =========================================================================
// 10. 🔥 NEW — KIRIM PERINTAH KE GATEWAY
// POST /api/flutter/gateway/:mac/cmd
// Body: { "cmd": "pairing_active" }
//    atau { "cmd": "set_wifi", "ssid": "NamaWiFi", "password": "pass123" }
//
// Alur: Flutter → endpoint ini → mqttHandler.sendGatewayCommand() → MQTT → Gateway
//
// PENTING: Endpoint ini hanya bekerja jika Gateway sudah online (sudah punya
// WiFi dan terhubung ke MQTT). Untuk provisioning WiFi pertama kali,
// Flutter harus connect langsung ke AP Gateway (192.168.4.1) — tidak
// lewat server ini.
// =========================================================================
router.post('/gateway/:mac/cmd', async (req, res) => {
    try {
        const { mac }              = req.params;
        const { cmd, ssid, password } = req.body;
        const userId               = extractUserId(req);

        // Validasi cmd
        const allowedCmds = ['pairing_active', 'set_wifi'];
        if (!cmd || !allowedCmds.includes(cmd)) {
            return res.status(400).json({
                success: false,
                message: `Perintah tidak valid. Pilihan: ${allowedCmds.join(', ')}`
            });
        }

        // set_wifi wajib membawa ssid dan password
        if (cmd === 'set_wifi') {
            if (!ssid || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Perintah set_wifi membutuhkan field ssid dan password.'
                });
            }
        }

        // Validasi kepemilikan Gateway
        const gateway = await Gateway.findOne({ mac: mac.toUpperCase() });
        if (!gateway) {
            return res.status(404).json({ success: false, message: 'Gateway tidak ditemukan.' });
        }
        if (!gateway.ownerId || gateway.ownerId.toString() !== userId) {
            return res.status(403).json({ success: false, message: 'Anda bukan pemilik Gateway ini.' });
        }

        // Rakit payload tambahan sesuai cmd
        const extraPayload = {};
        if (cmd === 'set_wifi') {
            extraPayload.ssid     = ssid;
            extraPayload.password = password;
        }

        // Kirim ke Gateway via MQTT
        const sent = mqttHandler.sendGatewayCommand(mac.toUpperCase(), cmd, extraPayload);
        if (!sent) {
            return res.status(503).json({
                success: false,
                message: 'MQTT broker tidak terhubung. Perintah tidak dapat dikirim.'
            });
        }

        // Update currentMode di database jika perintah pairing_active
        if (cmd === 'pairing_active') {
            await Gateway.findOneAndUpdate(
                { mac: mac.toUpperCase() },
                { $set: { currentMode: 3 } }
            );
        }

        res.json({
            success: true,
            message: `Perintah '${cmd}' berhasil dikirim ke Gateway ${mac.toUpperCase()}.`,
            sent: { cmd, ...extraPayload }
        });

    } catch (error) {
        console.error('❌ Error Send Gateway Command:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// 11. 🔥 NEW — LIHAT SEMUA NODE MILIK SEBUAH GATEWAY
// GET /api/flutter/gateway/:mac/nodes
//
// Mengembalikan daftar Node (sensor anak) dengan data terakhir masing-masing.
// Data diambil dari cache di nodeModel — tidak query ke sensor_* time-series.
// =========================================================================
router.get('/gateway/:mac/nodes', async (req, res) => {
    try {
        const { mac } = req.params;
        const userId  = extractUserId(req);

        // Validasi kepemilikan Gateway
        const gateway = await Gateway.findOne({ mac: mac.toUpperCase() });
        if (!gateway) {
            return res.status(404).json({ success: false, message: 'Gateway tidak ditemukan.' });
        }
        if (!gateway.ownerId || gateway.ownerId.toString() !== userId) {
            return res.status(403).json({ success: false, message: 'Anda bukan pemilik Gateway ini.' });
        }

        // Ambil semua Node yang terikat ke Gateway ini
        const nodes = await Node.find({ gatewayId: gateway._id }).lean();

        const formattedNodes = nodes.map(node => ({
            id: node._id,
            serialId: node.serialId,
            name: node.name || node.serialId,
            status: node.isOnline ? 'online' : 'offline',
            temperature: node.lastTemperature,
            humidity: node.lastHumidity,
            lastUpdate: node.lastSeen,
            minTemp: node.minTemp,
            maxTemp: node.maxTemp
        }));

        res.json({
            success: true,
            gatewayMac: mac.toUpperCase(),
            gatewayName: gateway.name || gateway.mac,
            count: formattedNodes.length,
            nodes: formattedNodes
        });

    } catch (error) {
        console.error('❌ Error Get Gateway Nodes:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// 1. RENAME GATEWAY
// PATCH /api/flutter/gateway/:mac/rename
// =========================================================================
router.patch('/gateway/:mac/rename', protect, apiLimiter, async (req, res) => {
    try {
        const { mac } = req.params;
        const { newName } = req.body;
        const userId = extractUserId(req);

        if (!newName || newName.trim() === '') {
            return res.status(400).json({ success: false, message: 'Nama baru tidak boleh kosong.' });
        }

        const gateway = await Gateway.findOne({ mac: mac.toUpperCase() });
        if (!gateway) {
            return res.status(404).json({ success: false, message: 'Gateway tidak ditemukan.' });
        }

        // Otorisasi: Hanya pemilik Gateway yang boleh mengubah nama
        if (!gateway.ownerId || gateway.ownerId.toString() !== userId) {
            return res.status(403).json({ success: false, message: 'Akses Ditolak: Anda bukan pemilik Gateway ini.' });
        }

        gateway.name = newName.trim();
        await gateway.save();

        res.json({ 
            success: true, 
            message: 'Nama Gateway berhasil diperbarui.',
            data: { mac: gateway.mac, name: gateway.name }
        });

    } catch (error) {
        console.error('❌ Error Rename Gateway:', error.message);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
    }
});

// =========================================================================
// 2. RENAME NODE
// PATCH /api/flutter/node/:serialId/rename
// =========================================================================
router.patch('/node/:serialId/rename', protect, apiLimiter, async (req, res) => {
    try {
        const { serialId } = req.params;
        const { newName } = req.body;
        const userId = extractUserId(req);

        if (!newName || newName.trim() === '') {
            return res.status(400).json({ success: false, message: 'Nama baru tidak boleh kosong.' });
        }

        // populate('gatewayId') digunakan untuk mengambil data Induk secara bersamaan
        const node = await Node.findOne({ serialId: serialId.toUpperCase() }).populate('gatewayId');
        
        if (!node) {
            return res.status(404).json({ success: false, message: 'Node tidak ditemukan.' });
        }

        // Otorisasi: Cek apakah user adalah pemilik dari Gateway induk
        const gateway = node.gatewayId;
        if (!gateway || !gateway.ownerId || gateway.ownerId.toString() !== userId) {
            return res.status(403).json({ success: false, message: 'Akses Ditolak: Anda bukan pemilik jaringan Node ini.' });
        }

        node.name = newName.trim();
        await node.save();

        res.json({ 
            success: true, 
            message: 'Nama Node berhasil diperbarui.',
            data: { serialId: node.serialId, name: node.name }
        });

    } catch (error) {
        console.error('❌ Error Rename Node:', error.message);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server.' });
    }
});

// =========================================================================
// 3. DETAIL NODE (Riwayat 24 Jam)
// GET /api/flutter/node/:serialId/detail
// =========================================================================
router.get('/node/:serialId/detail', protect, async (req, res) => {
    try {
        const { serialId } = req.params;
        const userId = extractUserId(req);

        // 1. Cari Node dan muat data Gateway induknya
        const node = await Node.findOne({ serialId: serialId.toUpperCase() }).populate('gatewayId');
        if (!node) {
            return res.status(404).json({ success: false, message: 'Node tidak ditemukan.' });
        }

        const gateway = node.gatewayId;
        if (!gateway) {
            return res.status(400).json({ success: false, message: 'Inkonsistensi Data: Node belum terikat ke Gateway manapun.' });
        }

        // 2. Validasi Kepemilikan (Atau Hak Akses Site)
        if (gateway.ownerId.toString() !== userId) {
            return res.status(403).json({ success: false, message: 'Akses Ditolak: Anda tidak memiliki akses ke Node ini.' });
        }

        // 3. Ambil data historis 24 jam terakhir dari koleksi dinamis Mongoose
        // Ingat: Tabel dibentuk berdasarkan MAC Induk (Gateway), datanya difilter berdasarkan RealID (Node)
        const SensorModel = getSensorModel(gateway.mac);
        const timeAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const historyData = await SensorModel.find({
            ServerID: gateway.mac,       // Induk
            RealID: node.serialId,       // Anak spesifik
            Waktu: { $gte: timeAgo }
        })
        .sort({ Waktu: 1 }) // Urutkan dari yang paling lama ke terbaru untuk chart
        .select('Suhu Kelembapan Waktu gps_lat gps_lon -_id')
        .lean();

        // 4. Format keluaran sesuai yang dibutuhkan Flutter
        const history24h = historyData.map(doc => ({
            temperature: doc.Suhu,
            humidity: doc.Kelembapan,
            timestamp: doc.Waktu,
            latitude: doc.gps_lat,
            longitude: doc.gps_lon
        }));

        res.json({
            success: true,
            data: {
                nodeId: node._id,
                serialId: node.serialId,
                name: node.name || node.serialId,
                gatewayMac: gateway.mac,
                status: node.isOnline ? 'online' : 'offline',
                currentTemperature: node.lastTemperature,
                currentHumidity: node.lastHumidity,
                lastSeen: node.lastSeen,
                history24h: history24h
            }
        });

    } catch (error) {
        console.error('❌ Error Get Node Detail:', error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan internal server saat memuat riwayat data.' });
    }
});

// =========================================================================
// HOMEWORK 1: ESP32 REGISTRATION ENDPOINT (HTTP POST)
// Endpoint: POST /api/flutter/gateways/register
// =========================================================================
router.post('/gateways/register', async (req, res) => {
    try {
        const { serialId, user_token } = req.body;

        if (!serialId || !user_token) {
            return res.status(400).json({ success: false, message: 'serialId dan user_token wajib dikirim.' });
        }

        const jwt = require('jsonwebtoken');
        let decoded;
        try {
            decoded = jwt.verify(user_token, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ success: false, message: 'Token otentikasi tidak valid atau kedaluwarsa.' });
        }

        // Lakukan UPSERT: Daftarkan Gateway atau perbarui kepemilikannya
        const gateway = await Gateway.findOneAndUpdate(
            { mac: serialId.toUpperCase() },
            {
                $set: {
                    mac: serialId.toUpperCase(),
                    ownerId: decoded.userId,
                    isOnline: true,
                    lastSeen: new Date()
                }
            },
            { upsert: true, new: true }
        );

        res.status(200).json({ 
            success: true, 
            message: 'Gateway berhasil didaftarkan ke server Node.js', 
            data: gateway 
        });

    } catch (error) {
        console.error('❌ Error Gateway Registration via HTTP:', error.message);
        res.status(500).json({ success: false, message: 'Kesalahan internal server.' });
    }
});

// =========================================================================
// HOMEWORK 2: FETCH GATEWAYS ENDPOINT
// Endpoint: GET /api/flutter/gateways
// =========================================================================
router.get('/gateways', protect, async (req, res) => {
    try {
        const userId = extractUserId(req);

        const gateways = await Gateway.find({ ownerId: userId }).lean();
        const gatewayIds = gateways.map(gw => gw._id);
        const nodes = await Node.find({ gatewayId: { $in: gatewayIds } }).lean();

        // Rangkai data menjadi bentuk bersarang (nested JSON)
        const formattedData = gateways.map(gw => {
            const childNodes = nodes
                .filter(n => n.gatewayId.toString() === gw._id.toString())
                .map(n => ({
                    id: n._id.toString(),
                    name: n.name || n.serialId,
                    serialId: n.serialId,
                    temperature: n.lastTemperature,
                    humidity: n.lastHumidity,
                    status: n.isOnline ? 'online' : 'offline',
                    lastUpdate: n.lastSeen
                }));

            return {
                id: gw._id.toString(),
                name: gw.name || gw.mac,
                serialId: gw.mac,
                status: gw.isOnline ? 'online' : 'offline',
                nodes: childNodes
            };
        });

        res.json({
            success: true,
            data: formattedData
        });

    } catch (error) {
        console.error('❌ Error Fetch Gateways:', error.message);
        res.status(500).json({ success: false, message: 'Gagal memuat data Gateway.' });
    }
});

router.post('/gateway/:mac/command', protect, apiLimiter, async (req, res) => {
    try {
        // 1. Ekstraksi parameter dari URL dan Body
        const { mac } = req.params;
        const { cmd, ...extraPayload } = req.body; 
        const userId = extractUserId(req);

        // Validasi input
        if (!cmd) {
            return res.status(400).json({ success: false, message: 'Parameter "cmd" wajib disertakan di dalam body request.' });
        }

        // 2. Keamanan & Validasi Relasi di MongoDB
        const gateway = await Gateway.findOne({ mac: mac.toUpperCase() });
        
        if (!gateway) {
            return res.status(404).json({ success: false, message: 'Gateway tidak ditemukan di pangkalan data.' });
        }

        // Otorisasi Absolut: Hanya pemilik yang bisa mengirim perintah ke alat ini
        if (!gateway.ownerId || gateway.ownerId.toString() !== userId) {
            return res.status(403).json({ 
                success: false, 
                message: 'Akses Ditolak: Anda tidak memiliki otoritas atas Gateway ini.' 
            });
        }

        // 3. Eksekusi: Meneruskan perintah ke MQTT Handler yang sudah direvisi
        // Parameter extraPayload memungkinkan pengiriman data tambahan (seperti SSID/Password) jika diperlukan nantinya
        const isDispatched = mqttHandler.sendGatewayCommand(gateway.mac, cmd, extraPayload);

        // 4. Respons balikan ke klien Flutter
        if (isDispatched) {
            return res.status(200).json({ 
                success: true, 
                message: `Perintah '${cmd}' telah berhasil diinstruksikan ke Gateway.` 
            });
        } else {
            return res.status(503).json({ 
                success: false, 
                message: 'Gagal mengirim instruksi: Peladen saat ini terputus dari jaringan MQTT.' 
            });
        }

    } catch (error) {
        console.error(`❌ Error Gateway Command API [${req.params.mac}]:`, error.message);
        res.status(500).json({ success: false, message: 'Kesalahan internal server saat memproses perintah.' });
    }
});

module.exports = router;