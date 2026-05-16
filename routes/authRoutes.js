const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

// Public routes
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/google', authController.googleSignIn);
router.post('/google/complete', authController.completeGoogleProfile);
router.post('/refresh-token', authController.refreshToken);
router.get('/verify-email/:token', authController.verifyEmail);
router.post('/logout', protect, authController.logout);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.get('/verify-reset/:token', authController.verifyResetToken);

// Protected routes
router.post('/profile', protect, authController.getProfile);
router.post('/profile/update', protect, authController.updateProfile);
router.put('/change-password', protect, authController.changePassword);

// ==========================================
// Rute di bawah ini saya matikan (comment) 
// karena fungsinya sedang Anda matikan di authController.js
// ==========================================
// router.post('/debug-login', authController.debugLogin);
// router.get('/debug-users', authController.debugListUsers);

module.exports = router;