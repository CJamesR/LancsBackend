const cron = require('node-cron');
const Device = require('../models/device');
const Notification = require('../models/notificationModel');

const startOfflineChecker = () => {
    // Cron job ini akan berjalan otomatis setiap 5 menit (*/5 * * * *)
    cron.schedule('*/5 * * * *', async () => {
        try {
            console.log('🕵️‍♂️ [CRON] Checking Sensor Status (Offline Check)...');
            
            // Tentukan batas waktu: 10 menit yang lalu dari waktu sekarang
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

            // Cari SEMUA alat yang:
            // 1. Saat ini statusnya masih Online
            // 2. Terakhir aktif (lastActive) lebih lama dari 10 menit yang lalu
            // 3. Sudah diklaim ke dalam sebuah Site
            const offlineDevices = await Device.find({
                isOnline: true,
                lastActive: { $lt: tenMinutesAgo },
                siteId: { $ne: null } 
            });

            // Jika ada alat yang terdeteksi mati, lakukan ini:
            for (const device of offlineDevices) {
                // 1. Ubah status alat di database menjadi Offline
                device.isOnline = false;
                await device.save();

                // 2. Buat Notifikasi dan simpan ke database
                await Notification.create({
                    siteId: device.siteId,
                    deviceId: device.serialID,
                    type: 'STATUS_OFFLINE',
                    title: 'Sensor Disconnected (Offline)',
                    message: `Device ${device.name} have stopped sending data since 10 minutes ago. Please check the power or WiFi connection.`
                });
                console.log(`⚠️ OFFLINE ALARM TRIGGERED: ${device.name} was just declared dead.`);
            }

        } catch (error) {
            console.error('❌ Error in Cron Job status checker:', error.message);
        }
    });
};

module.exports = startOfflineChecker;