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
const Transaction = require('../models/transactionModel');
const crypto = require('crypto');

// =========================================================================
// 🛠️ FUNGSI HELPER
// =========================================================================
const extractUserId = (req) => {
    const id = req.user?._id ?? req.user?.userId ?? req.user?.id;
    if (!id) throw new Error("User ID not found at JWT Token.");
    return id.toString();
};

const isOnline = (date, maxMinutes = 5) => {
    return date && (new Date() - new Date(date)) <= maxMinutes * 60000;
};

const buildGatewayWithNodes = async (gateways) => {
    if (!gateways || gateways.length === 0) {
        console.log('  [buildGatewayWithNodes] Input kosong — return []');
        return [];
    }

    const gwIds = gateways.map(g => g._id);
    console.log(`  [buildGatewayWithNodes] Query nodes untuk ${gateways.length} gateway(s):`, gwIds.map(id => id.toString()));

    // gateID di Node adalah ObjectId → cari berdasarkan _id saja
    const nodes = await Node.find({ gateID: { $in: gwIds } }).lean();
    console.log(`  [buildGatewayWithNodes] Node ditemukan: ${nodes.length}`);
    if (nodes.length > 0) {
        nodes.forEach(n => console.log(`    ↳ Node ${n.nodeID} | gateID: ${n.gateID}`));
    }

    return gateways.map(gw => {
        const childNodes = nodes
            .filter(n => n.gateID?.toString() === gw._id.toString())
            .map(n => ({
                id: n._id,
                serialId: n.nodeID || "-",
                name: n.name || n.nodeID || "Sensor",
                temperature: n.lastTemperature,
                humidity: n.lastHumidity,
                lastUpdate: n.lastSeen,
                status: isOnline(n.lastSeen, 10) ? 'online' : 'offline'
            }));

        console.log(`  [buildGatewayWithNodes] Gateway ${gw.mac} → ${childNodes.length} node(s)`);

        return {
            id: gw._id,
            mac: gw.mac,
            name: gw.name || gw.mac,
            status: isOnline(gw.lastSeen, 5) ? 'online' : 'offline',
            nodes: childNodes
        };
    });
};

const apiLimiter = rateLimiter({ windowMs: 60 * 1000, max: 20, message: { success: false, message: 'Too many requests.' }});

// =========================================================================
// 1. DASHBOARD & GATEWAY FETCHING
// =========================================================================

router.get('/sites/:siteId/dashboard', protect, apiLimiter, async (req, res) => {
    try {
        const userId = extractUserId(req);
        const siteId = req.params.siteId;
        console.log(`\n📊 [DASHBOARD] Request siteId=${siteId} oleh userId=${userId}`);

        const site = await Site.findById(siteId).populate('ownerId', 'username');
        if (!site) {
            console.log('  [DASHBOARD] ❌ Site tidak ditemukan');
            return res.status(404).json({ success: false, message: 'Site not found' });
        }
        console.log(`  [DASHBOARD] ✅ Site ditemukan: "${site.name}" | devices: [${site.devices.join(', ')}]`);

        const isOwner = site.ownerId._id.toString() === userId;
        const role = isOwner
            ? 'owner'
            : (site.admins.some(a => a.userId.toString() === userId) ? 'admin' : 'member');
        console.log(`  [DASHBOARD] Role user ini: ${role}`);

        const upperDevices = site.devices.map(d => d.toUpperCase());
        console.log(`  [DASHBOARD] Mencari Gateway dengan MAC in: [${upperDevices.join(', ')}]`);
        const gateways = await Gateway.find({ mac: { $in: upperDevices } }).lean();
        console.log(`  [DASHBOARD] Gateway ditemukan di DB: ${gateways.length}`);
        if (gateways.length > 0) {
            gateways.forEach(gw => console.log(`    ↳ ${gw.mac} | _id: ${gw._id} | lastSeen: ${gw.lastSeen}`));
        } else {
            console.log('  [DASHBOARD] ⚠️  Tidak ada Gateway yang cocok. Kemungkinan devices di Site berisi serialID Device lama, bukan MAC Gateway baru.');
        }

        const builtData = await buildGatewayWithNodes(gateways);
        console.log(`  [DASHBOARD] ✅ Response dikirim. Total gateway dalam response: ${builtData.length}\n`);

        res.json({
            success: true,
            siteName: site.name,
            ownerName: isOwner ? "Anda" : site.ownerId.username,
            role,
            data: builtData
        });
    } catch (error) {
        console.error("❌ [DASHBOARD] Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/gateways', protect, async (req, res) => {
    try {
        const userId = extractUserId(req);
        console.log(`\n📋 [GATEWAYS] Request oleh userId=${userId}`);
        const gateways = await Gateway.find({ ownerId: userId }).lean();
        console.log(`  [GATEWAYS] Ditemukan: ${gateways.length} gateway(s)`);
        res.json({ success: true, data: await buildGatewayWithNodes(gateways) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/gateway/:mac/nodes', protect, async (req, res) => {
    try {
        const mac = req.params.mac.toUpperCase();
        console.log(`\n🔌 [GATEWAY NODES] Request MAC=${mac}`);
        const gateway = await Gateway.findOne({ mac }).lean();
        if (!gateway) {
            console.log(`  [GATEWAY NODES] ❌ Gateway tidak ditemukan`);
            return res.status(404).json({ success: false, message: 'Gateway not found.' });
        }
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
        const node = await Node.findOne({ nodeID: searchId }).populate('gateID').lean();
        if (!node) return res.status(404).json({ success: false, message: 'Node not found.' });

        const gateway = node.gateID;
        if (!gateway) return res.status(400).json({ success: false, message: 'Node is orphaned (no gateway).' });

        const SensorModel = getSensorModel(gateway.mac);
        const historyData = await SensorModel.find({
            gateID: gateway.mac,
            nodeID: searchId,
            Waktu: { $gte: new Date(Date.now() - 86400000) }
        }).sort({ Waktu: 1 }).select('Suhu Kelembapan Waktu gps_lat gps_lon -_id').lean();

        res.json({
            success: true,
            data: {
                serialId: node.nodeID,
                name: node.name || node.nodeID,
                gatewayMac: gateway.mac,
                status: isOnline(node.lastSeen, 10) ? 'online' : 'offline',
                currentTemperature: node.lastTemperature,
                currentHumidity: node.lastHumidity,
                history24h: historyData.map(d => ({
                    temperature: d.Suhu,
                    humidity: d.Kelembapan,
                    timestamp: d.Waktu,
                    latitude: d.gps_lat,
                    longitude: d.gps_lon
                }))
            }
        });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// =========================================================================
// 3. RENAME
// =========================================================================
// Replace the existing two rename routes with site-scoped versions

router.patch('/sites/:siteId/gateways/:mac/rename', protect, checkSiteRole(['owner', 'admin']), async (req, res) => {
    try {
        const { newName } = req.body;
        if (!newName || !newName.trim()) {
            return res.status(400).json({ success: false, message: 'New name required.' });
        }
        const mac = req.params.mac.toUpperCase();

        const gateway = await Gateway.findOneAndUpdate(
            { mac, siteId: req.params.siteId }, // scoped: must belong to this site
            { name: newName.trim() },
            { new: true }
        );
        if (!gateway) {
            return res.status(404).json({ success: false, message: 'Gateway not found on this site.' });
        }

        await logActivity(req, req.params.siteId, `Renamed gateway ${mac} to "${gateway.name}"`);
        res.json({ success: true, data: { id: gateway._id, mac: gateway.mac, name: gateway.name } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/sites/:siteId/nodes/:nodeId/rename', protect, checkSiteRole(['owner', 'admin']), async (req, res) => {
    try {
        const { newName } = req.body;
        if (!newName || !newName.trim()) {
            return res.status(400).json({ success: false, message: 'New name required.' });
        }

        // Node doesn't store siteId reliably in all paths (some set it, some don't per
        // your model comment) — verify via its gateway's siteId instead, which mqttHandler
        // does populate on first MQTT message.
        const node = await Node.findById(req.params.nodeId).populate('gateID');
        if (!node) return res.status(404).json({ success: false, message: 'Node not found.' });
        if (!node.gateID || node.gateID.siteId?.toString() !== req.params.siteId) {
            return res.status(403).json({ success: false, message: 'Node does not belong to this site.' });
        }

        node.name = newName.trim();
        await node.save();

        await logActivity(req, req.params.siteId, `Renamed node ${node.nodeID} to "${node.name}"`);
        res.json({ success: true, data: { id: node._id, nodeId: node.nodeID, name: node.name } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// =========================================================================
// 4. KONTROL HARDWARE (MQTT COMMANDS)
// =========================================================================
const logActivity = async (req, siteId, actionText) =>
    ActivityLog.create({ userId: extractUserId(req), siteId, action: actionText });

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
        if (!['pairing_active', 'set_wifi'].includes(req.body.command))
            return res.status(400).json({ success: false, message: 'Invalid command' });
        mqttHandler.sendGatewayCommand(req.params.mac.toUpperCase(), req.body.command);
        await logActivity(req, req.params.siteId, `Sent command '${req.body.command}' to gateway ${req.params.mac}`);
        res.json({ success: true, message: 'Command sent.' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/gateway/:mac/set-wifi', protect, async (req, res) => {
    try {
        mqttHandler.sendGatewayCommand(req.params.mac.toUpperCase(), 'set_wifi', {
            ssid: req.body.ssid,
            password: req.body.password
        });
        res.json({ success: true, message: 'WiFi settings pushed via MQTT.' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// =========================================================================
// 5. MANAJEMEN ANGGOTA & UNDANGAN SITE
// =========================================================================
router.post('/sites/:siteId/invite', protect, checkSiteRole(['owner', 'admin']), siteController.inviteUser);
router.delete('/sites/:siteId/members/:memberId', protect, siteController.removeMember);
router.delete('/sites/:siteId/admins/:adminId', protect, checkSiteRole(['owner']), siteController.removeAdmin);

router.get('/invites/pending', protect, async (req, res) => {
    try {
        const user = await User.findById(extractUserId(req));
        const invites = await Invite.find({
            recipientEmail: user.email.toLowerCase(),
            status: 'pending'
        }).sort({ createdAt: -1 });
        res.json({ success: true, count: invites.length, invites });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/invites/:inviteId/respond', protect, async (req, res) => {
    try {
        const invite = await Invite.findById(req.params.inviteId);
        if (!invite || invite.status !== 'pending')
            return res.status(404).json({ success: false, message: 'Invite not found or already responded.' });

        if (req.body.action === 'decline') {
            await Invite.findByIdAndDelete(invite._id);
            return res.json({ success: true, message: 'Invite declined.' });
        }

        const site = await Site.findById(invite.siteId);
        if (site) {
            const userId = extractUserId(req);
            if (invite.role === 'admin') {
                site.admins.push({ userId, allowedDevices: [] });
            } else {
                site.members = site.members || [];
                site.members.push({ userId, role: 'member' });
            }
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
        if (!site) return res.status(404).json({ success: false, message: 'Site not found.' });
        if (site.ownerId.toString() === userId)
            return res.status(400).json({ success: false, message: 'Owner cannot leave.' });

        site.admins = site.admins.filter(a => a.userId.toString() !== userId);
        site.members = (site.members || []).filter(m => m.userId.toString() !== userId);
        await site.save();
        await logActivity(req, site._id, 'Left the site');
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
        if (!req.body.serialId || !req.body.user_token)
            return res.status(400).json({ success: false, message: 'serialId and user_token required.' });

        const decoded = require('jsonwebtoken').verify(req.body.user_token, process.env.JWT_SECRET);
        const targetMac = req.body.serialId.toUpperCase();

        const existingGateway = await Gateway.findOne({ mac: targetMac });
        if (existingGateway && existingGateway.status === 'active') {
            return res.status(409).json({ success: false, message: 'Gateway is already claimed and active.' });
        }

        let actualSiteObjectId = null;
        if (req.body.siteId) {
            const site = await Site.findById(req.body.siteId);
            if (site) {
                actualSiteObjectId = site._id;
                // await Site.findByIdAndUpdate(site._id, {
                //     $addToSet: { devices: targetMac }
                // });
            }
        }

        const gateway = await Gateway.findOneAndUpdate(
            { mac: targetMac },
            {
                $set: {
                    mac: targetMac,
                    ownerId: decoded.userId,
                    ...(actualSiteObjectId && { siteId: actualSiteObjectId }),
                    status: 'pending_claim',
                    isOnline: false,
                    lastSeen: new Date()
                }
            },
            { upsert: true, new: true }
        );
        res.json({ success: true, message: 'Gateway registered.', ata: gateway });
    } catch (error) {
        console.error("❌ Error register gateway:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/devices/teardown_status/:reqId', protect, async (req, res) => {
    try {
        const trx = await Transaction.findOne({ req_id: req.params.reqId });
        if (!trx) return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
        
        res.json({ status: trx.status });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/gateway/:mac/delete', protect, apiLimiter, async (req, res) => {
    try {
        const targetMac = req.params.mac.toUpperCase();
        const isForceDelete = req.query.force === 'true';

        console.log(`\n🗑️ [TEARDOWN] API Hit! Menghapus Gateway: ${targetMac} | Force: ${isForceDelete}`);

        if (isForceDelete) {
            const gateway = await Gateway.findOneAndDelete({ mac: targetMac });
            if (gateway) {
                await Node.deleteMany({ $or: [{ gateID: gateway._id}, {gatewayId: gateway._id}] });
                if (gateway.siteId) {
                    await Site.findByIdAndUpdate(gateway.siteId, { $pull: { devices: targetMac } });
                }
            }
            console.log(`✅ [TEARDOWN] Force delete berhasil dieksekusi di Database.`);
            return res.status(200).json({success: true, message: 'Force delete successful'});
        }

        const req_id = crypto.randomUUID();
        console.log(`⏳ [TEARDOWN] Membuat Transaksi ID: ${req_id}`);
        await Transaction.create({ req_id, gateway_mac: targetMac, type: 'gateway', status: 'pending' });

        console.log(`📤 [TEARDOWN] Mencoba mengirim MQTT ke topik: LancsSK/gateway/cmd/${targetMac}`);
        const isSent = mqttHandler.sendGatewayCommand(targetMac, 'delete_gateway', { req_id });

        if (!isSent) {
            console.error(`❌ [TEARDOWN] GAGAL KIRIM! MQTT Client Node.js tidak terkoneksi ke Broker.`);
            return res.status(503).json({
                success: false, 
                message: 'Perintah gagal dikirim. Backend Node.js tidak terkoneksi ke MQTT.'
            });
        }

        console.log(`✅ [TEARDOWN] Perintah MQTT berhasil meluncur! Menunggu perangkat...`);
        res.status(202).json({status: 'processing', req_id});
    } catch (error) {
        console.error(`🔥 [TEARDOWN FATAL ERROR]:`, error);
        res.status(500).json({success: false, error: error.message}); 
    }
});

router.delete('/node/:serialId/delete', protect, apiLimiter, async (req, res) => {
    try {
        const targetMac = req.params.serialId.toUpperCase();
        const isForceDelete = req.query.force === 'true';
        
        console.log(`\n🗑️ [TEARDOWN] API Hit! Menghapus Node: ${targetMac} | Force: ${isForceDelete}`);

        const node = await Node.findOne({$or: [{ nodeID: targetMac }, { serialID: targetMac }]}).populate('gateID');

        if (isForceDelete) {
            await Node.findOneAndDelete({$or: [{ nodeID: targetMac }, {serialID: targetMac }]});
            console.log(`✅ [TEARDOWN] Force delete Node berhasil.`);
            return res.status(200).json({success: true, message: 'Force delete successful'});
        }
        
        if (!node) {
            console.log(`❌ [TEARDOWN] Node tidak ditemukan di DB.`);
            return res.status(404).json({success: false, message: 'Node not found'});
        }

        const gateway = node.gateID
        if (!gateway) {
            console.log(`❌ [TEARDOWN] Node kehilangan induk (Orphaned).`);
            return res.status(400).json({success: false, message: 'Node is orphaned, use force delete'});
        }

        const req_id = crypto.randomUUID();
        console.log(`⏳ [TEARDOWN] Membuat Transaksi ID: ${req_id}`);
        
        await Transaction.create({ 
            req_id: req_id, 
            gateway_mac: gateway.mac,
            node_mac: targetMac, 
            type: 'node', 
            status: 'pending_delete' 
        });

        console.log(`📤 [TEARDOWN] Sending delete instruction node to Gateway: ${gateway.mac}`);
        
        const isSent = mqttHandler.sendGatewayCommand(gateway.mac, 'delete_node', { 
            req_id: req_id, 
            node_mac: targetMac 
        });
        
        if (!isSent) {
            console.error(`❌ [TEARDOWN] FAILED SENDING MQTT Node!`);
            return res.status(503).json({success: false, message: 'Backend disconnected to MQTT.'});
        }

        console.log(`✅ [TEARDOWN] MQTT Command (Node) executed successfully!`);
        res.status(202).json({status: 'processing', req_id});
    } catch (error) {
        console.error(`🔥 [TEARDOWN FATAL ERROR]:`, error);
        res.status(500).json({success: false, error: error.message});
    }
});

// =========================================================================
// PROTOKOL INTEGRASI: PENGHAPUSAN MULTIKOLOM (BATCH DELETION)
// =========================================================================
router.post('/nodes/delete-batch', protect, apiLimiter, async (req, res) => {
    try {
        const { gateway_mac, node_macs } = req.body;

        if (!gateway_mac || !Array.isArray(node_macs) || node_macs.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Payload format not valid. Make sure the gateway_mac dan node_macs (as array) tersedia.' 
            });
        }

        const targetGateway = gateway_mac.toUpperCase();
        console.log(`\n🗑️ [TEARDOWN BATCH] API Hit! Initializing qeueu for ${node_macs.length} nodes on Gateway: ${targetGateway}`);

        // 1. Merakit array data pelacakan dengan status awal pending_delete
        const transactions = node_macs.map(mac => ({
            req_id: crypto.randomUUID(),
            gateway_mac: targetGateway,
            node_mac: mac.toUpperCase(),
            type: 'node',
            status: 'pending_delete'
        }));

        // 2. Menyuntikkan seluruh entitas ke MongoDB secara serentak (Tanpa for/while MQTT)
        await Transaction.insertMany(transactions);
        console.log(`✅ [TEARDOWN BATCH] ${transactions.length} entitas is injected into the MongoDB qeueu.`);

        // 3. Memanggil Trigger Engine untuk mengeksekusi antrean urutan pertama
        mqttHandler.processNextDeletion(targetGateway);

        // Langsung berikan respons asinkron ke aplikasi (tidak perlu menunggu MQTT selesai)
        res.status(202).json({
            success: true,
            status: 'processing_batch',
            jobs: transactions.map(t => ({ nodeMac: t.node_mac, reqId: t.req_id})),
            message: `The deletion of ${node_macs.length} nodes is being orchestrated in the background.`
        });

    } catch (error) {
        console.error(`🔥 [TEARDOWN BATCH FATAL ERROR]:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;