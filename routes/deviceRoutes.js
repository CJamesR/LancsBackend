const express = require('express');
const router = express.Router();
const User = require('../models/userModel');
const getSensorModel = require('../models/sensorModel');
const { protect } = require('../middleware/authMiddleware');

// Apply auth middleware
router.use(protect);

// @desc    Get user's devices with latest data (untuk Flutter HomePage)
// @route   GET /api/devices
// @access  Private
router.get('/', async (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Endpoint /api/devices sudah dimatikan'
  });
});

// @desc    Add new device (SUDAH DIMATIKAN - Diganti dengan NFC Claiming)
// @route   POST /api/devices
// @access  Private
router.post('/', async (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Endpoint ini sudah dimatikan. Gunakan fitur NFC Claiming di menu Site.'
  });
});

// @desc    Delete a device
// @route   DELETE /api/devices/:deviceId
// @access  Private
router.delete('/:deviceId', async (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Endpoint ini dimatikan. Gunakan fitur Remove Device di dalam menu Site.'
  });
});

// @desc    Update device information
// @route   PUT /api/devices/:deviceId
// @access  Private
router.put('/:deviceId', async (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Endpoint ini dimatikan. Gunakan fitur pengaturan di dalam menu Site.'
  });
});

module.exports = router;