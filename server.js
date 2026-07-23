// server.js
require("dotenv").config();

console.log("🔍 CEK EMAIL:", process.env.SMTP_USER);
console.log("🔍 CEK PASS:", process.env.SMTP_PASS ? "PASSWORD TERBACA" : "PASSWORD KOSONG/UNDEFINED");

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/connectDB");
const morgan = require("morgan");
const helmet = require("helmet")
const rateLimit = require("express-rate-limit")
const mongoSanitize = require("express-mongo-sanitize")

// Middleware Imports
const { protect } = require("./middleware/authMiddleware");
const apiAuth = require("./middleware/apiAuth");
const jsonfilter = require("./middleware/jsonfilter");
const checksumValidator = require("./middleware/checksumValidator");

// Routes Imports
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const sensorRoutes = require("./routes/sensorRoutes");
const flutterRoutes = require('./routes/flutterRoutes'); //
const databaseRoutes = require('./routes/databaseRoutes');
const sensorController = require("./controllers/sensorController");
const dataController = require("./controllers/dataController");
const mqttHandler = require("./mqtt/mqttHandler");
const nfcRoutes = require('./routes/nfcHandler');
const siteRoutes = require('./routes/siteRoutes');
const startOfflineChecker = require('./cron/statusChecker');
const notificationRoutes = require('./routes/notificationRoutes');

// Additional Imports
const mongoose = require('mongoose');
const getSensorModel = require('./models/sensorModel');

const admin = require("firebase-admin");
const path = require("path");
const serviceAccount = require("./config/serviceAccountKey.json");
try {
  const serviceAccountPath = path.join(__dirname, 'config', 'serviceAccountKey.json');
  const serviceAccount = require(serviceAccountPath);
  
  // Langsung inisialisasi tanpa mengecek .length
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log("🔥 Firebase Admin SDK (FCM) berhasil diinisialisasi.");
  
} catch (error) {
  // Jika Firebase memprotes karena sudah pernah diinisialisasi, kita abaikan saja
  if (error.code === 'app/duplicate-app') {
    console.log("🔥 Firebase Admin SDK (FCM) sudah berjalan di latar belakang.");
  } else {
    // Cetak error lain jika memang ada masalah krusial
    console.error("❌ Gagal inisialisasi Firebase (FCM). Detail Error Asli:");
    console.error(error.message);
  }
}

const app = express();
app.set('trust proxy', 1);

app.use(express.json({ limit: '100kb' }));
app.use(cors({
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.error("❌ ERROR FATAL: Flutter mengirim format JSON yang cacat!");
    console.error("Pesan Error Express:", err.message);
    return res.status(400).json({
      success: false,
      message: "Format Body bukan JSON yang valid"
    });
  }
  next();
});

app.use(express.urlencoded({ limit: '100kb', extended: true }));
app.use(helmet());
app.use(mongoSanitize());
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 150,
  message: {
    success: false,
    message: "Terlalu banyak request, silakan coba lagi setelah beberapa saat"
  }
});
app.use("/api", limiter)
app.use(morgan('dev'))
app.use("/api/user", userRoutes);
// app.use('/api/sensors', sensorRoutes);
// app.use("/api/devices", deviceRoutes);
app.use('/api/database', databaseRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/nfc', nfcRoutes);
app.use('/api/sites', protect, siteRoutes);
app.use("/api/flutter", protect, flutterRoutes);
app.use('/api/notifications', notificationRoutes);


// ==================== MIDDLEWARE ====================

// Logging middleware
app.use((req, res, next) => {
  console.log(`📨 ${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});


// Connect DB
connectDB();

app.post("/api/sensor/add",
  apiAuth,
  jsonfilter,
  checksumValidator,
  sensorController.addSensorData
);

// ==================== MQTT INITIALIZATION ====================
setTimeout(() => {
  if (mqttHandler && typeof mqttHandler.connect === 'function') {
    mqttHandler.connect();
  }
}, 2000);

// ==================== ROUTES ====================
// ✅ 1. PUBLIC ROUTES
app.get("/api/sensor/public/latest/:sensorId", sensorController.getLatestSensorDataPublic);

// ✅ PUBLIC ROUTE FOR FLUTTER DEVICES (sesuai dengan yang diharapkan Flutter)
// app.get("/api/devices", async (req, res) => {
//   try {
//     console.log('📡 GET /api/devices - Fetching all sensor collections for Flutter');

//     const collections = await mongoose.connection.db.listCollections().toArray();
//     const sensorCollections = collections.filter(col =>
//       col.name.startsWith('sensor_') &&
//       !col.name.includes('undefined')
//     );

//     console.log(`🔍 Found ${sensorCollections.length} sensor collections`);

//     // Format response sesuai dengan yang diharapkan Flutter
//     const devices = sensorCollections.map(col => {
//       const sensorId = col.name.replace('sensor_', '');
//       return {
//         id: sensorId,
//         name: `Sensor ${sensorId}`,
//       };
//     });

//     res.json(devices);

//   } catch (error) {
//     console.error('❌ Error fetching devices:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error fetching devices',
//       error: error.message
//     });
//   }
// });

// ✅ 5. MQTT CONTROL ROUTES
app.post("/api/control/:sensorId", protect, (req, res) => {
  const { sensorId } = req.params;
  const { command, value } = req.body;

  if (!command) {
    return res.status(400).json({
      success: false,
      message: "Command is required"
    });
  }

  if (mqttHandler && typeof mqttHandler.sendCommand === 'function') {
    mqttHandler.sendCommand(sensorId, {
      command,
      value,
      timestamp: new Date().toISOString(),
      from: req.user.email || 'system'
    });
  }

  res.json({
    success: true,
    message: `Command sent to ${sensorId}`,
    data: { command, value, sensorId }
  });
});

// ✅ 6. MQTT STATUS ROUTE
app.get("/api/mqtt/status", protect, (req, res) => {
  const status = mqttHandler ? mqttHandler.getStatus() : { connected: false };
  res.json({
    success: true,
    data: {
      mqtt: status,
      user: {
        email: req.user.email,
        role: req.user.role
      }
    }
  });
});

// ✅ 7. HEALTH-CHECK ROUTE
app.get("/", (req, res) => {
  const mqttStatus = mqttHandler ? mqttHandler.getStatus() : { connected: false };

  res.json({
    success: true,
    message: "🚀 REST API + MQTT ESP8266 aktif",
    version: "2.0.0",
    services: {
      http: "Active",
      mqtt: mqttStatus.connected ? "Connected" : "Disconnected",
      database: "Connected",
      authentication: "JWT + API Key"
    },
    timestamp: new Date().toISOString()
  });
});

// Setelah route lainnya, tambahkan:

app.get("/api/data/stats", protect, dataController.getDashboardStats);
app.get("/api/data/chart/:deviceId", protect, dataController.getChartData);

// ==================== ERROR HANDLING ====================
// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.url}`
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("🔥 Server error:", err.message);
  console.error("🔥 Stack:", err.stack);

  // Handle route errors specifically
  if (err.message && err.message.includes('Route')) {
    return res.status(400).json({
      success: false,
      message: 'Route configuration error'
    });
  }

  res.status(500).json({
    success: false,
    message: "Internal server error",
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ✅ ENDPOINT UNTUK GET SENSOR DATA LANGSUNG (tanpa auth)
// app.get("/api/sensors/all", async (req, res) => {
//   try {
//     console.log('📡 GET /api/sensors/all - Fetching all sensor data');

//     const collections = await mongoose.connection.db.listCollections().toArray();
//     const sensorCollections = collections.filter(col =>
//       col.name.startsWith('sensor_') &&
//       !col.name.includes('undefined')
//     );

//     console.log(`🔍 Found ${sensorCollections.length} sensor collections`);

//     // Get latest data from each sensor
//     const sensorsData = await Promise.all(
//       sensorCollections.map(async (col) => {
//         try {
//           const sensorId = col.name.replace('sensor_', '');
//           const SensorModel = getSensorModel(sensorId);

//           // Get latest data
//           const latestData = await SensorModel.findOne()
//             .sort({ Waktu: -1 })
//             .lean();

//           // Get count of records
//           const count = await SensorModel.countDocuments();

//           return {
//             id: sensorId,
//             name: `Sensor ${sensorId}`,
//             collection: col.name,
//             status: latestData ? 'active' : 'inactive',
//             lastUpdated: latestData?.Waktu || null,
//             latestData: latestData ? {
//               temperature: latestData.Suhu,
//               humidity: latestData.Kelembapan,
//               timestamp: latestData.Waktu
//             } : null,
//             totalRecords: count,
//             canAccess: true
//           };
//         } catch (error) {
//           console.error(`Error processing ${col.name}:`, error.message);
//           return {
//             id: col.name.replace('sensor_', ''),
//             name: `Sensor ${col.name.replace('sensor_', '')}`,
//             collection: col.name,
//             status: 'error',
//             error: error.message
//           };
//         }
//       })
//     );

//     // Filter hanya yang ada data
//     const activeSensors = sensorsData.filter(s => s.latestData);

//     res.json({
//       success: true,
//       message: `Found ${activeSensors.length} active sensors`,
//       data: {
//         sensors: activeSensors,
//         totalSensors: sensorCollections.length,
//         activeSensors: activeSensors.length,
//         inactiveSensors: sensorsData.length - activeSensors.length,
//         timestamp: new Date().toISOString()
//       }
//     });

//   } catch (error) {
//     console.error('❌ Error fetching all sensors:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error fetching sensor data',
//       error: error.message
//     });
//   }
// });


// app.get("/api/test/sensors", async (req, res) => {
//   try {
//     const collections = await mongoose.connection.db.listCollections().toArray();
//     const sensorCollections = collections.filter(col =>
//       col.name.startsWith('sensor_')
//     );

//     res.json({
//       message: "Testing sensor collections",
//       collections: sensorCollections.map(col => col.name),
//       count: sensorCollections.length
//     });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });
// ✅ GET data dari sensor tertentu (tanpa auth, untuk testing)
// app.get("/api/sensors/:sensorId/data", async (req, res) => {
//   try {
//     const { sensorId } = req.params;
//     const { limit = "10" } = req.query;

//     console.log(`📡 GET /api/sensors/${sensorId}/data - Limit: ${limit}`);

//     const SensorModel = getSensorModel(sensorId);

//     // Get data
//     const data = await SensorModel.find()
//       .sort({ Waktu: -1 })
//       .limit(parseInt(limit))
//       .lean();

//     if (!data || data.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: `No data found for sensor ${sensorId}`
//       });
//     }

//     // Get statistics
//     const latest = data[0];
//     const oldest = data[data.length - 1];

//     res.json({
//       success: true,
//       data: {
//         sensorId,
//         records: data.length,
//         latest: {
//           temperature: latest.Suhu,
//           humidity: latest.Kelembapan,
//           timestamp: latest.Waktu
//         },
//         history: data.map(item => ({
//           temperature: item.Suhu,
//           humidity: item.Kelembapan,
//           timestamp: item.Waktu
//         })),
//         timeRange: {
//           from: oldest.Waktu,
//           to: latest.Waktu
//         }
//       }
//     });

//   } catch (error) {
//     console.error(`❌ Error fetching data for sensor ${req.params.sensorId}:`, error);

//     if (error.message.includes('collection') || error.message.includes('model')) {
//       return res.status(404).json({
//         success: false,
//         message: `Sensor ${req.params.sensorId} not found`
//       });
//     }

//     res.status(500).json({
//       success: false,
//       message: 'Error fetching sensor data',
//       error: error.message
//     });
//   }
// });

startOfflineChecker();
// ==================== START SERVER ====================
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0'; // Use your local IP for external access

const http = require('http');
const { Server } = require('socket.io');

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

global.io = io;

io.on('connection', (socket) => {
  console.log(`Klien Aplikasi terhubung! ID: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`Klien Aplikasi terputus: ${socket.id}`);
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log("=".repeat(50));
  console.log("🚀 Server berjalan!");
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Host: ${HOST}`);
  console.log("💾 Database: MongoDB Atlas");
  console.log("=".repeat(50));
})

// const server = app.listen(PORT, HOST, () => {
//   console.log("=".repeat(50));
//   console.log("🚀 Server berjalan!");
//   console.log(`📡 Port: ${PORT}`);
//   console.log(`🌐 Host: ${HOST}`);
//   console.log("💾 Database: MongoDB Atlas");
//   console.log("=".repeat(50));
// });

// Handle server errors
httpServer.on('error', (error) => {
  console.error('🔥 Server startup error:', error.message);
  if (error.code === 'EADDRINUSE') {
    console.log(`💡 Port ${PORT} sedang digunakan!`);
    console.log('   Coba:');
    console.log('   1. Ubah PORT di .env file');
    console.log('   2. Kill process:');
    console.log('      netstat -ano | findstr :${PORT}');
  }
});