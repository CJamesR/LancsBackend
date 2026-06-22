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
        console.log(`❌ Site ${SITE_ID} ARE NOT inside "sites" collection`);
        console.log('   → Possibility: already erased but still being referenced to other place\n');
    } else {
        console.log(`✅ Site FOUND:`);
        console.log(JSON.stringify(rawSite, null, 2));
        console.log('');
    }

    // =========================================================
    // 2. Cek apakah ownerId dari site itu ada di koleksi users
    // =========================================================
    if (rawSite && rawSite.ownerId) {
        console.log('='.repeat(60));
        console.log('CEK 2: Check if the owner site still exist on "users"');
        console.log('='.repeat(60));

        const owner = await db.collection('users').findOne({ 
            _id: rawSite.ownerId 
        });

        if (!owner) {
            console.log(`❌ User dengan _id ${rawSite.ownerId} ARE NOT inside "users" collection`);
            console.log('   → THE PROBLEM: Owner already been erased, site is orphan\n');
        } else {
            console.log(`✅ Owner found: ${owner.username} (${owner.email})\n`);
        }
    }

    // =========================================================
    // 3. Scan semua site — temukan semua yang ownernya tidak ada
    // =========================================================
    console.log('='.repeat(60));
    console.log('CEK 3: Scan ALL site to detect any orphan');
    console.log('='.repeat(60));

    const allSites = await db.collection('sites').find({}).toArray();
    console.log(`Total site in DB: ${allSites.length}`);

    let orphanCount = 0;
    for (const site of allSites) {
        if (!site.ownerId) {
            console.log(`⚠️  Site "${site.name}" (${site._id}) — ownerId field EMPTY/NULL`);
            orphanCount++;
            continue;
        }

        const owner = await db.collection('users').findOne({ _id: site.ownerId });
        if (!owner) {
            console.log(`⚠️  Site "${site.name}" (${site._id}) — owner ${site.ownerId} ARE NOT inside users`);
            orphanCount++;
        }
    }

    if (orphanCount === 0) {
        console.log('✅ No orphan site were found\n');
    } else {
        console.log(`\n❌ Orphan site Total: ${orphanCount}`);
        console.log('   → Execute CLEANUP from below if wanted to be cleared:\n');
        console.log('   Opsi A — Delete orphan site from DB:');
        console.log('   node diagnoseSite.js --cleanup\n');
    }

    // =========================================================
    // 4. Cek referensi balik: apakah site ini ada di members array user lain
    // =========================================================
    console.log('='.repeat(60));
    console.log(`CEK 4: Are there any user who have reference to site ${SITE_ID}`);
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
        console.log('CLEANUP: Delete all orphan site...');
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

        console.log('\n✅ Cleanup Done');
    }

    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
}

diagnose().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});