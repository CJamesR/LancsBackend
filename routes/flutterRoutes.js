const express = require('express');
const router = express.Router();
const Site = require('../models/siteModel');
const Device = require('../models/device');
const getSensorModel = require('../models/sensorModel');
const rateLimiter = require('express-rate-limit');

// 🔥 IMPORT BARU UNTUK FITUR FLUTTER
const ActivityLog = require('../models/activityLogModel');
const Invite      = require('../models/inviteModel');
const Gateway     = require('../models/gatewayModel');
const Node        = require('../models/nodeModel');
const mqttHandler = require('../mqtt/mqttHandler');
const siteController = require('../controllers/siteController');
const { protect, checkSiteRole } = require('../middleware/authMiddleware');

// =========================================================================
// HELPER — Ekstrak userId dari token JWT secara konsisten
// =========================================================================
const extractUserId = (req) => {
    const raw = req.user?._id ?? req.user?.userId ?? req.user?.id;
    if (!raw) throw new Error("User ID not found at JWT Token. Check authMiddleware.");
    return raw.toString();
};

const apiLimiter = rateLimiter({
    windowMs: 1 * 60 * 1000,
    max: 20,
    message: {
        success: false, message: 'Too many requests. Please try again later'
    }
});

// =========================================================================
// 1. API GET DASHBOARD SITE
// GET /api/flutter/sites/:siteId/dashboard
//
// 🔧 PERBAIKAN: Tambah field 'mac' eksplisit di setiap device response
//    supaya Flutter bisa langsung pakai untuk endpoint pairing/command
//    tanpa harus tebak-tebak dari field 'id'
// =========================================================================
router.get('/sites/:siteId/dashboard', apiLimiter, async (req, res) => {
    try {
        const { siteId } = req.params;
        const userId = extractUserId(req);

        const site = await Site.findById(siteId).populate('ownerId', 'username');
        if (!site) {
            return res.status(404).json({ success: false, message: 'Site not Found' });
        }

        // Cek Hak Akses
        let allowedGateways = [];
        const isOwner = site.ownerId._id.toString() === userId;
        const adminRecord = site.admins.find(v => v.userId.toString() === userId);
        const memberRecord = site.members && site.members.find(m => m.userId.toString() === userId);

        if (isOwner) {
            allowedGateways = site.devices;
        } else if (adminRecord) {
            allowedGateways = site.devices;
        } else if (memberRecord) {
            allowedGateways = site.devices;
        } else {
            return res.status(403).json({ success: false, message: 'Access denied for this Site' });
        }

        // Ambil data sensor terbaru
        const devicesWithData = await Promise.all(
            allowedGateways.map(async (deviceID) => {
                try {
                    const deviceInfo = await Device.findOne({ serialID: deviceID });
                    const deviceName = deviceInfo ? deviceInfo.name : `Sensor ${deviceID}`;

                    const SensorModel = getSensorModel(deviceID);
                    const latestData = await SensorModel.findOne().sort({ Waktu: -1 }).lean();

                    // Perhitungan status Online
                    let isOnline = false;
                    if (latestData?.Waktu) {
                        const diffMinutes = (new Date() - new Date(latestData.Waktu)) / (1000 * 60);
                        isOnline = diffMinutes < 5;
                    }

                    return {
                        id: deviceID,
                        mac: deviceID,          // 🔧 TAMBAHAN: field eksplisit untuk Flutter
                        name: deviceName,
                        temperature: latestData ? latestData.Suhu : null,
                        humidity: latestData ? latestData.Kelembapan : null,
                        lastUpdate: latestData ? latestData.Waktu : null,
                        status: isOnline ? 'online' : 'offline'
                    };
                } catch (err) {
                    console.error(`❌ Error fetching data for device ${deviceID}:`, err.message);
                    return {
                        id: deviceID,
                        mac: deviceID,          // 🔧 TAMBAHAN: tetap sertakan walau error
                        name: `Error ${deviceID}`,
                        status: 'error'
                    };
                }
            })
        );

        res.json({
            success: true,
            siteName: site.name,
            ownerName: isOwner ? "Anda" : site.ownerId.username,
            role: isOwner ? 'owner' : (adminRecord ? 'admin' : 'member'),
            data: devicesWithData
        });

    } catch (error) {
        console.error("❌ Error Dashboard:", error);
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
});

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
            return res.status(404).json({ success: false, message: 'Site for this device not ditemukan.' });
        }

        // Variabel Hak Akses
        const isOwner = site.ownerId.toString() === userId;
        const isAdminAllowed = site.admins.some(
            a => a.userId.toString() === userId && a.allowedDevices.includes(deviceId)
        );
        const isMember = site.members && site.members.some(m => m.userId.toString() === userId);

        if (!isOwner && !isAdminAllowed && !isMember) {
            return res.status(403).json({ success: false, message: 'Access denied for this device data' });
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
                mac: deviceId,
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
// 4. API REMOVE MEMBER / ADMIN
// =========================================================================
router.delete('/sites/:siteId/members/:memberId', protect, siteController.removeMember);

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
            return res.status(404).json({ success: false, message: "Device not found" });
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

        res.status(200).json({ success: true, message: "Device name updated successfully", data: updatedDevice });
    } catch (error) {
        console.error("❌ Error Rename Device:", error);
        res.status(500).json({ success: false, error: "Failed to update device name" });
    }
});

// =========================================================================
// 6. GET PENDING INVITES UNTUK USER YANG LOGIN
// GET /api/flutter/invites/pending
// =========================================================================
router.get('/invites/pending', async (req, res) => {
    try {
        const userId = extractUserId(req);

        const User = require('../models/userModel');
        const currentUser = await User.findById(userId).select('email');
        if (!currentUser) {
            return res.status(404).json({ success: false, message: 'User not Found.' });
        }

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
// 7. RESPOND TO INVITE (ACCEPT / DECLINE)
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
            return res.status(400).json({ success: false, message: 'action must be "accept" or "decline".' });
        }

        const invite = await Invite.findById(inviteId);
        if (!invite) {
            return res.status(404).json({ success: false, message: 'Invite not found or already responded.' });
        }

        if (invite.status !== 'pending') {
            return res.status(400).json({ success: false, message: `This invite is already ${invite.status}.` });
        }

        const User = require('../models/userModel');
        const currentUser = await User.findById(userId).select('email username');
        if (!currentUser || currentUser.email.toLowerCase() !== invite.recipientEmail) {
            return res.status(403).json({ success: false, message: 'You are not authorized to respond to this invite.' });
        }

        if (action === 'decline') {
            await Invite.findByIdAndDelete(inviteId);
            return res.json({ success: true, message: 'Invite rejected successfully.' });
        }

        // ACCEPT — tambahkan user ke Site
        const site = await Site.findById(invite.siteId);
        if (!site) {
            await Invite.findByIdAndDelete(inviteId);
            return res.status(404).json({ success: false, message: 'Site not found. Invite deleted.' });
        }

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

        await ActivityLog.create({
            userId: userId,
            siteId: invite.siteId,
            action: `${currentUser.username} accepted invite and joined as ${invite.role}`
        });

        await Invite.findByIdAndDelete(inviteId);

        res.json({
            success: true,
            message: `Successfully joined Site "${site.name}" as ${invite.role}.`,
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
// 8. UPDATE FCM TOKEN DARI FLUTTER
// PATCH /api/flutter/user/fcm-token
// =========================================================================
router.patch('/user/fcm-token', async (req, res) => {
    try {
        const { fcmToken } = req.body;
        const userId = extractUserId(req);

        if (!fcmToken) {
            return res.status(400).json({ success: false, message: "FCM Token must not empty" });
        }

        const User = require('../models/userModel');
        await User.findByIdAndUpdate(userId, { fcmToken: fcmToken });

        console.log(`✅ FCM Token berhasil diupdate untuk User ID: ${userId}`);
        res.json({ success: true, message: "FCM Token updated successfully" });

    } catch (error) {
        console.error("❌ Error Update FCM Token:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// 9. AKTIFKAN PAIRING MODE GATEWAY
// POST /api/flutter/sites/:siteId/gateways/:mac/pairing
//
// Dipakai oleh Flutter untuk memulai mode pairing node baru ke gateway.
// Alur: Flutter → endpoint ini → MQTT LancsSK/gateway/cmd/<mac> → Hardware
//
// Akses: Owner dan Admin site boleh mengaktifkan pairing
// =========================================================================
router.post(
    '/sites/:siteId/gateways/:mac/pairing',
    protect,
    checkSiteRole(['owner', 'admin']),
    async (req, res) => {
        try {
            const { siteId, mac } = req.params;
            const userId = extractUserId(req);

            // Validasi gateway terdaftar di site ini
            const gateway = await Gateway.findOne({
                mac: mac.toUpperCase(),
                siteId: siteId
            });

            if (!gateway) {
                return res.status(404).json({
                    success: false,
                    message: `Gateway dengan MAC ${mac} tidak ditemukan di Site ini.`
                });
            }

            // Kirim perintah pairing_active via MQTT
            const sent = mqttHandler.sendGatewayCommand(mac.toUpperCase(), 'pairing_active');

            if (!sent) {
                return res.status(503).json({
                    success: false,
                    message: 'MQTT broker tidak terhubung. Perintah pairing tidak dapat dikirim.'
                });
            }

            // Update currentMode di DB menjadi 3 (Pairing Mode)
            await Gateway.findOneAndUpdate(
                { mac: mac.toUpperCase() },
                { $set: { currentMode: 3 } }
            );

            // Catat aktivitas
            await ActivityLog.create({
                userId: userId,
                siteId: siteId,
                action: `Activated pairing mode on gateway ${mac.toUpperCase()}`
            });

            console.log(`✅ [PAIRING] Perintah pairing_active dikirim ke Gateway ${mac.toUpperCase()}`);

            res.json({
                success: true,
                message: `Pairing mode berhasil diaktifkan pada Gateway ${mac.toUpperCase()}.`,
                gateway: {
                    mac: mac.toUpperCase(),
                    name: gateway.name || mac.toUpperCase(),
                    currentMode: 3
                }
            });

        } catch (error) {
            console.error('❌ Error Activate Pairing:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

// =========================================================================
// 10. GANTI KREDENSIAL WIFI GATEWAY
// POST /api/flutter/gateway/:mac/set-wifi
//
// Dipakai oleh Flutter untuk mengganti SSID/password WiFi gateway
// jika terjadi perpindahan jaringan.
// Alur: Flutter → endpoint ini → MQTT LancsSK/gateway/cmd/<mac> → Hardware
//
// Akses: Hanya Owner gateway (bukan sekadar admin site)
// Catatan: Endpoint ini hanya bekerja jika gateway SUDAH online via WiFi.
//          Untuk provisioning WiFi pertama kali, Flutter harus connect
//          langsung ke AP Gateway (192.168.4.1).
// =========================================================================
router.post('/gateway/:mac/set-wifi', protect, async (req, res) => {
    try {
        const { mac } = req.params;
        const { ssid, password } = req.body;
        const userId = extractUserId(req);

        if (!ssid || !password) {
            return res.status(400).json({
                success: false,
                message: 'ssid dan password wajib diisi.'
            });
        }

        // Validasi kepemilikan — hanya owner gateway yang boleh ganti WiFi
        const gateway = await Gateway.findOne({ mac: mac.toUpperCase() });
        if (!gateway) {
            return res.status(404).json({ success: false, message: 'Gateway tidak ditemukan.' });
        }
        if (!gateway.ownerId || gateway.ownerId.toString() !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Hanya pemilik Gateway yang dapat mengganti kredensial WiFi.'
            });
        }

        // Kirim perintah set_wifi via MQTT
        const sent = mqttHandler.sendGatewayCommand(
            mac.toUpperCase(),
            'set_wifi',
            { ssid, password }
        );

        if (!sent) {
            return res.status(503).json({
                success: false,
                message: 'MQTT broker tidak terhubung. Perintah tidak dapat dikirim.'
            });
        }

        console.log(`✅ [SET_WIFI] Perintah set_wifi dikirim ke Gateway ${mac.toUpperCase()}`);

        res.json({
            success: true,
            message: `Perintah ganti WiFi berhasil dikirim ke Gateway ${mac.toUpperCase()}.`,
            sent: { ssid }   // Jangan kembalikan password ke client
        });

    } catch (error) {
        console.error('❌ Error Set WiFi:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// 11. RENAME GATEWAY
// PATCH /api/flutter/gateway/:mac/rename
// =========================================================================
router.patch('/gateway/:mac/rename', protect, apiLimiter, async (req, res) => {
    try {
        const { mac } = req.params;
        const { newName } = req.body;
        const userId = extractUserId(req);

        if (!newName || newName.trim() === '') {
            return res.status(400).json({ success: false, message: 'New name must not be empty.' });
        }

        const gateway = await Gateway.findOne({ mac: mac.toUpperCase() });
        if (!gateway) {
            return res.status(404).json({ success: false, message: 'Gateway not found.' });
        }

        if (!gateway.ownerId || gateway.ownerId.toString() !== userId) {
            return res.status(403).json({ success: false, message: 'You are not the owner of this Gateway.' });
        }

        gateway.name = newName.trim();
        await gateway.save();

        res.json({
            success: true,
            message: 'Gateway name updated successfully.',
            data: { mac: gateway.mac, name: gateway.name }
        });

    } catch (error) {
        console.error('❌ Error Rename Gateway:', error.message);
        res.status(500).json({ success: false, message: 'An error occurred on the server.' });
    }
});

// =========================================================================
// 12. RENAME NODE
// PATCH /api/flutter/node/:serialId/rename
// =========================================================================
router.patch('/node/:serialId/rename', protect, apiLimiter, async (req, res) => {
    try {
        const { serialId } = req.params;
        const { newName } = req.body;
        const userId = extractUserId(req);

        if (!newName || newName.trim() === '') {
            return res.status(400).json({ success: false, message: 'New name must not be empty.' });
        }

        const node = await Node.findOne({ serialId: serialId.toUpperCase() }).populate('gatewayId');

        if (!node) {
            return res.status(404).json({ success: false, message: 'Node not found.' });
        }

        const gateway = node.gatewayId;
        if (!gateway || !gateway.ownerId || gateway.ownerId.toString() !== userId) {
            return res.status(403).json({ success: false, message: 'You are not the owner of this Gateway.' });
        }

        node.name = newName.trim();
        await node.save();

        res.json({
            success: true,
            message: 'Node name updated successfully.',
            data: { serialId: node.serialId, name: node.name }
        });

    } catch (error) {
        console.error('❌ Error Rename Node:', error.message);
        res.status(500).json({ success: false, message: 'An error occurred on the server.' });
    }
});

// =========================================================================
// 13. DETAIL NODE (Riwayat 24 Jam)
// GET /api/flutter/node/:serialId/detail
// =========================================================================
router.get('/node/:serialId/detail', protect, async (req, res) => {
    try {
        const { serialId } = req.params;
        const userId = extractUserId(req);

        const node = await Node.findOne({ serialId: serialId.toUpperCase() }).populate('gatewayId');
        if (!node) {
            return res.status(404).json({ success: false, message: 'Node not found.' });
        }

        const gateway = node.gatewayId;
        if (!gateway) {
            return res.status(400).json({ success: false, message: 'Data Inconsistency: Node is not associated with any Gateway.' });
        }

        if (gateway.ownerId.toString() !== userId) {
            return res.status(403).json({ success: false, message: 'Access Denied: You do not have access to this Node.' });
        }

        const SensorModel = getSensorModel(gateway.mac);
        const timeAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const historyData = await SensorModel.find({
            gateID: gateway.mac,
            nodeID: node.serialId,
            Waktu: { $gte: timeAgo }
        })
        .sort({ Waktu: 1 })
        .select('Suhu Kelembapan Waktu gps_lat gps_lon -_id')
        .lean();

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
// 14. ESP32 REGISTRATION ENDPOINT (HTTP POST)
// POST /api/flutter/gateways/register
// =========================================================================
router.post('/gateways/register', async (req, res) => {
    try {
        const { serialId, user_token } = req.body;

        if (!serialId || !user_token) {
            return res.status(400).json({ success: false, message: 'serialId and user_token are required.' });
        }

        const jwt = require('jsonwebtoken');
        let decoded;
        try {
            decoded = jwt.verify(user_token, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ success: false, message: 'Invalid or expired authentication token.' });
        }

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
            message: 'Gateway registered successfully with the Node.js server',
            data: gateway
        });

    } catch (error) {
        console.error('❌ Error Gateway Registration via HTTP:', error.message);
        res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

// =========================================================================
// 15. FETCH GATEWAYS
// GET /api/flutter/gateways
// =========================================================================
router.get('/gateways', protect, async (req, res) => {
    try {
        const userId = extractUserId(req);

        const gateways = await Gateway.find({ ownerId: userId }).lean();
        const gatewayIds = gateways.map(gw => gw._id);
        const nodes = await Node.find({ gatewayId: { $in: gatewayIds } }).lean();

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
                mac: gw.mac,                // 🔧 TAMBAHAN: field eksplisit
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

// =========================================================================
// 16. LIHAT SEMUA NODE MILIK SEBUAH GATEWAY
// GET /api/flutter/gateway/:mac/nodes
// =========================================================================
router.get('/gateway/:mac/nodes', async (req, res) => {
    try {
        const { mac } = req.params;
        const userId = extractUserId(req);

        const gateway = await Gateway.findOne({ mac: mac.toUpperCase() });
        if (!gateway) return res.status(404).json({ success: false, message: 'Gateway not found.' });
        if (!gateway.ownerId || gateway.ownerId.toString() !== userId) return res.status(403).json({ success: false, message: 'You are not the owner of this Gateway.' });

        const nodes = await Node.find({ gatewayId: gateway._id }).lean();
        const now = new Date();

        const formattedNodes = nodes.map(node => {
            const isNodeOnline = node.lastSeen && (now - new Date(node.lastSeen)) <= 600000;

            return {
                id: node._id,
                serialId: node.serialId,
                name: node.name || node.serialId,
                status: isNodeOnline ? 'online' : 'offline',
                temperature: node.lastTemperature,
                humidity: node.lastHumidity,
                lastUpdate: node.lastSeen,
                minTemp: node.minTemp,
                maxTemp: node.maxTemp
            };
        });

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
// 17. KONTROL GATEWAY GENERIK (INTERNAL/LEGACY — Jangan hapus dulu)
// POST /api/flutter/sites/:siteId/gateways/:mac/command
//
// ⚠️  Endpoint ini dipertahankan untuk kompatibilitas.
//     Untuk pairing gunakan endpoint #9 di atas.
//     Untuk set_wifi gunakan endpoint #10 di atas.
// =========================================================================
router.post('/sites/:siteId/gateways/:mac/command', protect, checkSiteRole(['owner', 'admin']), async (req, res) => {
    try {
        const { siteId, mac } = req.params;
        const { command } = req.body;

        const allowedCommands = ['pairing_active', 'set_wifi'];

        if (!command) {
            return res.status(400).json({ success: false, message: "Command is required." });
        }

        if (!allowedCommands.includes(command)) {
            return res.status(400).json({
                success: false,
                message: `Command tidak valid. Pilihan: ${allowedCommands.join(', ')}`
            });
        }

        const gateway = await Gateway.findOne({ mac: mac.toUpperCase(), siteId: siteId });
        if (!gateway) {
            return res.status(404).json({ success: false, message: "Gateway not found in this Site." });
        }

        mqttHandler.sendGatewayCommand(mac.toUpperCase(), command);

        const userId = extractUserId(req);
        await ActivityLog.create({
            userId: userId,
            siteId: siteId,
            action: `Sent command '${command}' to gateway ${mac}`
        });

        res.status(200).json({
            success: true,
            message: `Command '${command}' sent successfully to Gateway.`
        });

    } catch (error) {
        console.error("❌ Error Control Gateway:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// 18. LEAVE SITE (Member/Admin keluar sendiri)
// DELETE /api/flutter/sites/:siteId/leave
// =========================================================================
router.delete('/sites/:siteId/leave', protect, async (req, res) => {
    try {
        const userId = extractUserId(req);
        const siteId = req.params.siteId;

        const site = await Site.findById(siteId);
        if (!site) return res.status(404).json({ success: false, message: 'Site not found' });

        if (site.ownerId.toString() === userId) {
            return res.status(400).json({ success: false, message: 'Owner cannot leave the site. Please delete the site or transfer ownership.' });
        }

        site.admins = site.admins.filter(a => a.userId.toString() !== userId);
        site.members = (site.members || []).filter(m => m.userId.toString() !== userId);
        await site.save();

        await ActivityLog.create({
            userId: userId,
            siteId: siteId,
            action: `Left the site`
        });

        res.json({ success: true, message: 'Successfully left the site.' });
    } catch (error) {
        console.error("❌ Error Leave Site:", error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;