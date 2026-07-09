// const express = require('express');
// const router = express.Router();
// const sensorController = require('../controllers/sensorController');
// const { protect } = require('../middleware/authMiddleware');
// const apiAuth = require('../middleware/apiAuth');
// const jsonfilter = require('../middleware/jsonfilter');
// const checksumValidator = require('../middleware/checksumValidator');
// // Tambahkan rute /latest/:sensorId

// router.post('/add', apiAuth, jsonfilter, checksumValidator, sensorController.addSensorData);
// router.get('/latest/:sensorId', protect, sensorController.getLatestSensorData);
// router.get('/:sensorId', protect, sensorController.getSensorData);
// router.get('/user/gateways', sensorController.getUserGateways);
// router.get('/available', sensorController.getAllSensors);
// router.get('/:sensorId/aggregated', sensorController.getAggregatedData);

// // JANGAN ada routes lain di file ini
// module.exports = router;