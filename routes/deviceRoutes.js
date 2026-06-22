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
    message: 'Endpoint /api/devices has been disabled'
  });
});

// @desc    Add new device (SUDAH DIMATIKAN - Diganti dengan NFC Claiming)
// @route   POST /api/devices
// @access  Private
router.post('/', async (req, res) => {
  res.status(410).json({
    success: false,
    message: 'This endpoint has been disabled. Use the NFC Claiming feature in the Site menu.'
  });
});

// @desc    Delete a device
// @route   DELETE /api/devices/:deviceId
// @access  Private
router.delete('/:deviceId', async (req, res) => {
  res.status(410).json({
    success: false,
    message: 'This endpoint has been disabled. Use the Remove Device feature in the Site menu.'
  });
});

// @desc    Update device information
// @route   PUT /api/devices/:deviceId
// @access  Private
router.put('/:deviceId', async (req, res) => {
  res.status(410).json({
    success: false,
    message: 'This endpoint has been disabled. Use the Settings feature in the Site menu.'
  });
});

module.exports = router;