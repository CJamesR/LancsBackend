const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const Site = require('../models/siteModel'); 

// =========================================================================
// 1. PROTECT ROUTE & AUTO-UPDATE LAST ONLINE
// =========================================================================
exports.protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) return res.status(401).json({ success: false, message: 'Not authorized' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user || !user.isActive) return res.status(401).json({ success: false, message: 'User invalid' });

    req.user = { userId: user._id, role: user.role, username: user.username };

    // 🔥 OPTIMASI: Hanya update jika selisih > 5 menit dari update terakhir
    const now = new Date();
    const fiveMinutes = 5 * 60 * 1000;
    if (!user.lastOnline || (now - user.lastOnline) > fiveMinutes) {
        User.updateOne({ _id: user._id }, { lastOnline: now }).exec();
    }

    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Token invalid' });
  }
};

// =========================================================================
// 2. MIDDLEWARE: RESTRICT TO GLOBAL ROLES (Admin Sistem)
// =========================================================================
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to perform this action' });
    }
    next();
  };
};

// =========================================================================
// 3. MIDDLEWARE: ROLE-BASED ACCESS CONTROL (RBAC) SITE LEVEL
// =========================================================================
exports.checkSiteRole = (allowedRoles) => {
  return async (req, res, next) => {
      try {
          const siteId = req.params.siteId || req.body.siteId;
          const userId = req.user?.userId || req.user?._id;

          if (!siteId) return res.status(400).json({ success: false, message: "Site ID is required for access verification (RBAC)." });

          const site = await Site.findById(siteId);
          if (!site) return res.status(404).json({ success: false, message: "Site not found." });

          const isOwner = site.ownerId.toString() === userId.toString();
          const memberRecord = site.members?.find(m => m.userId.toString() === userId.toString());
          const userRole = isOwner ? 'owner' : (memberRecord ? memberRecord.role : null);

          // 1. Owner selalu diizinkan masuk
          if (isOwner) {
            req.siteData = site;
            return next();}

          // 2. Cek Role Member
          if (userRole && allowedRoles.includes(userRole)) {
            req.siteData = site;
            return next();
          }

          // 3. Fallback: Cek di sistem Admin lama
          const isAdminLama = site.admins.some(a => a.userId.toString() === userId.toString());
          if (isAdminLama && allowedRoles.includes('admin')) {
            req.siteData = site;
            return next();
          }

          return res.status(403).json({ 
              success: false, 
              message: `Access Denied: You are logged in as ${userRole || 'guest'}, the system requires permission [${allowedRoles.join(' / ')}].` 
          });

      } catch (error) {
          res.status(500).json({ success: false, message: "Error in security system (RBAC).", error: error.message });
      }
  };
};

// =========================================================================
// 4. DEPRECATED MIDDLEWARES (Dipertahankan untuk fallback)
// =========================================================================
exports.gatewayAuth = async (req, res, next) => {
    // ... (Logika gatewayAuth bawaan Anda tidak diubah) ...
    try {
      const apiKey = req.headers['x-api-key'];
      const gatewayId = req.headers['x-gateway-id'];
      if (!apiKey || !gatewayId) return res.status(401).json({ success: false, message: 'API key and Gateway ID required' });
  
      const user = await User.findOne({ 'devices.gatewayId': gatewayId, 'devices.apiKey': apiKey, isActive: true });
      if (!user) return res.status(401).json({ success: false, message: 'Invalid API key or Gateway ID' });
  
      const device = user.devices.find(d => d.gatewayId === gatewayId && d.apiKey === apiKey);
      if (!device) return res.status(401).json({ success: false, message: 'Device not found' });
  
      req.user = { userId: user._id, email: user.email, role: user.role, gatewayId: device.gatewayId, deviceName: device.name };
      next();
    } catch (error) {
      res.status(500).json({ success: false, message: 'Authentication error', error: error.message });
    }
};

exports.checkSensorAccess = (req, res, next) => {
    console.warn("⚠️ Warning: checkSensorAccess in authMiddleware.js is called. Use the new checkSiteRole!");
    next();
};