const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

const resendLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: {
        success: false,
        message: 'Too many requests, please try again later.'
    }
});

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/google', authController.googleSignIn);
router.post('/google/complete', authController.completeGoogleProfile);
router.post('/refresh-token', authController.refreshToken);
router.get('/verify-email/:token', authController.verifyEmail);
router.post('/logout', protect, authController.logout);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/resend-verification', resendLimiter, authController.resendVerificationEmail);
router.get('/verify-reset/:token', authController.verifyResetToken);

// Protected routes
router.post('/profile', protect, authController.getProfile);
router.post('/profile/update', protect, authController.updateProfile);
router.put('/change-password', protect, authController.changePassword);

module.exports = router;