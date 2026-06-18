// const express = require('express');
// const router = express.Router();
// const userController = require('../controllers/userController');
// const { protect, restrictTo } = require('../middleware/authMiddleware');

// // All user routes require authentication
// router.use(protect);

// // User profile routes
// router.get('/profile', userController.getProfile);
// router.put('/profile', userController.updateProfile);
// router.put('/change-password', userController.changePassword);

// // Device management
// router.get('/devices', userController.getUserDevices);
// router.post('/devices', userController.registerDevice);

// // Admin only routes
// router.get('/all', restrictTo('admin'), userController.getAllUsers);

// module.exports = router;

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

// Apply protect middleware ke SEMUA routes
router.use(protect);

// PERBAIKAN: Gunakan getProfile untuk GET, updateProfile untuk PUT
router.get('/profile', userController.getProfile);  // ✅ GET profile
router.put('/profile', userController.updateProfile); // ✅ UPDATE profile
router.put('/change-password', userController.changePassword);
router.get('/all', restrictTo('admin'), userController.getAllUsers);
router.get('/invites', userController.getPendingInvites);
router.post('/invites/respond', userController.respondToInvite);

module.exports = router;