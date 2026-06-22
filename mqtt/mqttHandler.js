const mqtt       = require('mqtt');
const jwt        = require('jsonwebtoken');
const getSensorModel = require('../models/sensorModel');
const Device     = require('../models/device');       // model lama — tetap dipakai
const Gateway    = require('../models/gatewayModel'); // model baru
const Node       = require('../models/nodeModel');    // model baru
const Notification = require('../models/notificationModel');
const Site       = require('../models/siteModel');   // untuk auto-assign gateway ke site saat registrasi

class MQTTHandler {
  constructor() {
    this.mqttClient = null;
    this.host = process.env.MQTT_BROKER;
    console.log('🔗 MQTT Broker:', this.host);
  }

  // =========================================================================
  // UTILITAS
  // =========================================================================
  getWIBTime() {
    return new Date(Date.now() + 7 * 60 * 60 * 1000);
  }

  getStatus() {
    return { connected: this.mqttClient ? this.mqttClient.connected : false };
  }

  // Algoritma checksum identik dengan checksumValidator.js dan firmware
  calculateChecksum(id, suhu, kelembapan, waktu) {
    const data = id + Number(suhu).toFixed(2) + Number(kelembapan).toFixed(2) + waktu;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = (hash * 31 + data.charCodeAt(i)) % 65536;
    }
    return hash.toString(16).padStart(4, '0');
  }

  // =========================================================================
  // KONEKSI & SUBSCRIBE
  // =========================================================================
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
      console.error('❌ MQTT Error:', err.message);
    });

    this.mqttClient.on('connect', () => {
      console.log('✅ Connected to MQTT Broker');
      this.mqttClient.subscribe('LancsSK/gateway/register', { qos: 1 });
      this.mqttClient.subscribe('LancsSK/gateway/cmd', { qos: 0 });
      this.mqttClient.subscribe('LancsSK/sensor/data', { qos: 0 });
      this.mqttClient.subscribe('LancsSK/+/data', { qos: 0 });
      this.mqttClient.subscribe('LancsSK/status', { qos: 0 });
      this.mqttClient.subscribe('LancsSK/device/status', { qos: 0 });
    });

    this.mqttClient.on('message', async (topic, message) => {
      try {
        await this.handleMessage(topic, message.toString());
      } catch (error) {
        console.error('❌ Error handling MQTT message:', error.message);
      }
    });
  }

  // =========================================================================
  // ROUTER PESAN — if/else if yang benar, tidak ada kebocoran antar topik
  // =========================================================================
  async handleMessage(topic, message) {
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      console.error('❌MQTT message is not valid JSON:', message);
      return;
    }
    if (topic === 'LancsSK/gateway/register') {
      await this.handleGatewayRegister(data);
    } else if (topic === 'LancsSK/gateway/cmd') {
      console.log('📥 [MQTT IN] Perintah Gateway:', data);
      if (data.cmd === 'pairing_active') {
        console.log(`🔄 Pairing Mode activated for Gateway: ${data.gateway_mac || 'broadcast'}`);
      }
    } else if (
      topic === 'LancsSK/sensor/data' ||
      (topic.startsWith('LancsSK/') && topic.endsWith('/data'))
    ) {
      await this.processSensorData(data);
    } else if (topic === 'LancsSK/status' || topic === 'LancsSK/device/status') {
      console.log('📊 [MQTT] Device Status:', data);
    }
  }

async handleGatewayRegister(data) {
    const { gateway_mac, user_token, siteId } = data;
    console.log(`\n📥 [MQTT IN] Gateway Register: ${gateway_mac}`);

    console.log(`🔍 [DEBUG] Payload received: siteId=${siteId || 'Tidak ada'}, token_length=${user_token ? user_token.length : 0}`);

    if (!gateway_mac || !user_token) {
      console.warn('⚠️ Payload register not valid: gateway_mac or user_token empty.');
      return;
    }

    try {
      console.log(`🔍 [DEBUG] Memverifikasi JWT Token...`);
      const decoded = jwt.verify(user_token, process.env.JWT_SECRET);
      const userId = decoded.userId;
      console.log(`✅ [DEBUG] Token Valid. Translation userId: ${userId}`);

      let actualSiteObjectId = null;

      if (siteId) {
        console.log(`🔍 [DEBUG] Search for custom Site by string ID: ${siteId}...`);
          const site = await Site.findById(siteId);
          if (site) {
              actualSiteObjectId = site._id;
              console.log(`✅ [DEBUG] Site found. Translation successful: ObjectId(${actualSiteObjectId})`);
              console.log(`🔄 [DEBUG] Adding MAC ${gateway_mac.toUpperCase()} to the devices list in Site...`);
              await Site.findByIdAndUpdate(site._id, { $addToSet: { devices: gateway_mac.toUpperCase() } });
          }
      }

      const gateway = await Gateway.findOneAndUpdate(
        { mac: gateway_mac.toUpperCase() },
        {
          $set: {
            ownerId: userId,
            siteId: actualSiteObjectId,
            isOnline: true,
            lastSeen: new Date(),
            currentMode: 2
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      console.log(`✅ Gateway [${gateway_mac}] registered → User: ${userId}`);

      this.publish(`LancsSK/gateway/ack/${gateway_mac}`, JSON.stringify({
        status: 'success',
        message: 'Gateway registered. Mode 2 activated.',
        gatewayId: gateway._id.toString()
      }));

    } catch (err) {
      console.error(`❌ Failed to register Gateway [${gateway_mac}]:`, err.message);
      this.publish(`LancsSK/gateway/ack/${gateway_mac}`, JSON.stringify({
        status: 'error',
        message: 'Registration failed. Please ensure the token is valid or not expired.'
      }));
    }
  }

  async processSensorData(data) {
    try {
      console.log('\n📥 [MQTT IN] Data sensor:');
      console.log(JSON.stringify(data, null, 2));

      const { gateID, nodeID, Suhu, Kelembapan, Waktu, Checksum, gps_lat, gps_lon } = data;
      if (!gateID || Suhu === undefined || Kelembapan === undefined) {
        console.error('❌ Data not complete: gateID, Suhu, atau Kelembapan are empty.');
        return;
      }
      if (parseFloat(Suhu) === -888 || parseFloat(Kelembapan) === -888) {
        console.warn(`⚠️ [Filter] Initialitation Signal (-888) from ${gateID} rejected.`);
        return;
      }
      let waktuUntukDB = new Date();
      if (Waktu && typeof Waktu === 'string') {
        if (Waktu.includes('T')) {
          // Format ISO penuh
          const parsed = new Date(Waktu);
          if (!isNaN(parsed.getTime())) waktuUntukDB = parsed;
        } else if (Waktu.includes(':')) {
          // Format jam saja — gabungkan dengan tanggal WIB hari ini
          const dateWIB = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
          const parsed = new Date(`${dateWIB}T${Waktu}+07:00`);
          if (!isNaN(parsed.getTime())) waktuUntukDB = parsed;
        }
      }

      if (Checksum) {
        const expected = this.calculateChecksum(
          gateID, Suhu, Kelembapan, Waktu
        );
        if (Checksum.toLowerCase() !== expected.toLowerCase()) {
          console.error(`🚨 [Checksum FAILED] ${gateID} | diterima: ${Checksum} | diharapkan: ${expected}`);
          this.publish(`LancsSK/ack/${gateID}`, JSON.stringify({
            status: 'error',
            message: 'Checksum not matched. Data rejected.'
          }));
          return;
        }
        console.log(`✅ [Checksum OK] ${gateID}`);
      } else {
        console.warn(`⚠️ [Checksum] No checksum from ${gateID}, data still processed.`);
      }

      // ── Emit real-time ke Flutter via Socket.IO ─────────────────────────
      if (global.io) {
        const socketPayload = {
          id: gateID,
          nodeID: nodeID || null,
          temperature: Suhu,
          humidity: Kelembapan,
          latitude: gps_lat || null,
          longitude: gps_lon || null,
          lastUpdated: waktuUntukDB.toISOString()
        };
        console.log('📤 [SOCKET OUT]', JSON.stringify(socketPayload));
        global.io.emit(`update_${gateID}`, socketPayload);
      }

      // ── Simpan time-series ke koleksi sensor_<gateID> ────────────────
      // Koleksi tetap dikey-kan ke gateID (MAC Gateway) bukan nodeID,
      // karena satu Gateway bisa punya banyak node — data dari semua node
      // yang lewat gateway yang sama masuk ke koleksi yang sama,
      // dan dibedakan oleh field nodeID di dalam dokumen.
      const SensorModel = getSensorModel(gateID);
      await new SensorModel({
        gateID,
        nodeID: nodeID || '-',
        Suhu: parseFloat(Suhu),
        Kelembapan: parseFloat(Kelembapan),
        gps_lat: gps_lat != null ? parseFloat(gps_lat) : null,
        gps_lon: gps_lon != null ? parseFloat(gps_lon) : null,
        Waktu: waktuUntukDB,
        Checksum: Checksum || null,
        source: 'mqtt'
      }).save();
      console.log(`✅ Data saved → sensor_${gateID} | Waktu: ${waktuUntukDB.toISOString()}`);

      // ── TUGAS 2: Bangun relasi Node → Gateway ──────────────────────────
      // Hanya dijalankan jika nodeID valid (bukan '-' atau kosong)
      if (nodeID && nodeID !== '-') {
        // Cari Gateway induk di database
        const gateway = await Gateway.findOne({ mac: gateID.toUpperCase() });

        // UPSERT Node — jika node ini baru, daftarkan otomatis
        const node = await Node.findOneAndUpdate(
          { serialId: nodeID.toUpperCase() },
          {
            $set: {
              gatewayId: gateway ? gateway._id : null,
              siteId: gateway ? gateway.siteId : null,
              isOnline: true,
              lastSeen: new Date(),
              lastTemperature: parseFloat(Suhu),
              lastHumidity: parseFloat(Kelembapan)
            }
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        console.log(`🔗 [Relasi] Node ${nodeID} → Gateway ${gateID}${gateway ? ` (${gateway._id})` : ' (gateway not yet registered)'}`);

        // Alarm suhu per-node
        if (node.siteId) {
          await this.checkAndCreateAlert(node, parseFloat(Suhu), nodeID);
        }
      }

      // ── Perbarui status Gateway (Device lama juga diupdate untuk kompatibilitas) ──
      await this.updateGatewayStatus(gateID, parseFloat(Suhu));

      // ── ACK ke Gateway ──────────────────────────────────────────────────
      this.publish(`LancsSK/ack/${gateID}`, JSON.stringify({
        status: 'success',
        message: 'Data received and saved.'
      }));

    } catch (error) {
      console.error('❌ Error processSensorData:', error.message);
    }
  }

  // =========================================================================
  // HELPER: Perbarui status Gateway di model baru DAN Device lama
  // =========================================================================
  async updateGatewayStatus(gateID, suhu) {
    // Update Gateway model baru
    await Gateway.findOneAndUpdate(
      { mac: gateID.toUpperCase() },
      { $set: { isOnline: true, lastSeen: new Date() } }
    );

    // Update Device lama (backward compatibility untuk statusChecker, siteRoutes, dll)
    let device = await Device.findOne({ serialID: gateID });
    if (!device) {
      console.log(`✨ New Gateway in old Device model (${gateID}). Registering...`);
      device = await Device.create({
        serialID: gateID,
        name: `Gateway ${gateID}`,
        isClaimed: false,
        siteId: null,
        devicePassword: null
      });
    }
    device.lastActive = new Date();
    device.isOnline = true;
    await device.save();

    // Alarm suhu di level Gateway (jika sudah diklaim ke site)
    if (device.siteId) {
      await this.checkAndCreateAlert(
        { siteId: device.siteId, minTemp: device.minTemp, maxTemp: device.maxTemp },
        suhu,
        gateID
      );
    }
  }

  // =========================================================================
  // HELPER: Cek batas suhu dan buat notifikasi jika perlu
  // =========================================================================
  async checkAndCreateAlert(entity, suhu, deviceId) {
    const maxT = entity.maxTemp || 35;
    const minT = entity.minTemp || 15;
    let alertType = null, title = '', message = '';

    if (suhu > maxT) {
      alertType = 'ALERT_HIGH_TEMP';
      title = 'Warning: High Temperature';
      message = `Temperature ${suhu}°C exceeds the maximum limit ${maxT}°C.`;
    } else if (suhu < minT) {
      alertType = 'ALERT_LOW_TEMP';
      title = 'Warning: Low Temperature';
      message = `Temperature ${suhu}°C is below the minimum limit ${minT}°C.`;
    }

    if (!alertType) return;

    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const alreadyNotified = await Notification.findOne({
      deviceId,
      type: alertType,
      createdAt: { $gte: fifteenMinutesAgo }
    });

    if (!alreadyNotified) {
      await Notification.create({
        siteId: entity.siteId,
        deviceId,
        type: alertType,
        title,
        message
      });
      console.log(`⚠️ [Alarm] ${title} on ${deviceId}`);
    }
  }

  // =========================================================================
  // PUBLISH — Kirim pesan ke MQTT broker
  // =========================================================================
  publish(topic, message) {
    if (this.mqttClient && this.mqttClient.connected) {
      this.mqttClient.publish(topic, message);
    } else {
      console.error('❌ Failed to Publish: MQTT not connected.');
    }
  }

  // =========================================================================
  // FASE 1 TOPIK 2 — Kirim perintah ke Gateway via MQTT
  // Dipanggil oleh endpoint: POST /api/flutter/gateway/:mac/cmd
  //
  // Perintah yang didukung saat ini:
  //   pairing_active — aktifkan mode BLE pairing di Gateway
  //   set_wifi       — update kredensial WiFi Gateway (hanya berlaku jika
  //                    Gateway sudah online via WiFi sebelumnya)
  //
  // Catatan: provisioning WiFi PERTAMA KALI tidak lewat sini.
  // Alur awal: Gateway buka AP → Flutter connect langsung ke AP Gateway →
  // Flutter POST credentials ke Gateway (HTTP ke 192.168.4.1) → Gateway
  // connect ke WiFi → Gateway online → baru endpoint ini bisa dipakai
  // untuk update credentials berikutnya.
  //
  // @param {string} gatewayMac  - MAC address Gateway tujuan
  // @param {string} cmd         - 'pairing_active' | 'set_wifi'
  // @param {object} extraPayload - field tambahan, misal { ssid, password }
  // =========================================================================
// =========================================================================
  // FUNGSI PICUAN (TRIGGER) UNTUK REST API
  // @param {string} gatewayMac  - MAC address Gateway tujuan (Wajib)
  // @param {string} cmd         - Perintah eksekusi (contoh: 'pairing_active')
  // @param {object} extraPayload - Field tambahan dinamis
  // =========================================================================
  sendGatewayCommand(gatewayMac, cmd, extraPayload = {}) {
    // 1. Validasi Absolut: Cegah pengiriman tanpa arah rute yang spesifik
    if (!gatewayMac) {
      console.error('❌ [FATAL] Execution cancelled: Target MAC Address Gateway not defined (null/empty).');
      return false;
    }

    if (!this.mqttClient || !this.mqttClient.connected) {
      console.error('❌ Failed to send command: Node.js server disconnected from MQTT broker.');
      return false;
    }

    // 2. Hapus Parameter Payload: gateway_mac dicabut dari rakitan JSON
    const payload = JSON.stringify({
      cmd,
      ...extraPayload 
    });

    // 3. Routing Dinamis: Topik disuntikkan langsung dengan MAC target
    const targetTopic = `LancsSK/gateway/cmd/${gatewayMac}`;
    
    this.mqttClient.publish(targetTopic, payload, { qos: 1 });
    console.log(`📤 [MQTT OUT] Transmission order from '${cmd}' have been launch to: ${targetTopic}`);
    
    return true;
  }
}

module.exports = new MQTTHandler();