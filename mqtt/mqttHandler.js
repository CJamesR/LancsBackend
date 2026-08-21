const mqtt       = require('mqtt');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const { logEvent, EVENT } = require('../utils/auditLogger');
const getSensorModel = require('../models/sensorModel');
const Device     = require('../models/device');       
const Gateway    = require('../models/gatewayModel'); 
const Node       = require('../models/nodeModel');    
const Notification = require('../models/notificationModel');
const Site       = require('../models/siteModel');   
const Transaction = require('../models/transactionModel'); 

class MQTTHandler {
  constructor() {
    this.mqttClient = null;
    this.host = process.env.MQTT_BROKER;
    console.log('🔗 MQTT Broker:', this.host);

    this.sensorDataBuffer = {};

    this.deviceCache = {
      gateways: {},
      nodes: {}
    };

    setInterval(() => this.flushSensorDataBuffer(), 30000);
    setInterval(() => this.deviceCache = { gateways: {}, nodes: {} }, 3600000);
  }
  
  getWIBTime() {
    return new Date(Date.now() + 7 * 60 * 60 * 1000);
  }

  getStatus() {
    return { connected: this.mqttClient ? this.mqttClient.connected : false };
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
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
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
      this.mqttClient.subscribe('LancsSK/gateway/ack', { qos: 0 });
      this.mqttClient.subscribe('LancsSK/sensor/register', { qos: 1 });
    });

    this.mqttClient.on('message', async (topic, message) => {
      try {
        await this.handleMessage(topic, message.toString());
      } catch (error) {
        console.error('❌ Error handling MQTT message:', error.message);
      }
    });
  }

  async handleMessage(topic, message) {
    if (topic === 'LancsSK/sensor/data' || (topic.startsWith('LancsSK/') && topic.endsWith('/data'))) {
      if (Buffer.isBuffer(message) && message.length === 20) {
        try {
          const macGateBuffer = message.subarray(0, 6);
          const gateID = macGateBuffer.toString('hex').match(/.{1,2}/g).join(':').toUpperCase();

          const macNodeBuffer = message.subarray(6, 12);
          const nodeID = macNodeBuffer.toString('hex').match(/.{1,2}/g).join(':').toUpperCase();

          const Suhu = message.readFloatLE(12);
          const Kelembapan = message.readFloatLE(16);

          const convertedBiner = {
            gateID: gateID,
            nodeID: nodeID,
            Suhu: Suhu,
            Kelembapan: Kelembapan,
            Waktu: new Date()
          };
          await this.processSensorData(convertedBiner);
          return;
        } catch (error) {
          console.error('❌ Error converting binary MQTT message:', error.message);
          return;
        }
      }
    } 
    
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch {
      console.error('❌MQTT message is not valid JSON:', message.toString());
      return;
    }
    
    if (topic === 'LancsSK/gateway/register') {
      if (data.status === 'deleted_gw' || data.status ==='deleted_node'){
        await this.handleTeardownAck(data);
      } else {
        await this.handleGatewayRegister(data);
      }
    } else if (topic === 'LancsSK/gateway/cmd') {
      console.log('📥 [MQTT IN] Perintah Gateway:', data);
      if (data.cmd === 'pairing_active') {
        console.log(`🔄 Pairing Mode activated for Gateway: ${data.gateway_mac || 'broadcast'}`);
      }
    } else if (topic === 'LancsSK/ack') {
      console.log('📥 [MQTT IN] Status Node:', data);
    } else if (topic === 'LancsSK/gateway/ack') {
      console.log('📥 [MQTT IN] Gateway ACK:', data);
    } else if (topic === 'LancsSK/sensor/register') {
      await this.handleNodeConnectionStatus(data); 
    } else if (
      topic === 'LancsSK/sensor/data' ||
      (topic.startsWith('LancsSK/') && topic.endsWith('/data'))
    ) {
      await this.processSensorData(data);
    } else if (topic === 'LancsSK/status') {
      await this.handleGatewayHeartbeat(data);
    } else if (topic === 'LancsSK/device/status') {
      console.log('📊 [MQTT] Device Status:', data);
    }
  }

  async handleGatewayRegister(data) {
    const { gateway_mac, user_token, siteId, chipId } = data;
    console.log(`\n📥 [MQTT IN] Gateway Register: ${gateway_mac}`);

    if (!gateway_mac || !user_token) {
      console.warn('⚠️ Payload register not valid: gateway_mac or user_token empty.');
      return;
    }

    try {
      const decoded = jwt.verify(user_token, process.env.JWT_SECRET);
      const userId = decoded.userId;

      let actualSiteObjectId = null;

      if (siteId) {
          const site = await Site.findById(siteId);
          if (site) {
              actualSiteObjectId = site._id;
              
              const existingGateway = await Gateway.findOne({ mac: gateway_mac.toUpperCase() });
              if (existingGateway && existingGateway.siteId && existingGateway.siteId.toString() !== actualSiteObjectId.toString()) {
                  await Site.findByIdAndUpdate(existingGateway.siteId, { $pull: { devices: gateway_mac.toUpperCase() } });
              }
              await Site.findByIdAndUpdate(site._id, { $addToSet: { devices: gateway_mac.toUpperCase() } });
          }
      }

      const updatePayload = {
        ownerId: userId,
        siteId: actualSiteObjectId,
        isOnline: true,
        lastSeen: new Date(),
        currentMode: 2
      };

      // if (chipId) {
      //   const salt = await bcrypt.genSalt(10);
      //   updatePayload.chipId = await bcrypt.hash(chipId, salt);
      // }

      const gateway = await Gateway.findOneAndUpdate(
        { mac: gateway_mac.toUpperCase() },
        { $set: updatePayload },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      console.log(`✅ Gateway [${gateway_mac}] registered → User: ${userId}`);
      
      await logEvent(EVENT.DEVICE_REG, gateway_mac.toUpperCase(), `Gateway berhasil diregistrasi ke User ID: ${userId}`);

      this.publish(`LancsSK/gateway/ack/${gateway_mac}`, JSON.stringify({
        status: 'success',
        message: 'Gateway registered. Mode 2 activated.',
        gatewayId: gateway._id.toString()
      }));

    } catch (err) {
      console.error(`❌ Failed to register Gateway [${gateway_mac}]:`, err.message);
      
      await logEvent(EVENT.SYS_ERROR, gateway_mac || 'UNKNOWN', `Kegagalan registrasi Gateway: ${err.message}`);

      this.publish(`LancsSK/gateway/ack/${gateway_mac}`, JSON.stringify({
        status: 'error',
        message: 'Registration failed. Please ensure the token is valid or not expired.'
      }));
    }
  }

  async handleTeardownAck(data) {
    const { status, req_id, gateway_mac, node_mac, mac, hardware_secret } = data; 
    console.log(`\n📥 [MQTT IN] Konfirmasi Teardown Diterima: ${status} | ReqID: ${req_id}`);
    
    try {
      if (req_id === 'MANUAL_BTN_RESET') {
        const targetMac = gateway_mac || mac;

        if (!targetMac) {
             console.error(`❌ [FATAL] Gagal reset manual! Hardware Gateway TIDAK mengirimkan data 'gateway_mac' pada payload JSON-nya.`);
             return; 
        }

        const gatewayData = await Gateway.findOne({ mac: targetMac.toUpperCase() });

        if (!gatewayData) {
            console.error(`❌ Gateway ${targetMac} tidak ditemukan di pangkalan data.`);
            return;
        }

        // if (!gatewayData.chipId) {
        //     console.error(`🚨 [KEAMANAN] Gateway ${targetMac} belum memiliki data Chip ID di sistem. Reset ditolak.`);
        //     await logEvent(EVENT.AUTH_FAIL, targetMac, 'Permintaan reset ditolak: Chip ID tidak terdaftar di database.');
        //     return;
        // }

        // if (!hardware_secret) {
        //     console.error(`🚨 [KEAMANAN] Payload tidak menyertakan hardware_secret. Reset ditolak.`);
        //     await logEvent(EVENT.AUTH_FAIL, targetMac, 'Permintaan reset ditolak: hardware_secret kosong pada payload MQTT.');
        //     return;
        // }

        // const isMatch = await bcrypt.compare(hardware_secret, gatewayData.chipId);
        
        // if (!isMatch) {
        //      console.error(`🚨 [KEAMANAN] Percobaan reset manual DITOLAK untuk Gateway ${targetMac}. Hash Chip ID tidak valid.`);
        //      await logEvent(EVENT.SEC_COMPROMISE, targetMac, 'Upaya reset paksa ditolak. Chip ID tidak cocok dengan hash di database.', { provided_secret: hardware_secret });
        //      return;
        // }

        console.log(`⏳ [TEARDOWN] Bypass validasi transaksi. Mengeksekusi Hard Delete untuk Gateway ${targetMac}...`);
        
        const gateway = await Gateway.findOneAndDelete({ mac: targetMac.toUpperCase() });
        
        if (gateway) {
          await Node.deleteMany({ $or: [{ gateID: gateway._id }, { gatewayId: gateway._id }] });
          if (gateway.siteId) {
            await Site.findByIdAndUpdate(gateway.siteId, { $pull: { devices: targetMac.toUpperCase() } });
          }
        }
        console.log(`✅ [TEARDOWN] Gateway ${targetMac} berhasil di-reset manual dan dihapus dari akun.`);
        
        return; 
      }
      
      const trx = await Transaction.findOne({ req_id });
      if (!trx || (!trx.status.includes('pending'))) return;

      if (status === 'deleted_gw' && trx.type === 'gateway') {
        const gateway = await Gateway.findOneAndDelete({ mac: trx.gateway_mac });
        if (gateway) {
          await Node.deleteMany({ $or: [{ gateID: gateway._id }, { gatewayId: gateway._id }] });
          if (gateway.siteId) {
            await Site.findByIdAndUpdate(gateway.siteId, { $pull: { devices: trx.gateway_mac } });
          }
        }
        trx.status = 'completed';
        await trx.save();
      } 
      else if (status === 'deleted_node' && trx.type === 'node') {
        await Node.findOneAndDelete({ $or: [{ nodeID: trx.node_mac }, { serialId: trx.node_mac }] });
        trx.status = 'completed';
        await trx.save();
        console.log(`✅ [TEARDOWN] Resolusi Asinkron: Siklus hidup Node ${trx.node_mac} diakhiri.`);
        await this.processNextDeletion(gateway_mac || trx.gateway_mac);
      }
      
    } catch (error) {
      console.error('❌ Error saat memproses Teardown ACK:', error.message);
    }
  }

  async flushSensorDataBuffer(){
    for (const gateID in this.sensorDataBuffer){
      const dataToInsert = this.sensorDataBuffer[gateID];

      if (dataToInsert.length > 0) {
        try {
          const SensorModel = getSensorModel(gateID);
          await SensorModel.insertMany(dataToInsert);
          console.log(`✅ [BULK WRITE] ${dataToInsert.length} data stored in sensor_${gateID}`);

          this.sensorDataBuffer[gateID] = [];
        } catch (error) {
          console.error(`❌ [BULK WRITE FAILED] sensor_${gateID}:`, error.message);
        }
      }
    }
  }

  async processSensorData(data) {
    try {
      const { gateID, nodeID, Suhu, Kelembapan, Waktu, Checksum, gps_lat, gps_lon } = data;
      if (!gateID || Suhu === undefined || Kelembapan === undefined) {
        console.error('❌ Data not complete: gateID, Suhu, atau Kelembapan are empty.');
        return;
      }
      if (parseFloat(Suhu) === -888 || parseFloat(Kelembapan) === -888) {
        return;
      }
      let waktuUntukDB = new Date();
      if (Waktu && typeof Waktu === 'string') {
        if (Waktu.includes('T')) {
          const parsed = new Date(Waktu);
          if (!isNaN(parsed.getTime())) waktuUntukDB = parsed;
        } else if (Waktu.includes(':')) {
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
          
          await logEvent(EVENT.DATA_INTEGRITY, gateID, 'Paket telemetri MQTT ditolak karena ketidakcocokan Checksum.', { received: Checksum, expected: expected });

          this.publish(`LancsSK/ack/${gateID}`, JSON.stringify({
            status: 'error',
            message: 'Checksum not matched. Data rejected.'
          }));
          return;
        }
      }
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
        global.io.emit(`update_${gateID}`, socketPayload);
      }

      if (!this.sensorDataBuffer[gateID]) {
        this.sensorDataBuffer[gateID] = [];
      }
      if (this.sensorDataBuffer[gateID].length > 5000) {
        this.sensorDataBuffer[gateID].shift();
      }
      this.sensorDataBuffer[gateID].push({
        gateID,
        nodeID: nodeID || '-',
        Suhu: parseFloat(Suhu),
        Kelembapan: parseFloat(Kelembapan),
        gps_lat: gps_lat != null ? parseFloat(gps_lat) : null,
        gps_lon: gps_lon != null ? parseFloat(gps_lon) : null,
        Waktu: waktuUntukDB,
        Checksum: Checksum || null,
        source: 'mqtt'
      });

      if (nodeID && nodeID !== '-') {
        const upperNodeID = nodeID.toUpperCase();
        const upperGateID = gateID.toUpperCase();
        
        if (!this.deviceCache.nodes[upperNodeID]) {
          let gatewayIdForNode = null;
          let siteIdForNode = null;
          // let gateway = null;

          if (!this.deviceCache.gateways[upperGateID]) {
            const foundGateway = await Gateway.findOne({ mac: upperGateID }).lean();
            if (foundGateway) {
              this.deviceCache.gateways[upperGateID] = { id: foundGateway._id, siteId: foundGateway.siteId };
              gatewayIdForNode = foundGateway._id;
              siteIdForNode = foundGateway.siteId;
            }
          } else {
            // Jika Cache ADA, langsung ambil dari memori (RAM)
            gatewayIdForNode = this.deviceCache.gateways[upperGateID].id;
            siteIdForNode = this.deviceCache.gateways[upperGateID].siteId;
          }
          
          const node = await Node.findOneAndUpdate(
            { nodeID: upperNodeID },
            {
              $set: {
                // PERBAIKAN 2: Menggunakan variabel khusus, menghindari ReferenceError 'gateway'
                gateID: gatewayIdForNode,
                siteId: siteIdForNode,
                isOnline: true,
                lastSeen: new Date(),
                lastTemperature: parseFloat(Suhu),
                lastHumidity: parseFloat(Kelembapan)
              }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          
          this.deviceCache.nodes[upperNodeID] = true;

          if (node.siteId) {
            await this.checkAndCreateAlert(node, parseFloat(Suhu), nodeID);
          }
        }
      }
      await this.updateGatewayStatus(gateID, parseFloat(Suhu));
      this.publish(`LancsSK/ack/${gateID}`, JSON.stringify({
        status: 'success',
        message: 'Data received and saved.'
      }));

    } catch (error) {
      console.error('❌ Error processSensorData:', error.message);
    }
  }

  async updateGatewayStatus(gateID, suhu) {
    await Gateway.findOneAndUpdate(
      { mac: gateID.toUpperCase() },
      { $set: { isOnline: true, lastSeen: new Date() } }
    );
    let device = await Device.findOne({ serialID: gateID });
    if (!device) {
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
    if (device.siteId) {
      await this.checkAndCreateAlert(
        { siteId: device.siteId, minTemp: device.minTemp, maxTemp: device.maxTemp },
        suhu,
        gateID
      );
    }
  }

async handleNodeConnectionStatus(data) {
    try {
      const { gateID, nodeID, status, message } = data;

      // 👇 TAMBAHAN: Cetak log saat ada paket MQTT pendaftaran Node masuk
      console.log(`\n📥 [MQTT IN] Status Koneksi Node Diterima | Gateway: ${gateID || '-'} | Node: ${nodeID || '-'} | Status: ${status}`);

      if (!gateID || !nodeID) {
        console.warn('⚠️ Payload pendaftaran Node ditolak: gateID atau nodeID kosong.');
        return;
      }

      if (status === 'success') {
        const gateway = await Gateway.findOne({ mac: gateID.toUpperCase() });
        
        await Node.findOneAndUpdate(
          { nodeID: nodeID.toUpperCase() },
          {
            $set: {
              gateID: gateway ? gateway._id : null,
              siteId: gateway ? gateway.siteId : null,
              isOnline: true,
              lastSeen: new Date()
            }
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        console.log(`✅ Node [${nodeID.toUpperCase()}] berhasil diikat ke pangkalan data untuk Gateway [${gateID.toUpperCase()}]`);
      } else {
        console.warn(`⚠️ Node [${nodeID.toUpperCase()}] gagal terhubung. Pesan dari hardware: ${message}`);
      }

      if (global.io) {
        const eventName = `node_status_${gateID.toUpperCase()}`;
        global.io.emit(eventName, {
          gateID: gateID,
          nodeID: nodeID,
          status: status, 
          message: message || (status === 'success' ? 'Node berhasil terhubung' : 'Koneksi gagal'),
          timestamp: new Date().toISOString()
        });
        console.log(`📤 [SOCKET OUT] Memancarkan pembaruan antarmuka web melalui rute: ${eventName}`);
      }
      
    } catch (error) {
      console.error('❌ Error handleNodeConnectionStatus:', error.message);
    }
  }

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
    }
  }

  publish(topic, message) {
    if (this.mqttClient && this.mqttClient.connected) {
      this.mqttClient.publish(topic, message);
    } else {
      console.error('❌ Failed to Publish: MQTT not connected.');
    }
  }

  sendGatewayCommand(gatewayMac, cmd, extraPayload = {}) {
    if (!gatewayMac) {
      return false;
    }

    if (!this.mqttClient || !this.mqttClient.connected) {
      return false;
    }
    const payload = JSON.stringify({
      cmd,
      ...extraPayload 
    });
    const targetTopic = `LancsSK/gateway/cmd/${gatewayMac}`;
    
    this.mqttClient.publish(targetTopic, payload, { qos: 1 });
    
    return true;
  }
  
  async processNextDeletion(gatewayMac) {
    try {
      const nextTarget = await Transaction.findOne({
        gateway_mac: gatewayMac,
        status: 'pending_delete',
        type: 'node'
      }).sort({ createdAt: 1 }); 

      if (nextTarget) {
        this.sendGatewayCommand(gatewayMac, 'delete_node', {
          req_id: nextTarget.req_id,
          node_mac: nextTarget.node_mac
        });
      }
    } catch (error) {
      console.error(`❌ [QUEUE ENGINE ERROR] Gagal mengeksekusi rotasi antrean:`, error.message);
    }
  }
  
  async handleGatewayHeartbeat(data) {
    try {
      const {gateID, status} = data;
      if (!gateID) {
        return;
      }
      const upperGateID = gateID.toUpperCase();
      const now = Date.now();

      if (!this.deviceCache.lastSeen) this.deviceCache.lastSeen = {};

      if (!this.deviceCache.lastSeen[upperGateID] || now - this.deviceCache.lastSeen[upperGateID] > 60000) {
        await this.updateGatewayStatus(upperGateID, null);
        this.deviceCache.lastSeen[upperGateID] = now;
      }
    } catch (error) {
      console.error(`❌ Error handleGatewayHeartbeat:`, error.message);
    }
  }
}

module.exports = new MQTTHandler();