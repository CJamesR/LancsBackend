// const express = require('express');
// const router = express.Router();
// const sensorController = require('../controllers/sensorController');
// const { protect, restrictTo } = require('../middleware/authMiddleware');

// // Semua routes memerlukan autentikasi JWT
// router.use(protect);

// // Get user's gateways/devices
// router.get('/user/gateways', sensorController.getUserGateways);

// // Get all available sensors (for this user)
// router.get('/available', sensorController.getAllSensors);

// // Get data from specific sensor
// router.get('/:sensorId', sensorController.getSensorData);

// // Get aggregated data from sensor
// router.get('/:sensorId/aggregated', sensorController.getAggregatedData);

// // Admin only routes
// router.get('/admin/all', restrictTo('admin'), sensorController.getAllSensors);
// router.delete('/:sensorId', restrictTo('admin'), sensorController.deleteSensorData);

// module.exports = router;

const express = require('express');
const router = express.Router();
const sensorController = require('../controllers/sensorController');
const { protect } = require('../middleware/authMiddleware');
const apiAuth = require('../middleware/apiAuth');
const jsonfilter = require('../middleware/jsonfilter');
const checksumValidator = require('../middleware/checksumValidator');
// Tambahkan rute /latest/:sensorId

router.post('/add', apiAuth, jsonfilter, checksumValidator, sensorController.addSensorData);
router.get('/latest/:sensorId', protect, sensorController.getLatestSensorData);
router.get('/:sensorId', protect, sensorController.getSensorData);
router.get('/user/gateways', sensorController.getUserGateways);
router.get('/available', sensorController.getAllSensors);
router.get('/:sensorId/aggregated', sensorController.getAggregatedData);
router.get('/latest/:sensorId', sensorController.getLatestSensorData);
// JANGAN ada routes lain di file ini
module.exports = router;