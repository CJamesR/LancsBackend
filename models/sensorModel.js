const mongoose = require("mongoose");

// Function untuk mendapatkan model berdasarkan sensorID
const getSensorModel = (sensorID) => {
  const collectionName = `sensor_${sensorID.replace(/[^a-zA-Z0-9]/g, '_')}`;
  
  // Cek jika model sudah ada, return yang existing
  if (mongoose.models[collectionName]) {
    return mongoose.model(collectionName);
  }

  const sensorSchema = new mongoose.Schema({
    ServerID: { type: String, default: "-" },
    RealID: { type: String, required: true },
    Suhu: { type: Number, required: true },
    Kelembapan: { type: Number, required: true },
    Waktu: { 
      type: Date, 
      required: true,
      default: Date.now,
      expires: '30d'
    }
  }, 
  { 
    timestamps: true,
    collection: collectionName
  });

  return mongoose.model(collectionName, sensorSchema);
};
const scanSensorCollections = async () => {
  try {
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    
    const sensorCollections = collections.filter(col => 
      col.name.startsWith('sensor_')
    );
    
    const sensors = [];
    
    for (const col of sensorCollections) {
      const collectionName = col.name;
      const sensorId = collectionName.replace('sensor_', '');
      
      try {
        const SensorModel = getSensorModel(sensorId);
        const latest = await SensorModel.findOne().sort({ Waktu: -1 }).lean();
        
        sensors.push({
          id: sensorId,
          collectionName: collectionName,
          model: SensorModel,
          exists: true,
          latestData: latest,
          totalRecords: await SensorModel.countDocuments()
        });
      } catch (error) {
        sensors.push({
          id: sensorId,
          collectionName: collectionName,
          exists: false,
          error: error.message
        });
      }
    }
    
    return sensors;
  } catch (error) {
    console.error('Scan error:', error);
    return [];
  }
};

module.exports = getSensorModel;
module.exports.scanSensorCollections = scanSensorCollections; // Export new function