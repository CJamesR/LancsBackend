module.exports = (req, res, next) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ error: "JSON body is empty atau can't be read." });
  }
  
  const { gateID, Suhu, Kelembapan, Waktu } = req.body;

  // Validasi field wajib
  if (!gateID || Suhu === undefined || Kelembapan === undefined || !Waktu) {
    return res.status(400).json({
      error: "JSON Structure not valid. Must contain: gateID, Suhu, Kelembapan, Waktu."
    });
  }

  // Validasi tipe data
  if (typeof gateID !== "string") {
    return res.status(400).json({ error: "gateID must be a string" });
  }

  if (typeof Suhu !== "number") {
    return res.status(400).json({ error: "Suhu must be a number" });
  }

  if (typeof Kelembapan !== "number") {
    return res.status(400).json({ error: "Kelembapan must be a number" });
  }

  next(); 
};