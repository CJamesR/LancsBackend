const mongoose = require('mongoose');
const getSensorModel = require('../models/sensorModel');
const User = require('../models/userModel');
const Site = require('../models/siteModel');

const getAllowedDevicesIds = async (userId) => {
  const sites = await Site.find({
    $or: [{ownerId: userId}, {'admins.userId': userId}]
  });

  let devicesIdsArray = [];
  sites.forEach(site => {
    if (site.ownerId.toString() === userId.toString()) {
      devicesIdsArray.push(...site.devices);
    } else {
      const adminRecord = site.admins.find(a => a.userId.toString() === userId.toString());
      if (adminRecord && adminRecord.allowedDevices){
        devicesIdsArray.push(...adminRecord.allowedDevices);
      }
    }
  });
  
  return [...new Set(devicesIdsArray.map(id => id.toString()))];
};

// Get statistics for dashboard
exports.getDashboardStats = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);
    const deviceIds = await getAllowedDevicesIds(userId);
    
    if (deviceIds.length === 0) {
        return res.json({
          success: true,
          data: {
            overall: { totalDevices: 0, activeDevices: 0, totalReadings: 0, avgTemperature: null, avgHumidity: null },
            byDevice: [],
            timeRange: null
          }
        });
    }
    // Get data for last 24 hours for all devices
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const statsPromises = deviceIds.map(async (deviceId) => {
      try {
        const SensorModel = getSensorModel(deviceId);
        
        const data = await SensorModel.aggregate([
          {
            $match: {
              Waktu: { $gte: twentyFourHoursAgo }
            }
          },
          {
            $group: {
              _id: '$ServerID',
              avgTemp: { $avg: '$Suhu' },
              avgHumidity: { $avg: '$Kelembapan' },
              readings: { $sum: 1 },
              lastReading: { $max: '$Waktu' }
            }
          }
        ]);
        
        return {
          deviceId,
          ...(data[0] || { avgTemp: null, avgHumidity: null, readings: 0, lastReading: null })
        };
      } catch (error) {
        return {
          deviceId,
          avgTemp: null,
          avgHumidity: null,
          readings: 0,
          lastReading: null,
          error: error.message
        };
      }
    });
    
    const deviceStats = await Promise.all(statsPromises);
    
    // Calculate overall stats
    const validStats = deviceStats.filter(stat => stat.readings > 0);
    const overallStats = {
      totalDevices: deviceIds.length,
      activeDevices: validStats.length,
      totalReadings: validStats.reduce((sum, stat) => sum + stat.readings, 0),
      avgTemperature: validStats.length > 0 
        ? validStats.reduce((sum, stat) => sum + stat.avgTemp, 0) / validStats.length 
        : null,
      avgHumidity: validStats.length > 0
        ? validStats.reduce((sum, stat) => sum + stat.avgHumidity, 0) / validStats.length
        : null
    };
    
    res.json({
      success: true,
      data: {
        overall: overallStats,
        byDevice: deviceStats,
        timeRange: {
          from: twentyFourHoursAgo,
          to: new Date()
        }
      }
    });
    
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard statistics',
      error: error.message
    });
  }
};

// Get chart data for device
exports.getChartData = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { interval = 'hour', hours = 24 } = req.query;
    const userId = req.user.userId;
    
    const user = await User.findById(req.user.userId);
    const hasAccess = user.devices.some(d => d.gatewayId === deviceId);
    
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this device'
      });
    }
    
    const SensorModel = getSensorModel(deviceId);
    const timeAgo = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    let groupByFormat;
    switch(interval) {
      case 'minute':
        groupByFormat = '%Y-%m-%d %H:%M:00';
        break;
      case 'hour':
        groupByFormat = '%Y-%m-%d %H:00:00';
        break;
      case 'day':
        groupByFormat = '%Y-%m-%d';
        break;
      default:
        groupByFormat = '%Y-%m-%d %H:00:00';
    }
    
    const chartData = await SensorModel.aggregate([
      {
        $match: {
          Waktu: { $gte: timeAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: groupByFormat,
              date: "$Waktu",
              timezone: "Asia/Jakarta"
            }
          },
          temperature: { $avg: "$Suhu" },
          humidity: { $avg: "$Kelembapan" },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    res.json({
      success: true,
      data: {
        deviceId,
        interval,
        hours,
        dataPoints: chartData.map(item => ({
          timestamp: item._id,
          temperature: item.temperature,
          humidity: item.humidity,
          readings: item.count
        }))
      }
    });
    
  } catch (error) {
    console.error('Chart data error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching chart data',
      error: error.message
    });
  }
};