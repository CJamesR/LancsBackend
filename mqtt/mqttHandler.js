const mqtt = require('mqtt');
const getSensorModel = require('../models/sensorModel'); 
const Device = require('../models/device'); 
const Notification = require('../models/notificationModel');

class MQTTHandler {
  constructor() {
    this.mqttClient = null;
    // Ganti ini dengan URL HiveMQ Cloud Anda nanti jika sudah pindah ke Private Broker
    this.host = process.env.MQTT_BROKER; 
    
    console.log('🔗 MQTT Broker:', this.host);
  }

  getWIBTime() {
    const now = new Date();
    const wibOffset = 7 * 60 * 60 * 1000;
    return new Date(now.getTime() + wibOffset);
  }

  calculateChecksum(id, suhu, kelembapan, waktu) {
    const data = id + Number(suhu).toFixed(2) + Number(kelembapan).toFixed(2) + waktu;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = (hash * 31 + data.charCodeAt(i)) % 65536;
    }
    return hash.toString(16).padStart(4, '0');
  }

  connect() {
    const options = {
      keepalive: 60,
      clientId: 'nodejs_lancsSK_' + Math.random().toString(16).substr(2, 8),
      clean: true,
      username: 'lancsdev',
      password: 'Lancsdev1',
      reconnectPeriod: 1000,
      connectTimeout: 30 * 1000,
    };

    this.mqttClient = mqtt.connect(this.host, options);

    this.mqttClient.on('error', (err) => {
      console.error('❌ MQTT Error:', err);
    });

    this.mqttClient.on('connect', () => {
      console.log('✅ Connected to MQTT Broker');
      this.mqttClient.subscribe('LancsSK/sensor/data', { qos: 0 });
      this.mqttClient.subscribe('LancsSK/status', { qos: 0 });
      this.mqttClient.subscribe('LancsSK/device/status', { qos: 0 });
      this.mqttClient.subscribe('LancsSK/+/data', { qos: 0 });
    });

    this.mqttClient.on('message', async (topic, message) => {
      try {
        await this.handleMessage(topic, message.toString());
      } catch (error) {
        console.error('❌ Error handling MQTT message:', error);
      }
    });
  }

  async handleMessage(topic, message) {
    try {
      const data = JSON.parse(message);
      
      if (topic === 'LancsSK/sensor/data' || (topic.startsWith('LancsSK/') && topic.endsWith('/data'))) {
        await this.processSensorData(data);
      } else if (topic === 'LancsSK/status' || topic === 'LancsSK/device/status') {
        console.log('📊 Device Status:', data);
      }
    } catch (error) {
      console.error('❌ Error parsing MQTT message:', error);
    }
  }

  async processSensorData(data) {
    try {
      // 1. Tampilkan JSON asli yang masuk dari MQTT / ESP32
      console.log("\n📥 [MQTT IN] JSON mentah dari ESP32:");
      console.log(JSON.stringify(data, null, 2));
      
      // Ekstrak 'Waktu' (sesuai nama variabel yang dikirim dari ESP32 teman Anda)
      const { ServerID, Suhu, Kelembapan, Waktu } = data;

      if (!ServerID || Suhu === undefined || Kelembapan === undefined) {
        console.error('❌ Data tidak lengkap');
        return;
      }
      if (parseFloat(Suhu) === -888 || parseFloat(Kelembapan) === -888) {
        console.warn(`⚠️ [Filter Aktiv] Mengabaikan data inisialisasi (-888) dari sensor ${ServerID}`);
        return;
      }

      // =========================================================
      // 2. EMIT LANGSUNG KE FLUTTER (LIVE STREAM)
      // =========================================================
      if (global.io) {
        // Rakit payload JSON
        const socketPayload = {
          id: ServerID,
          temperature: Suhu,
          humidity: Kelembapan,
          // Mengirimkan mentah-mentah apa pun yang dikirim alat (misal: "14:30:00")
          lastUpdated: Waktu || this.getWIBTime().toISOString() 
        };

        // Tampilkan JSON yang akan ditembakkan ke Flutter
        console.log("📤 [SOCKET OUT] JSON dikirim ke Flutter:");
        console.log(JSON.stringify(socketPayload, null, 2));

        // Tembakkan langsung!
        global.io.emit(`update_${ServerID}`, socketPayload);
      }

      // =========================================================
      // 3. MERAKIT TANGGAL UNTUK DATABASE & CHECKSUM
      // =========================================================
      let waktuUntukDB = new Date(); // Fallback ke waktu server UTC saat ini

      if (Waktu && typeof Waktu === 'string' && Waktu.includes(':')) {
        // Karena alat hanya mengirim Jam (HH:MM:SS), kita harus menempelkan tanggal hari ini.
        // Kita ambil tanggal hari ini khusus dalam zona waktu Jakarta (WIB)
        const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }); 
        const dateStringWIB = formatter.format(new Date()); // Menghasilkan "YYYY-MM-DD"
        
        // Gabungkan tanggal, jam dari alat, dan penanda +07:00 (WIB)
        const isoStringWIB = `${dateStringWIB}T${Waktu}+07:00`; // Contoh: "2026-05-21T14:30:00+07:00"
        
        // Node.js akan otomatis menerjemahkan string ini menjadi UTC murni yang valid
        const parsedDate = new Date(isoStringWIB);
        if (!isNaN(parsedDate.getTime())) {
          waktuUntukDB = parsedDate; 
        }
      }

      // Buat checksum menggunakan waktu valid yang sudah dirakit
      const checksum = this.calculateChecksum(ServerID, Suhu, Kelembapan, waktuUntukDB.toISOString());

      const sensorDataToSave = {
        ServerID: ServerID,
        RealID: data.RealID || "-",
        Suhu: parseFloat(Suhu),
        Kelembapan: parseFloat(Kelembapan),
        Waktu: waktuUntukDB, // Aman dimasukkan ke MongoDB
        Checksum: checksum,
        source: 'mqtt'
      };

      // Simpan ke MongoDB Mongoose
      const SensorModel = getSensorModel(ServerID);
      const newSensorData = new SensorModel(sensorDataToSave);
      await newSensorData.save();
      
      console.log(`✅ Data MQTT (${ServerID}) -> Flutter: ${Waktu} | Database: ${waktuUntukDB.toISOString()}`);

      // =========================================================
      // 4. FITUR AUTO-REGISTER & NOTIFIKASI
      // =========================================================
      let device = await Device.findOne({ serialID: ServerID });
      
      if (!device) {
        console.log(`✨ Alat baru terdeteksi (${ServerID})! Mendaftarkan ke database...`);
        device = new Device({
            serialID: ServerID,
            name: `Sensor ${ServerID}`,
            isClaimed: false, 
            siteID: null,
            devicePassword: null
        });
        await device.save();
      }

      if (device) {
        device.lastActive = new Date();
        device.isOnline = true;
        await device.save();

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
              const Notification = require('../models/notificationModel');
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
              }
          }
        }
      }

      // Kirim balasan ke ESP32
      this.publish(`LancsSK/ack/${ServerID}`, JSON.stringify({
        status: 'success',
        message: 'Data saved directly to MongoDB'
      }));

    } catch (error) {
      console.error('❌ Error processing sensor data:', error.message);
    }
  }

  // JANGAN DIHAPUS: Fungsi ini wajib untuk mengirim respon kembali ke alat (ESP32)
  publish(topic, message) {
    if (this.mqttClient && this.mqttClient.connected) {
      this.mqttClient.publish(topic, message);
    } else {
      console.error('❌ Gagal Publish: MQTT belum terhubung.');
    }
  }
}

module.exports = new MQTTHandler();