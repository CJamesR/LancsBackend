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
const flutterRoutes = require('./routes/flutterRoutes'); //
const databaseRoutes = require('./routes/databaseRoutes');
const sensorController = require("./controllers/sensorController");
const dataController = require("./controllers/dataController");
const mqttHandler = require("./mqtt/mqttHandler");
const siteRoutes = require('./routes/siteRoutes');
const startOfflineChecker = require('./cron/statusChecker');
const notificationRoutes = require('./routes/notificationRoutes');

const mongoose = require('mongoose');
const getSensorModel = require('./models/sensorModel');
const admin = require("firebase-admin");
const serviceAccount = require("./config/serviceAccountKey.json");
try {
  const serviceAccount = require("./config/serviceAccountKey.json");
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log("🔥 Firebase Admin SDK (FCM) berhasil diinisialisasi.");
} catch (error) {
  console.warn("⚠️ Peringatan: Gagal inisialisasi Firebase (FCM). Pastikan file config/serviceAccountKey.json tersedia.");
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
app.use('/api/database', databaseRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/sites', protect, siteRoutes);
app.use("/api/flutter", protect, flutterRoutes);
app.use('/api/notifications', notificationRoutes);

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

setTimeout(() => {
  if (mqttHandler && typeof mqttHandler.connect === 'function') {
    mqttHandler.connect();
  }
}, 2000);

// ==================== ROUTES ====================
app.get("/api/sensor/public/latest/:sensorId", sensorController.getLatestSensorDataPublic);

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

app.get("/api/data/stats", protect, dataController.getDashboardStats);
app.get("/api/data/chart/:deviceId", protect, dataController.getChartData);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.url}`
  });
});

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