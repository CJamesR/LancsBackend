module.exports = (req, res, next) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({
      error: "JSON body kosong atau tidak terbaca."
    });
  }
  
  const { ServerID, Suhu, Kelembapan, Waktu } = req.body;

  // Validasi field wajib
  if (!ServerID || Suhu === undefined || Kelembapan === undefined || !Waktu) {
    return res.status(400).json({
      error: "Struktur JSON tidak valid. Harus berisi: ServerID, Suhu, Kelembapan, Waktu."
    });
  }

  // Validasi tipe data
  if (typeof ServerID !== "string") {
    return res.status(400).json({ error: "ServerID harus string" });
  }

  if (typeof Suhu !== "number") {
    return res.status(400).json({ error: "Suhu harus angka (number)" });
  }

  if (typeof Kelembapan !== "number") {
    return res.status(400).json({ error: "Kelembapan harus angka (number)" });
  }

  next(); // JSON valid → lanjut ke controller
};