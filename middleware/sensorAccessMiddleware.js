const Site = require('../models/siteModel');
const Device = require('../models/device');

const checkSensorAccess = async (req, res, next) => {
  try {
    const sensorId = req.params.sensorId || req.body.gateID;
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({ message: 'Tidak terautentikasi' });
    }
    
    // Admin sistem (Superadmin) dapat mengakses semua sensor
    if (user.role === 'admin') {
      return next();
    }
    
    // Cari alat ini terdaftar di Site mana
    const device = await Device.findOne({ serialID: sensorId });
    if (!device || !device.siteId) {
        return res.status(403).json({ message: 'Alat belum terdaftar di Site manapun.' });
    }

    // Cari Site-nya
    const site = await Site.findById(device.siteId);
    if (!site) {
        return res.status(403).json({ message: 'Site untuk alat ini tidak ditemukan.' });
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
      message: 'Akses ditolak. Anda tidak memiliki izin untuk melihat data sensor ini.' 
    });

  } catch (error) {
    res.status(500).json({ message: "Kesalahan server saat memvalidasi akses.", error: error.message });
  }
};

module.exports = checkSensorAccess;