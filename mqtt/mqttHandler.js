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
      const { ServerID, Suhu, Kelembapan } = data;

      if (!ServerID || Suhu === undefined || Kelembapan === undefined) {
        console.error('❌ Data tidak lengkap (ServerID, Suhu, Kelembapan wajib ada)');
        return;
      }

      // =========================================================
      // 🤖 FITUR AUTO-REGISTER ALAT BARU
      // =========================================================
      let deviceData = await Device.findOne({ serialID: ServerID });
      
      if (!deviceData) {
        console.log(`✨ Alat baru terdeteksi (${ServerID})! Mendaftarkan ke database...`);
        deviceData = new Device({
            serialID: ServerID,
            name: `Sensor ${ServerID}`,
            isClaimed: false, // Status: Siap diklaim via NFC
            siteID: null,
            devicePassword: null
        });
        await deviceData.save();
        console.log(`✅ Alat ${ServerID} berhasil didaftarkan.`);
      }
      // =========================================================

      const waktu = this.getWIBTime();
      const checksum = this.calculateChecksum(ServerID, Suhu, Kelembapan, waktu.toISOString());

      const sensorDataToSave = {
        ServerID: ServerID,
        RealID: data.RealID || "-",
        Suhu: parseFloat(Suhu),
        Kelembapan: parseFloat(Kelembapan),
        Waktu: waktu,
        Checksum: checksum,
        source: 'mqtt'
      };

      // Simpan langsung ke MongoDB Mongoose (Tanpa Axios!)
      const SensorModel = getSensorModel(ServerID);
      const newSensorData = new SensorModel(sensorDataToSave);
      await newSensorData.save();
      
      if (global.io) {
        global.io.emit(`update_${ServerID}`, {
          id: ServerID,
          temperature: Suhu,
          humidity: Kelembapan,
          lastUpdated: waktu,
        });
      }
      
      console.log(`✅ Sukses tersimpan ke collection: sensor_${ServerID} | Suhu: ${Suhu}, Hum: ${Kelembapan}`);

      const device = await Device.findOne({ serialID: ServerID });
      if (device && device.siteId) {
        device.lastActive = new Date();
        device.isOnline = true;
        await device.save();

        let alertType = null;
        let title = '';
        let message = '';

        const maxT = device.maxTemp || 35;
        const minT = device.minTemp || 15;
        if (Suhu > maxT) {
          alertType = 'ALERT_HIGH_TEMP';
          title = 'Peringatan: Suhu Terlalu Tinggi!';
          message = `Suhu mencapai ${Suhu}°C, melebihi batas maksimum ${maxT}°C.`;
      } else if (Suhu < minT) {
          alertType = 'ALERT_LOW_TEMP';
          title = 'Peringatan: Suhu Terlalu Rendah!';
          message = `Suhu mencapai ${Suhu}°C, di bawah batas minimum ${minT}°C.`;
      }

      if (alertType) {
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
        const recentAlert = await Notification.findOne({
          deviceId: ServerID,
          type: alertType,
          createdAt: { $gte: fifteenMinutesAgo }
        });
        if (!recentAlert) {
          await Notification.create({
            siteId: device.siteId,
            deviceId: ServerID,
            type: alertType,
            title: title,
            message: message
          });
          console.log(`⚠️ ALARM MQTT TERPICU: ${title} pada ${device.name}`);
        }
      }
    }

      // Kirim balasan ke ESP8266
      this.publish(`LancsSK/ack/${ServerID}`, JSON.stringify({
        status: 'success',
        message: 'Data saved directly to MongoDB',
        timestamp: new Date().toISOString()
      }));

    } catch (error) {
      console.error('❌ Error processing sensor data:', error.message);
      if (data && data.ServerID) {
        this.publish(`LancsSK/ack/${data.ServerID}`, JSON.stringify({
          status: 'error',
          message: 'Database save failed: ' + error.message,
          timestamp: new Date().toISOString()
        }));
      }
    }
  }

  publish(topic, message) {
    if (this.mqttClient && this.mqttClient.connected) {
      this.mqttClient.publish(topic, message, { qos: 0, retain: false });
    }
  }

  sendCommand(sensorId, command) {
    this.publish(`LancsSK/control/${sensorId}`, JSON.stringify({
      ...command,
      timestamp: new Date().toISOString(),
      from: 'nodejs_server'
    }));
  }

  getStatus() {
    return this.mqttClient ? {
      connected: this.mqttClient.connected,
      broker: this.host
    } : { connected: false };
  }
}

module.exports = new MQTTHandler();