const express = require('express');
const router = express.Router();
const Site = require('../models/siteModel');
const Device = require('../models/device');
const ActivityLog = require('../models/activityLogModel'); // 🔥 TAMBAHAN
const siteController = require('../controllers/siteController'); 
const { protect, checkSiteRole } = require('../middleware/authMiddleware');

const extractUserId = (req) => {
    const raw = req.user?._id ?? req.user?.userId ?? req.user?.id;
    if (!raw) throw new Error("User ID not found in JWT token.");
    return raw.toString();
};

router.get('/', protect, siteController.getMySites);

router.post('/', protect, async (req, res) => {
    try {
        const { name, location } = req.body;
        const userId = extractUserId(req);

        if (!name) return res.status(400).json({ success: false, message: "Site name must be filled!" });

        const newSite = new Site({
            name: name, 
            location: location || "Location not specified",
            ownerId: userId, 
            admins: [], 
            members: [], 
            devices: []
        });

        await newSite.save();
        res.status(201).json({ 
            success: true, 
            message: `Site '${name}' created successfully!`, 
            data: newSite 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: "Failed to create site:" + error.message });
    }
});

router.get('/:siteId/members', protect, checkSiteRole(['owner', 'admin', 'member']), siteController.getSiteMembers);

// Invite dengan RBAC ketat (Owner & Admin saja)
router.post('/:siteId/invite', protect, siteController.inviteUser);

// RENAME + UPDATE LOCATION SITE
// PATCH /api/sites/:siteId
router.patch('/:siteId', protect, checkSiteRole(['owner']), async (req, res) => {
    try {
        const { name, location } = req.body;
        const userId = extractUserId(req);
        const siteId = req.params.siteId;

        // Validasi: Cegah update jika tidak ada data yang dikirim
        if (!name && !location) {
            return res.status(400).json({ success: false, message: 'No data have been changed' });
        }

        const site = await Site.findByIdAndUpdate(
            siteId,
            { ...(name && { name }), ...(location && { location }) },
            { new: true }
        );

        if (!site) return res.status(404).json({ success: false, message: 'Site not found' });

        // 🔥 CATAT AKTIVITAS
        let actionDesc = `Updated site details.`;
        if (name && location) actionDesc = `Changed site name to ${name} and location to ${location}`;
        else if (name) actionDesc = `Renamed site to ${name}`;
        else if (location) actionDesc = `Changed site location to ${location}`;

        await ActivityLog.create({
            userId: userId,
            siteId: siteId,
            action: actionDesc
        });

        res.json({ success: true, message: 'Site successfully updated', data: site });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// LEAVE SITE (member/admin keluar sendiri)
// DELETE /api/sites/:siteId/leave
router.delete('/:siteId/leave', protect, async (req, res) => {
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

        // 🔥 CATAT AKTIVITAS
        await ActivityLog.create({
            userId: userId,
            siteId: siteId,
            action: `Left the site`
        });

        res.json({ success: true, message: 'Successfully left the site.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// REMOVE DEVICE
router.delete('/:siteId/devices/:deviceId', protect, checkSiteRole(['owner', 'admin']), async (req, res) => {
    try {
        const { siteId, deviceId } = req.params;
        const retainData = req.query.retainData !== 'false';
        const userId = extractUserId(req);

        const site = await Site.findById(siteId);
        
        site.devices = site.devices.filter(id => id.toString() !== deviceId.toString());
        site.admins.forEach(admin => { admin.allowedDevices = admin.allowedDevices.filter(id => id.toString() !== deviceId.toString()); });
        await site.save();

        const device = await Device.findOne({ serialID: deviceId });
        let deviceName = deviceId;
        if (device) {
            deviceName = device.name || deviceId;
            device.isClaimed = false; device.siteId = null; device.devicePassword = null;
            await device.save();
        }

        // 🔥 CATAT AKTIVITAS
        await ActivityLog.create({
            userId: userId,
            siteId: siteId,
            action: `Deleted node ${deviceName}`
        });

        let dataWiped = false;
        if (!retainData) {
            const mongoose = require('mongoose');
            const collectionName = `sensor_${deviceId.replace(/[^a-zA-Z0-9]/g, '_')}`;
            const collections = await mongoose.connection.db.listCollections({ name: collectionName }).toArray();
            if (collections.length > 0) { await mongoose.connection.db.dropCollection(collectionName); dataWiped = true; }
        }

        res.json({ success: true, message: `Alat ${deviceId} berhasil dicabut.`, dataWiped: dataWiped });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// DELETE SITE
router.delete('/:siteId', protect, checkSiteRole(['owner']), async (req, res) => {
    try {
        const { siteId } = req.params;
        const retainData = req.query.retainData !== 'false';
        const site = await Site.findById(siteId);

        if (site.admins && site.admins.length > 0) {
            return res.status(400).json({ success: false, code: "HAS_ADMINS", message: "Site still has Admins. Please remove Admins first." });
        }

        if (site.devices && site.devices.length > 0) {
            await Device.updateMany({ serialID: { $in: site.devices } }, { $set: { isClaimed: false, siteId: null, devicePassword: null } });
        }

        let wipedCollections = 0;
        if (!retainData && site.devices && site.devices.length > 0) {
            const mongoose = require('mongoose');
            for (const deviceId of site.devices) {
                const collectionName = `sensor_${deviceId.replace(/[^a-zA-Z0-9]/g, '_')}`;
                const collections = await mongoose.connection.db.listCollections({ name: collectionName }).toArray();
                if (collections.length > 0) { await mongoose.connection.db.dropCollection(collectionName); wipedCollections++; }
            }
        }

        await Site.findByIdAndDelete(siteId);
        res.json({ success: true, message: `Site ${site.name} successfully deleted permanently.`, devicesFreed: site.devices.length, wipedCollections });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// RENAME DEVICE
router.patch('/:siteId/devices/:deviceId/rename', protect, checkSiteRole(['owner', 'admin']), async (req, res) => {
    try {
        const { deviceId, siteId } = req.params;
        const { newName } = req.body;
        const userId = extractUserId(req);

        const updatedDevice = await Device.findByIdAndUpdate(deviceId, { name: newName }, { new: true });

        if (!updatedDevice) return res.status(404).json({ message: "Device not found" });

        // 🔥 CATAT AKTIVITAS
        await ActivityLog.create({
            userId: userId,
            siteId: siteId,
            action: `Renamed device to ${newName}`
        });

        res.status(200).json({ message: "Device name successfully updated", data: updatedDevice });
        if (global.io) { global.io.emit('device_renamed', { deviceId: updatedDevice._id, newName: updatedDevice.name }); }
    } catch (error) {
        res.status(500).json({ error: "Failed to update device name" });
    }
});

// 8. REMOVE MEMBER DARI SITE (Owner bisa hapus Admin/Member, Admin cuma bisa hapus Member)
router.delete(
    '/:siteId/members/:memberId',
    protect,
    checkSiteRole(['owner', 'admin']),
    siteController.removeMember
);

// Hapus admin (owner saja)
router.delete(
    '/:siteId/admins/:adminId',
    protect,
    checkSiteRole(['owner']),
    siteController.removeAdmin
);

router.get(
    '/:siteId/nodes', 
    protect, 
    checkSiteRole(['owner', 'admin', 'member']), 
    siteController.getSiteNodes
);

router.patch('/node/:id/rename', protect, checkSiteRole(['owner', 'admin']), siteController.renameNode);

module.exports = router;