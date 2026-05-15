const express = require('express');
const router = express.Router();
const databaseController = require('../controllers/databaseController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

router.use(protect); 
router.use(restrictTo('admin')); // Hanya akun dengan role 'admin' yang bisa lewat
// Public routes untuk database access
router.get('/scan', databaseController.scanDatabase);
router.get('/collection/:collectionName', databaseController.getCollectionData);
router.get('/sensors/all', databaseController.getAllSensors);

module.exports = router;