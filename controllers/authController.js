const User = require('../models/userModel');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const nodemailer = require('nodemailer');
const dns = require('dns').promises;
const bcrypt = require('bcryptjs');

// 🔥 TAMBAHAN IMPORT UNTUK FITUR KLAIM UNDANGAN SITE
const PendingInvite = require('../models/pendingInviteModel');
const Site = require('../models/siteModel');
const ActivityLog = require('../models/activityLogModel');

const formatWIB = (date) => {
    if (!date) return null;
    return new Date(date).toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' });
};

// Generate JWT Token
const generateToken = (userId, role) => {
  return jwt.sign(
    { userId, role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth:{
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});


exports.register = async (req, res) => {
  try {
    console.log('📥 REGISTER Request:', req.body);

    const { email, password, username, realName } = req.body;

    // Validasi input
    if (!email || !password || !username) {
      console.log('❌ Missing fields');
      return res.status(400).json({
        message: 'Email, username, and password must be filled'
      });
    }

    // Check if user already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({
        message: 'Email have been used'
      });
    }

    // Check if username already exists
    const usernameExists = await User.findOne({ username });
    if (usernameExists) {
      return res.status(400).json({
        message: 'Username have been used'
      });
    }
    
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyTokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
    
    // Create user
    const user = await User.create({
      email,
      password,
      username,
      realName: realName || "-",
      role: 'customer',
      isActive: true,
      isVerified: false,
      verificationToken: verifyTokenHash,
      verificationTokenExpires: Date.now() + 10 * 60 * 1000 // Token valid for 15 minutes 
    });

    console.log('✅ User created:', user.email);
   
    // =====================================================================
    // 🔥 LOGIKA PENYAMBUNG: KLAIM UNDANGAN SITE OTOMATIS
    // =====================================================================
    const pendingInvites = await PendingInvite.find({ email: email.toLowerCase() });
    
    if (pendingInvites.length > 0) {
        for (const invite of pendingInvites) {
            const site = await Site.findById(invite.siteId);
            if (site) {
                if (invite.role === 'admin') {
                    site.admins.push({ userId: user._id, allowedDevices: [], permissions: {} });
                } else {
                    if (!site.members) site.members = [];
                    site.members.push({ userId: user._id, role: 'member' });
                }
                await site.save();

                await ActivityLog.create({
                    userId: invite.invitedBy,
                    siteId: site._id,
                    action: `User ${user.username} registered and automatically joined site via invitation`
                });
            }
        }
        await PendingInvite.deleteMany({ email: email.toLowerCase() });
    }
    // =====================================================================

    const domain = email.split('@')[1];
    try{
      const mxRecords = await dns.resolveMx(domain);
      if (!mxRecords || mxRecords.length === 0) {
        await User.findByIdAndDelete(user._id);
        return res.status(400).json({message: 'Email domain does not exist'});
      }
    } catch (error){
      await User.findByIdAndDelete(user._id);
      return res.status(400).json({message: 'Email domain does not exist'});
    }

    const verifyUrl = `${req.protocol}://${req.get('host')}/api/auth/verify-email/${verifyToken}`;

    const mailOptions = {
      from: '"Lancs IoT" <calvinriyono@gmail.com>',
      to: user.email,
      subject: 'Lancs IoT Account Verification',
      html: `
        <div style="font-family: sans-serif; text-align: center;">
          <h2>Welcome, ${user.username}!</h2>
          <p>Click the button below to activate your account:</p>
          <a href="${verifyUrl}" style="background-color: #4CAF50; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Account</a>
          <p style="margin-top: 20px; font-size: 12px; color: #888;">This link is valid for 24 hours.</p>
        </div>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log('📧 Verification email sent via Brevo to:', user.email);
      res.status(201).json({
        success: true,
        message: 'User has been created. Please check your email.'
      });
    } catch (emailError) {
      console.error('❌ Gagal kirim email Brevo:', emailError);
      await User.findByIdAndDelete(user._id); // Hapus user jika email gagal terkirim
      return res.status(500).json({ 
        success: false,
        message: 'Failed to send verification email. Registration cancelled.' 
      });
    }

  } catch (error) {
    console.error('🔥 REGISTER Error:', error);

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ message: `${field} is already in use` });
    }

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ message: messages[0] || 'Validation Failed' });
    }

    res.status(500).json({ message: 'Registration Error' });
  }
};

// @desc    Login user Manual
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  let user;
  try {
    console.log('🔐 LOGIN Request:', req.body);
    const { identifier, password } = req.body;

    // Validasi input
    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email/Username and password must be filled'
      });
    }

    // PERBAIKAN KRITIS: Gunakan .lean() untuk menghindari mongoose document overhead
    user = await User.findOne({ $or: [{ email: identifier }, { username: identifier }] })
      .select('+password username email role isActive isVerified ') // ✅ Explicit select
      .lean(); // ✅ Tambah .lean() untuk plain object

    if (!user) {
      console.log('❌ User not found with email/username:', identifier);
      return res.status(401).json({
        success: false,
        message: 'Email/Username or password is incorrect'
      });
    }
    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is not active'
      });
    }
    // Check password - kita perlu instance User untuk comparePassword
    const userInstance = await User.findById(user._id).select('+password');
    const isPasswordValid = await userInstance.comparePassword(password);

    if (!isPasswordValid) {
      console.log('❌ Invalid password for user:', identifier);
      return res.status(401).json({
        success: false,
        message: 'Email/Username or password is incorrect'
      });
    }
    if (!user.isVerified) {
      console.log('❌ Email not verified for user:', identifier);
      return res.status(401).json({
        success: false,
        message: 'Email has not been verified. Please check your email for verification.'
      });
    }

    const token = generateToken(user._id, user.role);
    const username = user.username || user.email.split('@')[0] || 'User';

    // Format response untuk Flutter
    const response = {
      success: true,
      token: token,
      user: {
        _id: user._id,
        email: user.email,
        username: username,
        role: user.role,
        isActive: user.isActive
      }
    };
    console.log('✅ Login successful for:', user.email);
    console.log('📤 Response:', JSON.stringify(response, null, 2));

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          lastLogin: new Date(),
          ...(!user.username && { username: username })
        }
      }
    ).catch(err => {
      console.warn('⚠️  Warning: Could not update lastLogin:', err.message);
    });

    res.json(response);

  } catch (error) {
    console.error('🔥 LOGIN Error:', error.message);
    console.error('🔥 Stack trace:', error.stack);

    // Berikan error yang lebih user-friendly
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Data user is not valid in the database'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error during login'
    });
  }
};

// @desc    Refresh token
// @route   POST /api/auth/refresh-token
// @access  Public
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) 
      return res.status(400).json({
        message: 'Refresh token is required'
      });
    
    // Find user by refresh token
    const user = await User.findOne({ refreshToken });
    if (!user) 
      return res.status(401).json({
        message: 'Refresh token is not valid'
      });

    // Check if user is active
    if (!user.isActive)
      return res.status(401).json({
        message: 'Account is not active'
      });
    
    // Generate new token
    const newToken = generateToken(user._id, user.role);
    res.json({token: newToken});

  } catch (error) {
    console.error('🔥 REFRESH TOKEN Error:', error);
    res.status(500).json({
      message: 'Error refreshing token'});
  }
};

// @desc    Get current user profile
// @route   GET /api/users/profile
// @access  Private
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId).select('-password -refreshToken -verificationToken');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    res.json ({
      success: true,
      data: {
        id: user._id,
        email: user.email,
        username: user.username,
        realName: user.realName,
        role: user.role,
        isVerified: user.isVerified,
        joinedAt: formatWIB(user.createdAt),
        isGoogleAccount: !!user.googleId
      }
    });
  } catch (error) {
    console.error('🔥 GET PROFILE Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user profile',
      error: error.message
    });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { realName, username } = req.body;

    const updates = {};
    if (realName) updates.realName = realName;
    if (username) updates.username = username;

    const user = await User.findByIdAndUpdate(
      userId,
      updates,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        username: user.username,
        realName: user.realName
      }
    });
  } catch (error) {
    console.error('🔥 UPDATE PROFILE Error:', error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Username has already been used, please choose another one'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error updating profile',
      error: error.message
    });
  }
};

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    // Check current password
    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      return res.status(401).json({
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('🔥 CHANGE PASSWORD Error:', error);
    res.status(500).json({
      message: 'Error changing password'
    });
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
exports.logout = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.userId, {
      refreshToken: null
    });

    res.json({
      message: 'Logout successful'
    });

  } catch (error) {
    console.error('🔥 LOGOUT Error:', error);
    res.status(500).json({
      message: 'Error occurred while logging out'
    });
  }
};

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({ message: 'Email is not registered in this Lancs IoT account.' });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
        
        user.resetPasswordToken = resetTokenHash;
        user.resetPasswordExpires = Date.now() + 15 * 60 * 1000; // Valid 15 menit
        await user.save();

        // Menggunakan format dinamis req.protocol dan req.get('host') persis seperti register
        const resetUrl = `lancsapp://reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`;

        const mailOptions = {
          from: '"Lancs IoT Security" <calvinriyono@gmail.com>',
          to: user.email,
          subject: 'Instruksi Reset Password - Lancs IoT',
          html: `
                <div style="font-family: sans-serif; text-align: center; border: 1px solid #eee; padding: 20px;">
                    <h2 style="color: #2196F3;">Reset Password Anda</h2>
                    <p>Seseorang telah meminta untuk mengatur ulang kata sandi akun Lancs IoT Anda.</p>
                    <p>Silakan klik tombol di bawah ini untuk memverifikasi permintaan reset password Anda:</p>
                    <a href="${resetUrl}" style="background-color: #2196F3; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0; font-weight: bold;">Verifikasi Reset Password</a>
                    <p style="font-size: 12px; color: #888;">Tautan ini berlaku selama 15 menit.</p>
                </div>
            `
        };
        
        try {
            await transporter.sendMail(mailOptions);
            res.status(200).json({ 
                success: true, 
                message: 'The reset password link has been sent to your email address. Please check your inbox.' 
            });
        } catch (emailError) {
            console.error("❌ Forgot Password Email Error (Brevo):", emailError);
            user.resetPasswordToken = undefined;
            user.resetPasswordExpires = undefined;
            await user.save({ validateBeforeSave: false });
            return res.status(500).json({ success: false, message: "A system error occurred while sending the email." });
        }

    } catch (error) {
        console.error("Forgot Password Error:", error);
        res.status(500).json({ success: false, message: "A system error occurred." });
    }
};

// =========================================================================
// RESET PASSWORD (URL Token Based)
// =========================================================================
exports.resetPassword = async (req, res) => {
    try {
        // Menerima token mentah dan email dari URL, serta password baru dari form
        const { email, token, newPassword } = req.body;

        if (!token || !newPassword || !email) {
            return res.status(400).json({ success: false, message: 'Incomplete data.' });
        }

        // 1. Lakukan hash pada token mentah yang diterima dari user
        const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const cleanEmail = email.trim().toLowerCase();

        // 2. Cari user berdasarkan email dan hash token, pastikan belum kedaluwarsa
        // Tambahkan .select('+resetPasswordToken') karena tadi kita set select: false di model
        const user = await User.findOne({
            email: cleanEmail,
            resetPasswordToken: resetTokenHash,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ 
                success: false, 
                message: 'The reset password link is invalid or has expired.'
            });
        }

        // 3. Update password (pre-save hook di userModel akan otomatis melakukan hashing pada password baru)
        user.password = newPassword;
        
        // 4. Bersihkan token dari database karena sudah selesai digunakan
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        res.status(200).json({ 
            success: true, 
            message: 'Password changed successfully. Please login with your new password.' 
        });

    } catch (error) {
        console.error("Password reset error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.googleSignIn = async (req, res) => {
  console.log('🔑 GOOGLE SIGNIN (Phase 1) - Body:', req.body);
  try {
    const { idToken } = req.body; 

    if (!idToken) {
      return res.status(400).json({ success: false, message: "Google token not found" });
    }

    const ticket = await client.verifyIdToken({
      idToken: idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const { email, name, sub: googleId } = ticket.getPayload();
    
    let user = await User.findOne({ email: email });

    if (user) {
      // 🟢 USER SUDAH ADA
      if (!user.googleId) {
        user.googleId = googleId;
        user.isVerified = true;
        await user.save();
      }

      const token = generateToken(user._id, user.role);

      return res.status(200).json({
        isNewUser: false,
        token: token,
        user: { 
          username: user.username,
          email: user.email
        }
      });
    } else {
      // 🟡 USER BARU (Kirim tempToken)
      const tempToken = jwt.sign(
        { email: email, googleId: googleId },
        process.env.JWT_SECRET,
        { expiresIn: '15m' } // Valid for 15 minutes
      );

      return res.status(200).json({
        isNewUser: true,
        tempToken: tempToken
      });
    }

  } catch (error) {
    console.error("❌ Error Google Sign-In:", error.message);
      res.status(401).json({ success: false, message: "Invalid Google token" });
  }
};

exports.completeGoogleProfile = async (req, res) => {
  console.log('🔑 GOOGLE COMPLETE PROFILE (Phase 2) - Body:', req.body);
  try {
    const { tempToken, realName, username } = req.body;

    if (!tempToken || !username) {
      return res.status(400).json({ message: "Data is incomplete" });
    }

    // Bongkar isi tempToken
    const decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
    const { email, googleId } = decoded;

    // Cek ketersediaan username
    const existingUsername = await User.findOne({ username: username });
    if (existingUsername) {
      return res.status(400).json({ message: "Username has already been used, please choose another one" });
    }

    // Buat User Baru
    const newUser = await User.create({
      email: email,
      googleId: googleId,
      username: username,
      realName: realName || "-", 
      role: 'customer',
      isActive: true,
      isVerified: true // Otomatis verified
    });

    console.log(`👤 Google user created successfully: ${newUser.username}`);

    // =====================================================================
    // 🔥 LOGIKA PENYAMBUNG: KLAIM UNDANGAN SITE OTOMATIS (GOOGLE SIGN-IN)
    // =====================================================================
    const pendingInvites = await PendingInvite.find({ email: email.toLowerCase() });
    
    if (pendingInvites.length > 0) {
        for (const invite of pendingInvites) {
            const site = await Site.findById(invite.siteId);
            if (site) {
                if (invite.role === 'admin') {
                    site.admins.push({ userId: newUser._id, allowedDevices: [], permissions: {} });
                } else {
                    if (!site.members) site.members = [];
                    site.members.push({ userId: newUser._id, role: 'member' });
                }
                await site.save();

                await ActivityLog.create({
                    userId: invite.invitedBy,
                    siteId: site._id,
                    action: `User ${newUser.username} registered (Google) and automatically joined site via invitation`
                });
            }
        }
        await PendingInvite.deleteMany({ email: email.toLowerCase() });
    }
    // =====================================================================

    const token = generateToken(newUser._id, newUser.role);

    res.status(201).json({
      isNewUser: false,
      token: token,
      user: { 
        username: newUser.username, 
        email: newUser.email,
        realName: newUser.realName || newUser.username
      }
    });

  } catch (error) {
    console.error("❌ Error Complete Profile:", error.message);
    if (error.name === 'TokenExpiredError' || error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: "Session has expired, please login to Google again" });
    }
    res.status(500).json({ message: "An error occurred on the server" });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const verifyTokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      verificationToken: verifyTokenHash,
      verificationTokenExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).send('<h2 style="color:red; text-align:center;">Verification Failed: Token is invalid or has expired.</h2>');
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    console.log('✅ Email verified:', user.email);
    res.status(200).send('<h2 style="color:green; text-align:center;">Verification Successful! Please log in to your Lancs IoT app.</h2>');
  } catch (error) {
    console.error('🔥 Error Verifikasi Email:', error);
    res.status(500).send('Error processing verification');
  }
};

exports.verifyResetToken = async (req, res) => {
  try {
    const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const user = await User.findOne({ 
      resetPasswordToken: tokenHash, 
      resetPasswordExpires: { $gt: Date.now() } 
    });

    if (!user) {
      return res.status(400).send('<h2 style="color:red; text-align:center;">Verifikasi Gagal: Tautan tidak valid atau telah kedaluwarsa.</h2>');
    }

    res.status(200).send(`
      <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
        <h2 style="color:green;">Verifikasi Reset Password Berhasil!</h2>
        <p>Silakan kembali ke aplikasi Lancs IoT Anda untuk memasukkan kata sandi baru.</p>
      </div>
    `);
  } catch (error) {
    console.error('🔥 Error Verify Reset Token:', error);
    res.status(500).send('Error processing verification');
  }
};