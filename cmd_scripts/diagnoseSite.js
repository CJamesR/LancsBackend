// diagnoseSite.js
// Cara Penggunaan:
// 1. node diagnoseSite.js                  (HANYA pemindaian massal ke semua data)
// 2. node diagnoseSite.js <ID_SITE>        (Cek spesifik 1 site, lalu pemindaian massal)
// 3. node diagnoseSite.js --cleanup        (Pemindaian massal + hapus orphan)
// 4. node diagnoseSite.js <ID_SITE> --cleanup

require('dotenv').config();
const mongoose = require('mongoose');

// Ambil parameter dari terminal
const args = process.argv.slice(2);
const isCleanup = args.includes('--cleanup');
// Jika ada argumen yang bukan '--cleanup', anggap itu sebagai ID spesifik
const paramId = args.find(arg => !arg.startsWith('--'));

async function diagnose() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;

    // =========================================================
    // BLOK A: PENGECEKAN SPESIFIK (Hanya berjalan jika ID diberikan)
    // =========================================================
    if (paramId) {
        // Validasi ObjectID sebelum melakukan pencarian untuk mencegah Crash
        if (!mongoose.Types.ObjectId.isValid(paramId)) {
            console.log(`❌ FATAL ERROR: SITE_ID "${paramId}" tidak valid. Harus format 24 karakter heksadesimal.`);
            process.exit(1);
        }
        
        const targetSiteObjId = new mongoose.Types.ObjectId(paramId);

        console.log('='.repeat(60));
        console.log(`🔍 DIAGNOSIS SPESIFIK UNTUK ID: ${paramId}`);
        console.log('='.repeat(60));

        // --- Cek 1: Raw query ke koleksi "sites" ---
        const rawSite = await db.collection('sites').findOne({ _id: targetSiteObjId });

        if (!rawSite) {
            console.log(`❌ Site ${paramId} TIDAK DITEMUKAN di koleksi "sites"`);
            console.log('   → Kemungkinan: Sudah terhapus tetapi referensinya masih tertinggal di tempat lain.\n');
        } else {
            console.log(`✅ Site DITEMUKAN:`);
            console.log(JSON.stringify(rawSite, null, 2));
            console.log('');
        }

        // --- Cek 2: Eksistensi ownerId di koleksi users ---
        if (rawSite && rawSite.ownerId) {
            const ownerObjId = mongoose.Types.ObjectId.isValid(rawSite.ownerId) 
                ? new mongoose.Types.ObjectId(rawSite.ownerId) 
                : null;

            const owner = ownerObjId ? await db.collection('users').findOne({ _id: ownerObjId }) : null;

            if (!owner) {
                console.log(`❌ User dengan _id ${rawSite.ownerId} TIDAK DITEMUKAN di koleksi "users"`);
                console.log('   → MASALAH: Akun Owner sudah terhapus, site ini berstatus ORPHAN.\n');
            } else {
                console.log(`✅ Owner ditemukan: ${owner.username || 'NoName'} (${owner.email || 'NoEmail'})\n`);
            }
        }

        // --- Cek 4: Referensi balik untuk Site Spesifik (Dipindah ke atas agar mengelompok) ---
        console.log(`Cek relasi untuk site ${paramId}...`);
        const activityCount = await db.collection('activitylogs').countDocuments({ siteId: targetSiteObjId });
        const inviteCount = await db.collection('invites').countDocuments({ siteId: targetSiteObjId });
        const notifCount = await db.collection('notifications').countDocuments({ siteId: targetSiteObjId });

        console.log(`   - ActivityLog entries : ${activityCount}`);
        console.log(`   - Invite entries      : ${inviteCount}`);
        console.log(`   - Notification entries: ${notifCount}\n`);
    } else {
        console.log('⏩ Mode Cek Spesifik dilewati (Tidak ada ID yang diberikan di perintah terminal).\n');
    }

    // =========================================================
    // BLOK B: PEMINDAIAN MASSAL (Selalu berjalan)
    // =========================================================
    console.log('='.repeat(60));
    console.log('🌍 PEMINDAIAN MASSAL: Mendeteksi semua Orphan Site di basis data');
    console.log('='.repeat(60));

    const allSites = await db.collection('sites').find({}).toArray();
    console.log(`Total data di koleksi "sites": ${allSites.length}\n`);

    let orphanCount = 0;
    const orphanSitesList = []; // Simpan list orphan untuk keperluan cleanup

    for (const site of allSites) {
        let isOrphan = false;

        // Kondisi 1: Field ownerId kosong/null
        if (!site.ownerId) {
            console.log(`⚠️  Site "${site.name}" (${site._id}) — Field ownerId KOSONG/NULL`);
            isOrphan = true;
        } else {
            // Kondisi 2: OwnerId ada, tapi usernya sudah hilang dari pangkalan data
            const ownerObjId = mongoose.Types.ObjectId.isValid(site.ownerId) 
                ? new mongoose.Types.ObjectId(site.ownerId) 
                : null;
            
            const owner = ownerObjId ? await db.collection('users').findOne({ _id: ownerObjId }) : null;
            
            if (!owner) {
                console.log(`⚠️  Site "${site.name}" (${site._id}) — Owner (${site.ownerId}) TIDAK ADA di koleksi users`);
                isOrphan = true;
            }
        }

        if (isOrphan) {
            orphanCount++;
            orphanSitesList.push(site);
        }
    }

    if (orphanCount === 0) {
        console.log('✅ Basis data bersih. Tidak ada orphan site yang ditemukan.\n');
    } else {
        console.log(`\n❌ Ditemukan total: ${orphanCount} Orphan Site.`);
        if (!isCleanup) {
            console.log('   → Untuk membersihkan data sampah tersebut, tambahkan bendera --cleanup:');
            console.log('   node diagnoseSite.js --cleanup\n');
        }
    }

    // =========================================================
    // BLOK C: CLEANUP (Hanya jika parameter --cleanup digunakan)
    // =========================================================
    if (isCleanup) {
        console.log('='.repeat(60));
        if (orphanSitesList.length > 0) {
            console.log('🧹 CLEANUP: Membasmi semua orphan site beserta relasinya...');
            console.log('='.repeat(60));

            for (const site of orphanSitesList) {
                const siteObjId = new mongoose.Types.ObjectId(site._id);
                
                // 1. Hapus referensi di Activity Logs
                const actRes = await db.collection('activitylogs').deleteMany({ siteId: siteObjId });
                // 2. Hapus referensi di Invites
                const invRes = await db.collection('invites').deleteMany({ siteId: siteObjId });
                // 3. Hapus referensi di Notifications
                const notifRes = await db.collection('notifications').deleteMany({ siteId: siteObjId });
                // 4. Terakhir, Hapus Site tersebut dari koleksi sites
                await db.collection('sites').deleteOne({ _id: siteObjId });

                console.log(`🗑️  TERHAPUS: "${site.name}" (${site._id})`);
                console.log(`    → Efek: ${actRes.deletedCount} log, ${invRes.deletedCount} invite, ${notifRes.deletedCount} notif dibersihkan.`);
            }
            console.log('\n✅ Cleanup Sempurna Selesai');
        } else {
            console.log('✅ Perintah --cleanup dibatalkan (Tidak ada data sampah yang perlu dibersihkan).');
            console.log('='.repeat(60));
        }
    }

    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
}

diagnose().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
