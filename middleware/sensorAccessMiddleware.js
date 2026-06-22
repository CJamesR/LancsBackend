const Site = require('../models/siteModel');
const Device = require('../models/device');

const checkSensorAccess = async (req, res, next) => {
  try {
    const sensorId = req.params.sensorId || req.body.gateID;
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    
    // Admin sistem (Superadmin) dapat mengakses semua sensor
    if (user.role === 'admin') {
      return next();
    }
    
    // Cari alat ini terdaftar di Site mana
    const device = await Device.findOne({ serialID: sensorId });
    if (!device || !device.siteId) {
        return res.status(403).json({ message: 'Device not registered in any site.' });
    }

    // Cari Site-nya
    const site = await Site.findById(device.siteId);
    if (!site) {
        return res.status(403).json({ message: 'Site for this device not found.' });
    }

    // Cek apakah user adalah Admin dari Site ini
    if (site.ownerId.toString() === user.userId.toString()) {
        return next();
    }

    // Cek apakah user adalah Viewer yang diizinkan melihat alat ini
    const isAdminAllowed = site.viewers.some(v => 
        v.userId.toString() === user.userId.toString() && 
        v.allowedDevices.includes(sensorId)
    );

    if (isAdminAllowed) {
        return next();
    }
    
    res.status(403).json({ 
      message: 'Access denied. You do not have permission to view data for this sensor.' 
    });

  } catch (error) {
    res.status(500).json({ message: "Server error while validating access.", error: error.message });
  }
};

module.exports = checkSensorAccess;