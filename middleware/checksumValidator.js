// middleware/checksumValidator.js
module.exports = (req, res, next) => {
  const { ServerID, Suhu, Kelembapan, Waktu, Checksum } = req.body;
  
  // Validate checksum exists
  if (!Checksum) {
    return res.status(400).json({
      error: "Missing checksum",
      message: "Data integrity check failed"
    });
  }
  // Di dalam checksumValidator.js
  const calculateChecksum = (id, suhu, kelembapan, waktu) => {
  // Gunakan .toFixed(2) agar sama dengan String(val, 2) di Arduino
    const data = id + Number(suhu).toFixed(2) + Number(kelembapan).toFixed(2) + waktu;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = (hash * 31 + data.charCodeAt(i)) % 65536;
  }
    return hash.toString(16).padStart(4, '0'); // Pastikan selalu 4 digit hex
  };
  
  const expectedChecksum = calculateChecksum(ServerID, Suhu, Kelembapan, Waktu);
  
  // Compare checksums
  if (Checksum.toLowerCase() !== expectedChecksum.toLowerCase()) {
    console.error('🚨 Checksum mismatch detected!');
    console.error('  Device:', ServerID);
    console.error('  Received checksum:', Checksum);
    console.error('  Expected checksum:', expectedChecksum);
    console.error('  Data:', { Suhu, Kelembapan, Waktu });
    
    return res.status(400).json({
      error: "Data integrity check failed",
      message: "Checksum mismatch. Data may be corrupted.",
      receivedChecksum: Checksum,
      expectedChecksum: expectedChecksum
    });
  }
  
  console.log(`✅ Checksum valid for ${ServerID}`);
  next();
};

// // Tunggu Kepastian dari Frits
// // middleware/checksumValidator.js
// const crypto = require('crypto');

// module.exports = (req, res, next) => {
//   const { ServerID, Suhu, Kelembapan, Waktu, Checksum } = req.body;
  
//   if (!Checksum || !Waktu) {
//     return res.status(400).json({ error: "Missing checksum or timestamp" });
//   }

//   // 🛡️ PERTAHANAN 1: REPLAY ATTACK (Validasi Timestamp)
//   const clientTime = new Date(Waktu).getTime();
//   const serverTime = Date.now();
//   const differenceInMinutes = Math.abs(serverTime - clientTime) / (1000 * 60);

//   // Jika paket data lebih tua/muda dari 5 menit, tolak! (Mencegah sinyal rekaman)
//   if (differenceInMinutes > 5) {
//       console.warn(`🚨 REPLAY ATTACK TERDETEKSI dari ${ServerID}! Selisih waktu: ${differenceInMinutes} menit.`);
//       return res.status(403).json({ message: "Akses Ditolak: Waktu kedaluwarsa (Kemungkinan Replay Attack)" });
//   }

//   // 🛡️ PERTAHANAN 2: DATA INJECTION (HMAC-SHA256)
//   // Format pesan mentah: "Node_1|35.50|60.20|2026-03-27T12:00:00.000Z"
//   const rawData = `${ServerID}|${Number(Suhu).toFixed(2)}|${Number(Kelembapan).toFixed(2)}|${Waktu}`;
  
//   // Buat validasi menggunakan kunci rahasia API_KEY dari .env
//   const secretKey = process.env.API_KEY || "KUNCI_RAHASIA_DEFAULT";
//   const expectedChecksum = crypto
//         .createHmac('sha256', secretKey)
//         .update(rawData)
//         .digest('hex');
  
//   // Bandingkan Checksum dari ESP dengan hitungan Server
//   if (Checksum.toLowerCase() !== expectedChecksum.toLowerCase()) {
//     console.error('🚨 MANIPULASI DATA TERDETEKSI (Data Injection)!');
//     return res.status(403).json({ message: "Akses Ditolak: Integritas data rusak." });
//   }

//   next(); 
// };