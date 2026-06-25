const express = require('express');
const router = express.Router();
const rateLimiter = require('express-rate-limit');

// Model & Controllers
const Site = require('../models/siteModel');
const Device = require('../models/device');
const getSensorModel = require('../models/sensorModel');
const ActivityLog = require('../models/activityLogModel');
const Invite = require('../models/inviteModel');
const Gateway = require('../models/gatewayModel');
const Node = require('../models/nodeModel');
const User = require('../models/userModel');
const mqttHandler = require('../mqtt/mqttHandler');
const siteController = require('../controllers/siteController');
const { protect, checkSiteRole } = require('../middleware/authMiddleware');

// =========================================================================
// 🛠️ FUNGSI HELPER (KOMPAK & ANTI-CRASH)
// =========================================================================
const extractUserId = (req) => {
    const id = req.user?._id ?? req.user?.userId ?? req.user?.id;
    if (!id) throw new Error("User ID not found at JWT Token.");
    return id.toString();
};

const isOnline = (date, maxMinutes = 5) => {
    return date && (new Date() - new Date(date)) <= maxMinutes * 60000;
};

// Fungsi sakti untuk merakit Gateway beserta Node di dalamnya
const buildGatewayWithNodes = async (gateways) => {
    const gwIds = gateways.map(g => g._id);
    
    // Pencarian ganda untuk kompabilitas model lama & baru
    const nodes = await Node.find({ 
        $or: [{ gateID: { $in: gwIds } }, { gatewayId: { $in: gwIds } }] 
    }).lean();

    return gateways.map(gw => {
        const childNodes = nodes.filter(n =>
            n.gateID?.toString() === gw._id.toString() || 
            n.gatewayId?.toString() === gw._id.toString()
        ).map(n => ({
            id: n._id,
            serialId: n.nodeID || n.serialId || "-",
            name: n.name || n.nodeID || n.serialId || "Sensor",
            temperature: n.lastTemperature,
            humidity: n.lastHumidity,
            lastUpdate: n.lastSeen,
            status: isOnline(n.lastSeen, 10) ? 'online' : 'offline'
        }));

        return {
            id: gw._id,
            mac: gw.mac,
            name: gw.name || gw.mac,
            status: isOnline(gw.lastSeen, 5) ? 'online' : 'offline',
            nodes: childNodes // 🎯 Permintaan Anda: Node tersambung ada di dalam Gateway
        };
    });
};

const apiLimiter = rateLimiter({ windowMs: 60 * 1000, max: 20, message: { success: false, message: 'Too many requests.' }});

// =========================================================================
// 1. DASHBOARD & GATEWAY FETCHING (Disederhanakan menjadi 3 Rute Pendek)
// =========================================================================
router.get('/sites/:siteId/dashboard', apiLimiter, async (req, res) => {
    try {
        const userId = extractUserId(req);
        const site = await Site.findById(req.params.siteId).populate('ownerId', 'username');
        if (!site) return res.status(404).json({ success: false, message: 'Site not found' });

        const isOwner = site.ownerId._id.toString() === userId;
        const role = isOwner ? 'owner' : (site.admins.some(a => a.userId.toString() === userId) ? 'admin' : 'member');

        const gateways = await Gateway.find({ mac: { $in: site.devices.map(d => d.toUpperCase()) } }).lean();
        
        res.json({
            success: true, 
            siteName: site.name, 
            ownerName: isOwner ? "Anda" : site.ownerId.username, 
            role, 
            data: await buildGatewayWithNodes(gateways) // Langsung rakit JSON lengkap
        });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/gateways', protect, async (req, res) => {
    try {
        const gateways = await Gateway.find({ ownerId: extractUserId(req) }).lean();
        res.json({ success: true, data: await buildGatewayWithNodes(gateways) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/gateway/:mac/nodes', protect, async (req, res) => {
    try {
        const gateway = await Gateway.findOne({ mac: req.params.mac.toUpperCase() }).lean();
        if (!gateway) return res.status(404).json({ success: false, message: 'Gateway not found.' });

        const data = await buildGatewayWithNodes([gateway]);
        res.json({ success: true, gatewayMac: gateway.mac, count: data[0].nodes.length, nodes: data[0].nodes });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// =========================================================================
// 2. DETAIL ALAT & GRAFIK
// =========================================================================
router.get('/node/:serialId/detail', protect, async (req, res) => {
    try {
        const searchId = req.params.serialId.toUpperCase();
        const node = await Node.findOne({ $or: [{nodeID: searchId}, {serialId: searchId}] }).populate('gateID gatewayId').lean();
        if (!node) return res.status(404).json({ success: false, message: 'Node not found.' });

        const gateway = node.gateID || node.gatewayId;
        if (!gateway) return res.status(400).json({ success: false, message: 'Node is orphaned.' });

        const SensorModel = getSensorModel(gateway.mac);
        const historyData = await SensorModel.find({ gateID: gateway.mac, $or: [{nodeID: searchId}, {serialId: searchId}], Waktu: { $gte: new Date(Date.now() - 86400000) } })
            .sort({ Waktu: 1 }).select('Suhu Kelembapan Waktu gps_lat gps_lon -_id').lean();

        res.json({
            success: true,
            data: {
                serialId: node.nodeID || node.serialId,
                name: node.name || node.nodeID || node.serialId,
                gatewayMac: gateway.mac,
                status: isOnline(node.lastSeen, 10) ? 'online' : 'offline',
                currentTemperature: node.lastTemperature,
                currentHumidity: node.lastHumidity,
                history24h: historyData.map(d => ({ temperature: d.Suhu, humidity: d.Kelembapan, timestamp: d.Waktu, latitude: d.gps_lat, longitude: d.gps_lon }))
            }
        });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// =========================================================================
// 3. PENGUBAH NAMA (RENAME) - DIBUAT DINAMIS
// =========================================================================
const renameHandler = (Model, searchField) => async (req, res) => {
    try {
        if (!req.body.newName) return res.status(400).json({ success: false, message: 'New name required.' });
        const doc = await Model.findOneAndUpdate({ [searchField]: req.params.id.toUpperCase() }, { name: req.body.newName.trim() }, { new: true });
        if (!doc) return res.status(404).json({ success: false, message: 'Not found.' });
        res.json({ success: true, message: 'Renamed successfully', data: { id: req.params.id, name: doc.name } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
};

router.patch('/gateway/:id/rename', protect, apiLimiter, renameHandler(Gateway, 'mac'));
router.patch('/device/:id/rename', protect, apiLimiter, renameHandler(Device, 'serialID'));
router.patch('/node/:id/rename', protect, apiLimiter, async (req, res) => {
    try {
        const { newName } = req.body;
        const searchId = req.params.id.toUpperCase();
        if (!newName) return res.status(400).json({ success: false });
        const node = await Node.findOneAndUpdate({ $or: [{nodeID: searchId}, {serialId: searchId}] }, { name: newName.trim() }, { new: true });
        res.json({ success: !!node, data: { name: node.name } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// =========================================================================
// 4. KONTROL HARDWARE (MQTT COMMANDS)
// =========================================================================
const logActivity = async (req, siteId, actionText) => ActivityLog.create({ userId: extractUserId(req), siteId, action: actionText });

router.post('/sites/:siteId/gateways/:mac/pairing', protect, checkSiteRole(['owner', 'admin']), async (req, res) => {
    try {
        mqttHandler.sendGatewayCommand(req.params.mac.toUpperCase(), 'pairing_active');
        await Gateway.findOneAndUpdate({ mac: req.params.mac.toUpperCase() }, { currentMode: 3 });
        await logActivity(req, req.params.siteId, `Activated pairing mode on gateway ${req.params.mac}`);
        res.json({ success: true, message: 'Pairing mode activated.' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/sites/:siteId/gateways/:mac/command', protect, checkSiteRole(['owner', 'admin']), async (req, res) => {
    try {
        if (!['pairing_active', 'set_wifi'].includes(req.body.command)) return res.status(400).json({ success: false, message: 'Invalid command' });
        mqttHandler.sendGatewayCommand(req.params.mac.toUpperCase(), req.body.command);
        await logActivity(req, req.params.siteId, `Sent command '${req.body.command}' to gateway ${req.params.mac}`);
        res.json({ success: true, message: `Command sent.` });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/gateway/:mac/set-wifi', protect, async (req, res) => {
    try {
        mqttHandler.sendGatewayCommand(req.params.mac.toUpperCase(), 'set_wifi', { ssid: req.body.ssid, password: req.body.password });
        res.json({ success: true, message: 'WiFi settings pushed via MQTT.' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// =========================================================================
// 5. MANAJEMEN ANGGOTA & UNDANGAN SITE
// =========================================================================
router.post('/sites/:siteId/invite', checkSiteRole(['owner', 'admin']), siteController.inviteUser);
router.delete('/sites/:siteId/members/:memberId', protect, siteController.removeMember);
router.delete('/sites/:siteId/admins/:adminId', protect, checkSiteRole(['owner']), siteController.removeAdmin);

router.get('/invites/pending', protect, async (req, res) => {
    try {
        const user = await User.findById(extractUserId(req));
        const invites = await Invite.find({ recipientEmail: user.email.toLowerCase(), status: 'pending' }).sort({ createdAt: -1 });
        res.json({ success: true, count: invites.length, invites });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/invites/:inviteId/respond', protect, async (req, res) => {
    try {
        const invite = await Invite.findById(req.params.inviteId);
        if (!invite || invite.status !== 'pending') return res.status(404).json({ success: false });

        if (req.body.action === 'decline') {
            await Invite.findByIdAndDelete(invite._id);
            return res.json({ success: true, message: 'Invite declined.' });
        }

        const site = await Site.findById(invite.siteId);
        if (site) {
            if (invite.role === 'admin') site.admins.push({ userId: extractUserId(req), allowedDevices: [] });
            else { site.members = site.members || []; site.members.push({ userId: extractUserId(req), role: 'member' }); }
            await site.save();
            await logActivity(req, site._id, `Accepted invite and joined as ${invite.role}`);
        }
        await Invite.findByIdAndDelete(invite._id);
        res.json({ success: true, message: 'Invite accepted.' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.delete('/sites/:siteId/leave', protect, async (req, res) => {
    try {
        const userId = extractUserId(req);
        const site = await Site.findById(req.params.siteId);
        if (site.ownerId.toString() === userId) return res.status(400).json({ success: false, message: 'Owner cannot leave.' });

        site.admins = site.admins.filter(a => a.userId.toString() !== userId);
        site.members = (site.members || []).filter(m => m.userId.toString() !== userId);
        await site.save();
        await logActivity(req, site._id, `Left the site`);
        res.json({ success: true, message: 'Successfully left.' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// =========================================================================
// 6. ENDPOINT LAINNYA
// =========================================================================
router.patch('/user/fcm-token', protect, async (req, res) => {
    try {
        await User.findByIdAndUpdate(extractUserId(req), { fcmToken: req.body.fcmToken });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/gateways/register', async (req, res) => {
    try {
        if (!req.body.serialId || !req.body.user_token) return res.status(400).json({ success: false });
        const decoded = require('jsonwebtoken').verify(req.body.user_token, process.env.JWT_SECRET);
        const gateway = await Gateway.findOneAndUpdate(
            { mac: req.body.serialId.toUpperCase() },
            { $set: { mac: req.body.serialId.toUpperCase(), ownerId: decoded.userId, isOnline: true, lastSeen: new Date() } },
            { upsert: true, new: true }
        );
        res.json({ success: true, data: gateway });
    } catch (error) { res.status(500).json({ success: false }); }
});

module.exports = router;