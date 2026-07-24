const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

router.use(protect);
router.get('/profile', userController.getProfile);  
router.put('/profile', userController.updateProfile); 
router.put('/change-password', userController.changePassword);
router.get('/all', restrictTo('admin'), userController.getAllUsers);
router.get('/invites', userController.getPendingInvites);
router.post('/invites/respond', userController.respondToInvite);
// router.delete('/delete-account', protect, userController.deleteAccount);

module.exports = router;