const express = require('express');
const router = express.Router();
const Site = require('../models/siteModel');
const Device = require('../models/device');
const getSensorModel = require('../models/sensorModel');
const rateLimiter = require('express-rate-limit');

// 🔥 IMPORT BARU UNTUK FITUR FLUTTER
const ActivityLog = require('../models/activityLogModel');
const Invite = require('../models/inviteModel'); // 🔥 NEW
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

// =========================================================================
// 1. API GET DASHBOARD SITE
// GET /api/flutter/sites/:siteId/dashboard
// =========================================================================
router.get('/sites/:siteId/dashboard', apiLimiter, async (req, res) => {
    try {
        const { siteId } = req.params;
        const userId = extractUserId(req);

        const site = await Site.findById(siteId).populate('ownerId', 'username');
        if (!site) {
            return res.status(404).json({ success: false, message: 'Site tidak ditemukan' });
        }

        // Cek Hak Akses
        let allowedGateways = [];
        const isOwner = site.ownerId._id.toString() === userId;
        const adminRecord = site.admins.find(v => v.userId.toString() === userId);

        if (isOwner) {
            allowedGateways = site.devices; 
        } else if (adminRecord) {
            allowedGateways = adminRecord.allowedDevices; 
        } else {
            return res.status(403).json({ success: false, message: 'Akses ditolak ke Site ini' });
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
                        name: deviceName,
                        temperature: latestData ? latestData.Suhu : null,
                        humidity: latestData ? latestData.Kelembapan : null,
                        lastUpdate: latestData ? latestData.Waktu : null,
                        status: isOnline ? 'online' : 'offline'
                    };
                } catch (err) {
                    console.error(`❌ Error fetching data for device ${deviceID}:`, err.message);
                    return { id: deviceID, name: `Error ${deviceID}`, status: 'error' };
                }
            })
        );

        res.json({
            success: true,
            siteName: site.name,
            ownerName: isOwner ? "Anda" : site.ownerId.username,
            role: isOwner ? 'owner' : 'admin',
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
            return res.status(404).json({ success: false, message: 'Site untuk alat ini tidak ditemukan.' });
        }

        const isOwner = site.ownerId.toString() === userId;
        const isAdminAllowed = site.admins.some(
            a => a.userId.toString() === userId && a.allowedDevices.includes(deviceId)
        );

        if (!isOwner && !isAdminAllowed) {
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
router.delete(
    '/sites/:siteId/members/:memberId',
    protect,                              // ← fix: sebelumnya tidak ada
    checkSiteRole(['owner', 'admin']),
    siteController.removeMember
);

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

module.exports = router;