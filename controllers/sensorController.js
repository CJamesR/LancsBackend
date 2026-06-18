const mongoose = require('mongoose');
const getSensorModel = require('../models/sensorModel');
const Device = require('../models/device');
const Notification = require('../models/notificationModel');

// Function untuk mendapatkan waktu GMT+7
function getWIBTime() {
  const now = new Date();
  const wibOffset = 7 * 60 * 60 * 1000;
  return new Date(now.getTime() + wibOffset);
}

// ESP8266: Add sensor data via HTTP POST (API Key)
// ESP8266: Add sensor data via HTTP POST (API Key)
exports.addSensorData = async (req, res) => {
  try {
    let { gateID, nodeID, Suhu, Kelembapan, Checksum, DeviceTime } = req.body;

    console.log('📥 ESP8266 Data received:', { gateID, Suhu, Kelembapan, DeviceTime });

    // Validasi
    if (!gateID || typeof gateID !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Invalid gateID'
      });
    }

    Suhu = Number(Suhu);
    Kelembapan = Number(Kelembapan);

    if (isNaN(Suhu) || isNaN(Kelembapan)) {
      return res.status(400).json({
        success: false,
        message: 'Suhu and Kelembapan must be a number'
      });
    }

    // Get sensor model
    const SensorModel = getSensorModel(gateID);

    const serverTime = getWIBTime();
    let recordTime = serverTime; // Default pakai waktu server

    if (DeviceTime) {
      const parsedTime = new Date(DeviceTime);
      if (!isNaN(parsedTime.getTime())) {
        recordTime = parsedTime;
      } else {
        console.log(`⚠️ Format DeviceTime tidak valid (${DeviceTime}), fallback ke waktu server.`);
      }
    }

    const sensorData = {
      gateId: gateID,
      nodeID: nodeID,
      Suhu,
      Kelembapan,
      Waktu: recordTime, 
      source: 'http',
    };

    if (Checksum) {
      sensorData.Checksum = Checksum;
    }

    const newSensor = new SensorModel(sensorData);
    const saved = await newSensor.save();

    console.log(`✅ Data saved to collection: sensor_${ServerID}`);

    const device = await Device.findOne({ serialID: ServerID });

    if (device) {
      // 1. UPDATE STATUS (BERLAKU UNTUK SEMUA ALAT: Diklaim maupun Belum)
      device.lastActive = new Date();
      device.isOnline = true;
      await device.save();

      // 2. LOGIKA ALARM/NOTIFIKASI (Hanya jika alat sudah dimasukkan ke Site)
      if (device.siteId) {
        let alertType = null;
        let title = '';
        let message = '';

        const maxT = device.maxTemp || 35;
        const minT = device.minTemp || 15;

        if (Suhu > maxT) {
          alertType = 'ALERT_HIGH_TEMP';
          title = 'Peringatan: Suhu Tinggi';
          message = `Suhu ${Suhu}°C melebihi batas maksimum ${maxT}°C.`;
        } else if (Suhu < minT) {
          alertType = 'ALERT_LOW_TEMP';
          title = 'Peringatan: Suhu Rendah';
          message = `Suhu ${Suhu}°C di bawah batas minimum ${minT}°C.`;
        }
        if (alertType) {
          const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
          const recentSpamCheck = await Notification.findOne({
            deviceId: ServerID,
            type: alertType,
            createdAt: { $gte: fifteenMinutesAgo }
          });
          if (!recentSpamCheck) {
            await Notification.create({
              siteId: device.siteId,
              deviceId: ServerID,
              type: alertType,
              title: title,
              message: message
            });
            console.log(`⚠️ ALARM HTTP TERPICU: ${title} pada ${device.name || ServerID}`);
          }
        }
      }
    }

    // Publish to MQTT if needed (for real-time updates)
    if (global.mqttHandler && global.mqttHandler.connected) {
      const mqtt = require('../mqtt/mqttHandler');
      mqtt.sendCommand(ServerID, {
        type: 'data_received',
        data: sensorData
      });
    }

    res.status(201).json({
      success: true,
      message: `Data berhasil disimpan ke sensor_${ServerID}`,
      data: {
        ...saved._doc,
        Waktu: recordTime.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }) 
      }
    });

  } catch (err) {
    console.error('❌ Error saving sensor data:', err.message);
    res.status(500).json({
      success: false,
      message: 'Error saving data',
      error: err.message
    });
  }
};

// Dashboard: Get sensor data (JWT protected)
exports.getSensorData = async (req, res) => {
  try {
    const { sensorId } = req.params;
    const SensorModel = getSensorModel(sensorId);

    const data = await SensorModel.find()
      .sort({ Waktu: -1 })
      .limit(100); // Limit to 100 records

    const formattedData = data.map(item => ({
      ...item._doc,
      Waktu: item.Waktu.toLocaleString('en-US', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    }));

    res.status(200).json({
      success: true,
      data: {
        sensor: sensorId,
        records: formattedData.length,
        data: formattedData,
        timezone: 'Asia/Jakarta (GMT+7)'
      }
    });

  } catch (err) {
    console.error("Error fetching sensor data:", err.message);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data sensor'
    });
  }
};

// Get all sensors
exports.getAllSensors = async (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Endpoint ini sudah dimatikan. Silakan gunakan API Site Dashboard (/api/flutter/sites/:siteId/dashboard).'
  });
};

// ✅ Tambahkan fungsi deleteSensorData yang hilang
exports.deleteSensorData = async (req, res) => {
  try {
    const { sensorId } = req.params;

    // Hanya admin yang bisa delete
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin can delete sensor data'
      });
    }

    const SensorModel = getSensorModel(sensorId);

    // Hapus semua data dari collection ini
    const result = await SensorModel.deleteMany({});

    res.status(200).json({
      success: true,
      message: `Deleted ${result.deletedCount} records from sensor_${sensorId}`,
      deletedCount: result.deletedCount
    });

  } catch (err) {
    console.error("Error deleting sensor data:", err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete sensor data',
      error: err.message
    });
  }
};

// ✅ Tambahkan fungsi getUserGateways jika diperlukan
exports.getUserGateways = async (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Endpoint ini sudah dimatikan. Silakan gunakan API Site Dashboard (/api/flutter/sites/:siteId/dashboard).'
  });
};
// @desc    Get latest sensor data (for Flutter real-time display)
// @route   GET /api/sensor/latest/:sensorId
// @access  Private (JWT required)
exports.getLatestSensorData = async (req, res) => {
  try {
    const { sensorId } = req.params;
    const userId = req.user.userId; // Dari middleware protect

    console.log(`🔍 Latest data request for: ${sensorId} by user: ${userId}`);

    // Optional: Check if user has access to this sensor
    // Jika Anda punya sistem permission, bisa ditambahkan di sini

    // Get sensor model
    const SensorModel = getSensorModel(sensorId);

    // Get the latest record
    const latestData = await SensorModel.findOne()
      .sort({ Waktu: -1 }) // Sort by waktu descending
      .lean();

    if (!latestData) {
      return res.status(404).json({
        success: false,
        message: `No data found for sensor ${sensorId}`,
        data: null
      });
    }

    // Format response untuk Flutter
    const response = {
      success: true,
      data: {
        sensorId: latestData.ServerID,
        temperature: latestData.Suhu,
        humidity: latestData.Kelembapan,
        timestamp: latestData.Waktu,
        formattedTime: latestData.Waktu.toLocaleString('en-US', {
          timeZone: 'Asia/Jakarta',
          hour12: false
        }),
        status: 'online'
      },
      meta: {
        requestedAt: new Date().toISOString(),
        requestedBy: userId
      }
    };

    console.log(`✅ Latest data sent for ${sensorId}:`, {
      temperature: latestData.Suhu,
      humidity: latestData.Kelembapan
    });

    res.status(200).json(response);

  } catch (error) {
    console.error('❌ Error getting latest sensor data:', error.message);

    // Handle collection doesn't exist error
    if (error.message.includes('collection') || error.message.includes('model')) {
      return res.status(404).json({
        success: false,
        message: `Sensor ${req.params.sensorId} not found or has no data`,
        data: null
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error fetching latest sensor data',
      error: error.message
    });
  }
};
exports.getLatestSensorDataPublic = async (req, res) => {
  try {
    const { sensorId } = req.params;

    console.log(`🔍 Public latest data request for: ${sensorId}`);

    // Get sensor model
    const SensorModel = getSensorModel(sensorId);

    // Get the latest record
    const latestData = await SensorModel.findOne()
      .sort({ Waktu: -1 })
      .lean();

    if (!latestData) {
      return res.status(404).json({
        success: false,
        message: `No data found for sensor ${sensorId}`,
        data: null
      });
    }

    const response = {
      success: true,
      data: {
        sensorId: latestData.ServerID,
        temperature: latestData.Suhu,
        humidity: latestData.Kelembapan,
        timestamp: latestData.Waktu,
        formattedTime: latestData.Waktu.toLocaleString('en-US', {
          timeZone: 'Asia/Jakarta',
          hour12: false
        })
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('❌ Error getting public latest sensor data:', error.message);

    res.status(500).json({
      success: false,
      message: 'Error fetching sensor data',
      error: error.message
    });
  }
};

// ✅ Tambahkan fungsi getAggregatedData jika diperlukan
exports.getAggregatedData = async (req, res) => {
  try {
    const { sensorId } = req.params;
    const { interval = 'hour' } = req.query; // hour, day, week, month

    const SensorModel = getSensorModel(sensorId);

    let groupByFormat;
    switch (interval) {
      case 'hour':
        groupByFormat = '%Y-%m-%d %H:00:00';
        break;
      case 'day':
        groupByFormat = '%Y-%m-%d';
        break;
      case 'week':
        groupByFormat = '%Y-%U';
        break;
      case 'month':
        groupByFormat = '%Y-%m';
        break;
      default:
        groupByFormat = '%Y-%m-%d %H:00:00';
    }

    // Aggregation pipeline
    const aggregatedData = await SensorModel.aggregate([
      {
        $group: {
          _id: {
            $dateToString: {
              format: groupByFormat,
              date: "$Waktu",
              timezone: "Asia/Jakarta"
            }
          },
          avgSuhu: { $avg: "$Suhu" },
          avgKelembapan: { $avg: "$Kelembapan" },
          maxSuhu: { $max: "$Suhu" },
          minSuhu: { $min: "$Suhu" },
          maxKelembapan: { $max: "$Kelembapan" },
          minKelembapan: { $min: "$Kelembapan" },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        sensor: sensorId,
        interval,
        aggregatedData
      }
    });

  } catch (err) {
    console.error("Error getting aggregated data:", err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to get aggregated data',
      error: err.message
    });
  }
};