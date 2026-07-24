const express = require('express');
const router = express.Router();
const Notification = require('../models/notificationModel');
const Site = require('../models/siteModel');
const { protect } = require('../middleware/authMiddleware');

const formatWIB = (date) => {
    if (!date) return null;
    return new Date(date).toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' });
};

// =========================================================================
// 1. GET ALL NOTIFICATIONS UNTUK SEBUAH SITE
// URL: GET /api/notifications/:siteId
// =========================================================================
router.get('/:siteId', protect, async (req, res) => {
    try {
        const { siteId } = req.params;
        const userId = req.user._id.toString();

        // 1. Validasi Akses: Pastikan user berhak melihat site ini
        const site = await Site.findById(siteId);
        if (!site) {
            return res.status(404).json({ success: false, message: 'Site not found.' });
        }

        const isOwner = site.ownerId.toString() === userId;
        const isAdmin = site.admins.some(admin => admin.userId.toString() === userId);

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ success: false, message: 'Access Denied: You do not have permission to view notifications for this site.' });
        }

        // 2. Ambil data notifikasi (Max 50 terbaru agar aplikasi tidak lemot)
        const notifications = await Notification.find({ siteId: siteId })
            .sort({ createdAt: -1 }) // -1 artinya urutkan dari yang paling baru
            .limit(50)
            .lean();

        // 3. Hitung berapa notifikasi yang belum dibaca (badge merah di Flutter)
        const unreadCount = await Notification.countDocuments({ siteId: siteId, isRead: false });

        const formattedNotifications = notifications.map(notif => ({
            id: notif._id,
            deviceId: notif.devideId,
            type: notif.type,
            title: notif.title,
            message: notif.message,
            isRead: notif.isRead,
            createdAt: formatWIB(notif.createdAt)
        }));

        res.json({
            success: true,
            unreadCount: unreadCount,
            data: notifications
        });

    } catch (error) {
        console.error("❌ Error get notifications:", error);
        res.status(500).json({ success: false, message: 'An error occurred on the server.' });
    }
});

// =========================================================================
// 2. TANDAI NOTIFIKASI SUDAH DIBACA (MARK AS READ)
// URL: PUT /api/notifications/:id/read
// =========================================================================
router.put('/:id/read', protect, async (req, res) => {
    try {
        const notifId = req.params.id;

        const notif = await Notification.findById(notifId);
        if (!notif) {
            return res.status(404).json({ success: false, message: 'Notification not found.' });
        }

        // Ubah status menjadi sudah dibaca
        notif.isRead = true;
        await notif.save();

        res.json({ success: true, message: 'Notification marked as read.' });

    } catch (error) {
        res.status(500).json({ success: false, message: 'An error occurred on the server.' });
    }
});

module.exports = router;