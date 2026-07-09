// =========================================================================
// SCRIPT: dropSerialIdIndex.js
// Tujuan: Hapus index lama `serialId_1` dari koleksi `nodes` yang
//         tertinggal dari versi schema sebelumnya. Index ini menyebabkan
//         E11000 duplicate key error saat dua node masuk karena keduanya
//         punya serialId: null (field sudah tidak ada di schema baru).
//
// Cara pakai: node dropSerialIdIndex.js
// Jalankan SEKALI, setelah selesai file ini bisa dihapus.
// =========================================================================

require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected\n');

        const db = mongoose.connection.db;
        const collection = db.collection('nodes');

        // Tampilkan semua index yang ada sekarang
        const existingIndexes = await collection.indexes();
        console.log('📋 Index yang ada di koleksi `nodes` saat ini:');
        existingIndexes.forEach(idx => {
            console.log(`  - ${idx.name}:`, JSON.stringify(idx.key));
        });
        console.log('');

        // Cek apakah index serialId_1 memang ada
        const hasLegacyIndex = existingIndexes.some(idx => idx.name === 'serialId_1');

        if (!hasLegacyIndex) {
            console.log('ℹ️  Index `serialId_1` tidak ditemukan — mungkin sudah dihapus sebelumnya.');
            console.log('   Tidak ada yang perlu dilakukan.');
        } else {
            console.log('🗑️  Menghapus index `serialId_1`...');
            await collection.dropIndex('serialId_1');
            console.log('✅ Index `serialId_1` berhasil dihapus!\n');

            // Verifikasi — tampilkan index yang tersisa
            const remainingIndexes = await collection.indexes();
            console.log('📋 Index yang tersisa setelah penghapusan:');
            remainingIndexes.forEach(idx => {
                console.log(`  - ${idx.name}:`, JSON.stringify(idx.key));
            });
        }

    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Disconnected. Script selesai.');
    }
}

run();