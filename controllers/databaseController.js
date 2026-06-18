const mongoose = require('mongoose');

// @desc    Scan semua collections di database
// @route   GET /api/database/scan
// @access  Public
exports.scanDatabase = async (req, res) => {
  try {
    console.log('🔍 Scanning MongoDB database...');
    
    const db = mongoose.connection.db;
    const databaseName = db.databaseName;
    
    // Get semua collections
    const collections = await db.listCollections().toArray();
    
    console.log(`📊 Database: ${databaseName}`);
    console.log(`📊 Total collections: ${collections.length}`);
    
    // Kategorikan collections
    const sensorCollections = [];
    const userCollections = [];
    const otherCollections = [];
    
    collections.forEach(col => {
      if (col.name.startsWith('sensor_')) {
        sensorCollections.push(col);
      } else if (col.name.includes('user') || col.name === 'users') {
        userCollections.push(col);
      } else {
        otherCollections.push(col);
      }
    });
    
    // Get sample data dari setiap sensor collection
    const sensorDetails = await Promise.all(
      sensorCollections.map(async (col) => {
        try {
          const collection = db.collection(col.name);
          
          // Get document count
          const count = await collection.countDocuments();
          
          // Get latest document
          const latestDoc = await collection.findOne({}, { sort: { Waktu: -1 } });
          
          // Get oldest document
          const oldestDoc = await collection.findOne({}, { sort: { Waktu: 1 } });
          
          // Check schema
          const sampleDoc = await collection.findOne({});
          
          return {
            name: col.name,
            type: 'sensor',
            documentCount: count,
            schema: sampleDoc ? Object.keys(sampleDoc) : [],
            latestData: latestDoc ? {
              temperature: latestDoc.Suhu,
              humidity: latestDoc.Kelembapan,
              timestamp: latestDoc.Waktu,
              gateID: latestDoc.gateID
            } : null,
            timeRange: latestDoc && oldestDoc ? {
              from: oldestDoc.Waktu,
              to: latestDoc.Waktu,
              days: Math.ceil((latestDoc.Waktu - oldestDoc.Waktu) / (1000 * 60 * 60 * 24))
            } : null,
            isActive: latestDoc && 
              (new Date() - new Date(latestDoc.Waktu)) < 24 * 60 * 60 * 1000, // Dalam 24 jam
            canBeAccessed: true
          };
        } catch (error) {
          return {
            name: col.name,
            type: 'sensor',
            error: error.message,
            canBeAccessed: false
          };
        }
      })
    );
    
    // Format response
    const response = {
      success: true,
      database: {
        name: databaseName,
        connection: mongoose.connection.host,
        totalCollections: collections.length
      },
      collections: {
        all: collections.map(c => c.name),
        byType: {
          sensors: sensorCollections.map(c => c.name),
          users: userCollections.map(c => c.name),
          others: otherCollections.map(c => c.name)
        }
      },
      sensors: sensorDetails,
      statistics: {
        totalSensors: sensorCollections.length,
        activeSensors: sensorDetails.filter(s => s.isActive).length,
        totalDocuments: sensorDetails.reduce((sum, s) => sum + (s.documentCount || 0), 0),
        accessibleSensors: sensorDetails.filter(s => s.canBeAccessed).length
      },
      timestamp: new Date().toISOString(),
      note: 'Use /api/database/collection/[name] to access specific collection'
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ Database scan error:', error);
    res.status(500).json({
      success: false,
      message: 'Error scanning database',
      error: error.message
    });
  }
};

// @desc    Get data dari collection tertentu
// @route   GET /api/database/collection/:collectionName
// @access  Public
exports.getCollectionData = async (req, res) => {
  try {
    const { collectionName } = req.params;
    const { 
      limit = "50", 
      sort = "desc",
      startDate,
      endDate 
    } = req.query;
    
    console.log(`📊 Accessing collection: ${collectionName}`);
    
    const db = mongoose.connection.db;
    
    // Check if collection exists
    const collections = await db.listCollections({ name: collectionName }).toArray();
    if (collections.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Collection "${collectionName}" not found in database`
      });
    }
    
    const collection = db.collection(collectionName);
    
    // Build query filter
    const filter = {};
    if (startDate || endDate) {
      filter.Waktu = {};
      if (startDate) filter.Waktu.$gte = new Date(startDate);
      if (endDate) filter.Waktu.$lte = new Date(endDate);
    }
    
    // Get data
    const sortOrder = sort === 'asc' ? 1 : -1;
    const data = await collection.find(filter)
      .sort({ Waktu: sortOrder })
      .limit(parseInt(limit))
      .toArray();
    
    // Get statistics
    const totalCount = await collection.countDocuments();
    const latest = data[0] || null;
    
    // Get field information
    const sampleDoc = data[0] || await collection.findOne({});
    const fields = sampleDoc ? Object.keys(sampleDoc) : [];
    
    res.json({
      success: true,
      collection: {
        name: collectionName,
        type: collectionName.startsWith('sensor_') ? 'sensor' : 'other',
        totalDocuments: totalCount,
        fields: fields,
        fieldTypes: sampleDoc ? 
          Object.entries(sampleDoc).map(([key, value]) => ({
            field: key,
            type: typeof value,
            example: typeof value === 'object' ? 'object' : value
          })) : []
      },
      data: {
        count: data.length,
        latest: latest ? {
          ...latest,
          _id: latest._id.toString() // Convert ObjectId to string
        } : null,
        documents: data.map(doc => ({
          ...doc,
          _id: doc._id.toString()
        })),
        timeRange: data.length > 0 ? {
          from: data[data.length - 1].Waktu,
          to: data[0].Waktu
        } : null
      },
      query: {
        limit: parseInt(limit),
        sort,
        startDate,
        endDate,
        filter
      }
    });
    
  } catch (error) {
    console.error(`❌ Collection access error:`, error);
    res.status(500).json({
      success: false,
      message: 'Error accessing collection',
      error: error.message
    });
  }
};

// @desc    Get semua sensor data dengan format unified
// @route   GET /api/sensors/all
// @access  Public
exports.getAllSensors = async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    
    // Filter hanya sensor collections
    const sensorCollections = collections.filter(col => 
      col.name.startsWith('sensor_')
    );
    
    // Get data dari setiap sensor
    const sensors = await Promise.all(
      sensorCollections.map(async (col) => {
        try {
          const collectionName = col.name;
          const sensorId = collectionName.replace('sensor_', '');
          const collection = db.collection(collectionName);
          
          // 1. Ambil data terbaru
          const latest = await collection.findOne({}, { sort: { Waktu: -1 } });
          
          // === PERBAIKAN 1: Handle Sensor Kosong (Belum ada data) ===
          if (!latest) {
            return {
              id: sensorId,
              name: `Sensor ${sensorId}`,
              collection: collectionName,
              status: 'no_data', // Status khusus
              exists: true,
              current: null, // Data kosong
              isActive: false, // Pasti inactive karena tidak ada data
              lastUpdated: null
            };
          }
          
          // 2. LOGIKA FIX TIMEZONE & ACTIVE STATUS
          const now = new Date();
          const wibOffset = 7 * 60 * 60 * 1000;
          const currentTimeWIB = new Date(now.getTime() + wibOffset); 
          
          const diffInMinutes = (currentTimeWIB.getTime() - new Date(latest.Waktu).getTime()) / (1000 * 60);
          
          // Active jika data masuk < 10 menit
          const isActive = diffInMinutes >= 0 && diffInMinutes < 10;
          
          // 3. Ambil data histori 24 jam
          const twentyFourHoursAgo = new Date(currentTimeWIB.getTime() - 24 * 60 * 60 * 1000);
          const recentData = await collection.find({
            Waktu: { $gte: twentyFourHoursAgo }
          })
          .sort({ Waktu: 1 })
          .limit(50) // Limit biar tidak berat loadingnya
          .toArray();
          
          return {
            id: sensorId,
            name: `Sensor ${sensorId}`,
            collection: collectionName,
            status: isActive ? 'active' : 'inactive',
            exists: true,
            current: {
              temperature: latest.Suhu,
              humidity: latest.Kelembapan,
              timestamp: latest.Waktu,
              gateID: latest.gateID
            },
            history24h: recentData.map(doc => ({
              temperature: doc.Suhu,
              humidity: doc.Kelembapan,
              timestamp: doc.Waktu
            })),
            totalRecords: await collection.countDocuments(),
            lastUpdated: latest.Waktu,
            isActive: isActive
          };
        } catch (error) {
          return {
            id: col.name.replace('sensor_', ''),
            status: 'error',
            exists: false
          };
        }
      })
    );
    
    // === PERBAIKAN 2: Filter Longgar ===
    // Tampilkan semua sensor yang koleksinya 'exists', meskipun datanya belum ada (current null)
    const validSensors = sensors.filter(s => s.exists);
    
    res.json({
      success: true,
      data: {
        sensors: validSensors, // Array ini sekarang berisi sensor kosong juga
        count: validSensors.length,
        active: validSensors.filter(s => s.isActive).length,
        inactive: validSensors.filter(s => !s.isActive).length,
        lastScan: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ GetAllSensors error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching sensors',
      error: error.message
    });
  }
};

