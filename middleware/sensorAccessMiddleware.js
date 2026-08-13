const Site = require('../models/siteModel');
const Device = require('../models/device');

const extractUserId = (user) => {
  const raw = user?._id ?? user?.userId ?? user?.id;
  if (!raw) throw new Error('User ID not found in JWT Token');
  return raw.toString();
};

const checkSensorAccess = async (req, res, next) => {
  try {
    const sensorId = req.params.sensorId || req.body.gateID;
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    
    if (user.role === 'admin') {
      return next();
    }
    
    const device = await Device.findOne({ serialID: sensorId });
    if (!device || !device.siteId) {
        return res.status(403).json({ message: 'Device not registered in any site.' });
    }

    const site = await Site.findById(device.siteId);
    if (!site) {
        return res.status(403).json({ message: 'Site for this device not found.' });
    }

    if (site.ownerId.toString() === user.userId.toString()) {
        return next();
    }

    const isAdminAllowed = site.viewers.some(v => 
        v.userId.toString() === user.userId.toString() && 
        v.allowedDevices.includes(sensorId)
    );

    if (isAdminAllowed) {
        return next();
    }

    const isMemberAllowed = site.members.some(m => 
        m.userId.toString() === userIdStr &&
        m.allowedDevices.includes(sensorId)
    );
    
    if (isMemberAllowed) {
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