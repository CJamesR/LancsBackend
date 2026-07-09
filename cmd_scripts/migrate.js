require('dotenv').config();
const mongoose = require('mongoose');

// Import semua model yang punya kaitan dengan ID Alat
const Device = require('../models/device');
const Site = require('../models/siteModel');
const Notification = require('../models/notificationModel');

async function jalankanMigrasi() {
    try {
        console.log("⏳ Menghubungkan ke MongoDB...");
        // Pastikan Anda memanggil variabel koneksi DB Anda yang benar
        await mongoose.connect(process.env.MONGODB_URI || "mongodb+srv://NodeMongoLancs:iV91bHoKzSCrbA8l@cluster0.f0urd6c.mongodb.net/sensorDB"); 
        console.log("✅ Terhubung ke Database!\n");

        // ==========================================================
        // 1. UPDATE COLLECTION 'DEVICES' (KTP ALAT)
        // ==========================================================
        console.log("🔍 Memeriksa Collection 'Devices'...");
        const devices = await Device.find();
        for (let device of devices) {
            if (device.serialID.includes('-')) {
                const oldId = device.serialID;
                device.serialID = device.serialID.replace(/-/g, '_');
                await device.save();
                console.log(`  🔄 KTP Alat diubah: ${oldId} ➡️ ${device.serialID}`);
            }
        }

        // ==========================================================
        // 2. UPDATE COLLECTION 'SITES' (Gudang & Akses Admin)
        // ==========================================================
        console.log("\n🔍 Memeriksa Collection 'Sites'...");
        const sites = await Site.find();
        for (let site of sites) {
            let isModified = false;
            
            // Ubah daftar alat utama di Site
            if (site.devices && site.devices.length > 0) {
                site.devices = site.devices.map(id => {
                    if (id.includes('-')) {
                        isModified = true;
                        return id.replace(/-/g, '_');
                    }
                    return id;
                });
            }

            // Ubah izin spesifik alat di masing-masing Admin
            if (site.admins && site.admins.length > 0) {
                site.admins.forEach(admin => {
                    if (admin.allowedDevices && admin.allowedDevices.length > 0) {
                        admin.allowedDevices = admin.allowedDevices.map(id => {
                            if (id.includes('-')) {
                                isModified = true;
                                return id.replace(/-/g, '_');
                            }
                            return id;
                        });
                    }
                });
            }

            if (isModified) {
                await site.save();
                console.log(`  🔄 Site '${site.name}' berhasil dirapikan.`);
            }
        }

        // ==========================================================
        // 3. UPDATE COLLECTION 'NOTIFICATIONS' (Riwayat Alarm)
        // ==========================================================
        console.log("\n🔍 Memeriksa Collection 'Notifications'...");
        const notifications = await Notification.find();
        for (let notif of notifications) {
            if (notif.deviceId && notif.deviceId.includes('-')) {
                notif.deviceId = notif.deviceId.replace(/-/g, '_');
                await notif.save();
            }
        }
        // ==========================================================
        // 4. UPDATE SEMUA COLLECTION SENSOR (VERSI SUPER CEPAT)
        // ==========================================================
        console.log("\n🔍 Memeriksa Semua Collection Suhu (sensor_...)...");
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        
        for (let col of collections) {
            if (col.name.startsWith('sensor_')) {
                const collection = db.collection(col.name);
                
                try {
                    // Menyuruh MongoDB langsung mengganti semua strip menjadi garis bawah sekaligus!
                    const result = await collection.updateMany(
                        { ServerID: /-/ }, 
                        [{ 
                            $set: { 
                                ServerID: { 
                                    $replaceAll: { input: "$ServerID", find: "-", replacement: "_" } 
                                } 
                            } 
                        }]
                    );
                    
                    if (result.modifiedCount > 0) {
                        console.log(`  ⚡ ${result.modifiedCount} baris data di [${col.name}] dirapikan dalam sekejap!`);
                    } else {
                        console.log(`  ✅ [${col.name}] sudah aman/bersih.`);
                    }
                } catch (err) {
                    console.log(`  ⚠️ Gagal memproses [${col.name}]:`, err.message);
                }
            }
        }

        console.log("\n🎉 MIGRASI SELESAI 100%! Semua strip '-' telah musnah dan menjadi '_'.");
        process.exit(0); // Matikan robot

    } catch (error) {
        console.error("❌ Terjadi Error:", error);
        process.exit(1);
    }
}

// Jalankan fungsi
jalankanMigrasi();