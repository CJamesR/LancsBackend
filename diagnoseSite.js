// diagnoseSite.js
// Jalankan: node diagnoseSite.js
// Letakkan di root folder project (sejajar server.js)

require('dotenv').config();
const mongoose = require('mongoose');

const SITE_ID = '6a31083efcf53755d90aaa92'; // ID dari warning

async function diagnose() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;

    // =========================================================
    // 1. Cek site langsung via raw collection (tanpa Mongoose model)
    // =========================================================
    console.log('='.repeat(60));
    console.log('CEK 1: Raw query ke koleksi "sites"');
    console.log('='.repeat(60));

    const rawSite = await db.collection('sites').findOne({ 
        _id: new mongoose.Types.ObjectId(SITE_ID) 
    });

    if (!rawSite) {
        console.log(`❌ Site ${SITE_ID} TIDAK ADA di koleksi "sites"`);
        console.log('   → Kemungkinan: sudah dihapus tapi masih direferensikan di tempat lain\n');
    } else {
        console.log(`✅ Site DITEMUKAN:`);
        console.log(JSON.stringify(rawSite, null, 2));
        console.log('');
    }

    // =========================================================
    // 2. Cek apakah ownerId dari site itu ada di koleksi users
    // =========================================================
    if (rawSite && rawSite.ownerId) {
        console.log('='.repeat(60));
        console.log('CEK 2: Cek apakah owner site masih ada di "users"');
        console.log('='.repeat(60));

        const owner = await db.collection('users').findOne({ 
            _id: rawSite.ownerId 
        });

        if (!owner) {
            console.log(`❌ User dengan _id ${rawSite.ownerId} TIDAK ADA di koleksi "users"`);
            console.log('   → INI PENYEBABNYA: Owner sudah dihapus, site jadi orphan\n');
        } else {
            console.log(`✅ Owner ditemukan: ${owner.username} (${owner.email})\n`);
        }
    }

    // =========================================================
    // 3. Scan semua site — temukan semua yang ownernya tidak ada
    // =========================================================
    console.log('='.repeat(60));
    console.log('CEK 3: Scan SEMUA site untuk temukan orphan');
    console.log('='.repeat(60));

    const allSites = await db.collection('sites').find({}).toArray();
    console.log(`Total site di DB: ${allSites.length}`);

    let orphanCount = 0;
    for (const site of allSites) {
        if (!site.ownerId) {
            console.log(`⚠️  Site "${site.name}" (${site._id}) — ownerId field KOSONG/NULL`);
            orphanCount++;
            continue;
        }

        const owner = await db.collection('users').findOne({ _id: site.ownerId });
        if (!owner) {
            console.log(`⚠️  Site "${site.name}" (${site._id}) — owner ${site.ownerId} TIDAK ADA di users`);
            orphanCount++;
        }
    }

    if (orphanCount === 0) {
        console.log('✅ Tidak ada orphan site ditemukan\n');
    } else {
        console.log(`\n❌ Total orphan site: ${orphanCount}`);
        console.log('   → Jalankan CLEANUP di bawah ini jika ingin hapus:\n');
        console.log('   Opsi A — Hapus site orphan dari DB:');
        console.log('   node diagnoseSite.js --cleanup\n');
    }

    // =========================================================
    // 4. Cek referensi balik: apakah site ini ada di members array user lain
    // =========================================================
    console.log('='.repeat(60));
    console.log(`CEK 4: Apakah ada user yang punya referensi ke site ${SITE_ID}`);
    console.log('='.repeat(60));

    // Site ID tidak disimpan di user model (relasi satu arah: site punya members)
    // Tapi cek apakah site ID ini ada di ActivityLog atau Invite
    const activityCount = await db.collection('activitylogs').countDocuments({ 
        siteId: new mongoose.Types.ObjectId(SITE_ID) 
    });
    const inviteCount = await db.collection('invites').countDocuments({ 
        siteId: new mongoose.Types.ObjectId(SITE_ID) 
    });
    const notifCount = await db.collection('notifications').countDocuments({ 
        siteId: new mongoose.Types.ObjectId(SITE_ID) 
    });

    console.log(`ActivityLog entries: ${activityCount}`);
    console.log(`Invite entries:      ${inviteCount}`);
    console.log(`Notification entries: ${notifCount}`);
    console.log('');

    // =========================================================
    // CLEANUP (hanya jalan kalau ada flag --cleanup)
    // =========================================================
    if (process.argv.includes('--cleanup')) {
        console.log('='.repeat(60));
        console.log('CLEANUP: Menghapus semua orphan site...');
        console.log('='.repeat(60));

        for (const site of allSites) {
            let isOrphan = false;

            if (!site.ownerId) {
                isOrphan = true;
            } else {
                const owner = await db.collection('users').findOne({ _id: site.ownerId });
                if (!owner) isOrphan = true;
            }

            if (isOrphan) {
                await db.collection('sites').deleteOne({ _id: site._id });
                console.log(`🗑️  Dihapus: "${site.name}" (${site._id})`);
            }
        }

        console.log('\n✅ Cleanup selesai');
    }

    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
}

diagnose().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});