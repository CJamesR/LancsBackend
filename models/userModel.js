const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true,
  },
  realName:{
    type: String,
    default: ""
  },
  isVerified:{
    type: Boolean,
    default: false
  },
  password: {
    type: String,
    required: function () {
      return !this.googleId
    },
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['customer', 'admin'],
    default: 'customer'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationToken: String,
  verificationTokenExpires: {
    type: Date,
    expires: 0,
  },
  lastOnline:{
    type: Date,
    default: Date.now
  },
  fcmToken: {
    type: String,
    default: null
  },
  lastVerificationSentAt:{
    type: Date,
    default: null
  },
  subscription: {
    plan: { type: String, enum: ['free', 'basic', 'pro'], default: 'free' },
    maxGateways: { type: Number, default: 10 },
    isActive: { type: Boolean, default: true }
  },
  resetPasswordToken: {type: String, select: false},
  resetPasswordExpires: { type: Date},

  otpCode: { type: String, default: null },
  otpExpires: { type: Date, default: null },
  trustedDevices: [{
    deviceId: {type: String, default: null},
    addedAt: { type: Date, default: Date.now},
    expiresAt: { type: Date, required: true}
  }]
}, {
  timestamps: true
});

// Hash password sebelum save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method untuk compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw error;
  }
};

module.exports = mongoose.model('User', userSchema);