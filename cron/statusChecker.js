// const cron = require('node-cron');
// const Device = require('../models/nodeModel');
// const Notification = require('../models/notificationModel');

// const startOfflineChecker = () => {
//     cron.schedule('*/5 * * * *', async () => {
//         try {
//             console.log('🕵️‍♂️ [CRON] Checking Sensor Status (Offline Check)...');
            
//             const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

//             const offlineDevices = await Device.find({
//                 isOnline: true,
//                 lastActive: { $lt: tenMinutesAgo },
//                 siteId: { $ne: null } 
//             }).select('_id serialID name siteId').lean();

//             if (offlineDevices.length === 0) {
//                 console.log('✅ All devices are online.');
//                 return;
//             }

//             const deviceIds =[];
//             const notifications = [];
//             for (const device of offlineDevices) {
//                 deviceIds.push(device._id);

//                 // 2. Buat Notifikasi dan simpan ke database
//                 notifications.push({
//                     siteId: device.siteId,
//                     deviceId: device.serialID,
//                     type: 'STATUS_OFFLINE',
//                     title: 'Sensor Disconnected (Offline)',
//                     message: `Device ${device.name} have stopped sending data since 10 minutes ago. Please check the power or WiFi connection.`
//                 });
//             }
//             await Device.updateMany(
//                 { _id: { $in: deviceIds } },
//                 { $set: { isOnline: false } }
//             );
//             await Notification.insertMany(notifications);
//             console.log(`⚠️ [CRON] OFFLINE ALARM: ${offlineDevices.length} devices were just declared dead.`);

//         } catch (error) {
//             console.error('❌ Error in Cron Job status checker:', error.message);
//         }
//     });
// };

// module.exports = startOfflineChecker;