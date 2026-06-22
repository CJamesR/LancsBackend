const crypto = require('crypto');
const nodemailer = require('nodemailer');
const NodeCache = require('node-cache');

// 1. Buat brankas memori khusus OTP. 
// stdTTL: 300 berarti OTP akan otomatis hancur dalam 300 detik (5 menit).
const otpCache = new NodeCache({ stdTTL: 300 });

// 2. Konfigurasi Email Pengirim (Gunakan Gmail Anda)
// Ingat: Gunakan "App Password" (Sandi Aplikasi) Gmail, BUKAN password asli Anda!
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
       user: process.env.SMTP_EMAIL,
       pass: process.env.SMTP_PASS
    }
});

// ==========================================
// API 1: MINTA OTP (Kirim ke Email User)
// ==========================================
exports.requestOTP = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: "Email destination is required!" });
        }

        // Bikin 6 digit angka acak yang aman dari hacker
        const otpCode = crypto.randomInt(100000, 999999).toString();

        // Simpan ke RAM dengan kunci = email user
        otpCache.set(email, otpCode);

        // Kirim emailnya
        const mailOptions = {
            from: 'Sistem Keamanan IoT <' + process.env.SMTP_EMAIL + '>',
            to: email,
            subject: 'Kode OTP Konfirmasi Anda',
            html: `
                <h2>Kode OTP Anda: <b>${otpCode}</b></h2>
                <p>Kode ini berlaku selama 5 menit. Jangan berikan kepada siapa pun!</p>
            `
        };

        await transporter.sendMail(mailOptions);

        res.status(200).json({ 
            success: true, 
            message: "OTP successfully sent to your email. Valid for 5 minutes." 
        });

    } catch (error) {
        console.error("Failed to send email:", error);
        res.status(500).json({ success: false, message: "Failed to send OTP" });
    }
};

// ==========================================
// API 2: CEK OTP (Saat User Memasukkan Kode)
// ==========================================
exports.verifyOTP = async (req, res) => {
    try {
        const { email, otp } = req.body;

        // Cek apakah email ini punya OTP di RAM (dan belum hangus)
        if (!otpCache.has(email)) {
            return res.status(400).json({ 
                success: false, 
                message: "OTP has expired or you have not requested OTP. Please request a new one." 
            });
        }

        // Ambil OTP dari RAM dan cocokkan
        const savedOTP = otpCache.get(email);
        
        if (savedOTP === otp.toString()) {
            // BENAR! Hancurkan OTP agar tidak bisa dipakai 2x
            otpCache.del(email);
            
            return res.status(200).json({ 
                success: true, 
                message: "Verification Successful! Please continue the process." 
            });
        } else {
            // SALAH!
            return res.status(400).json({ 
                success: false, 
                message: "Invalid OTP!" 
            });
        }

    } catch (error) {
        res.status(500).json({ success: false, message: "An error occurred on the server" });
    }
};