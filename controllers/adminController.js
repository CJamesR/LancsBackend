const User = require('../models/userModel');

// Get All Users (Admin only)
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({}, '-password -__v')
      .sort({ createdAt: -1 });
    
    res.json({
      total: users.length,
      users
    });

  } catch (error) {
    console.error('❌ Error get all users:', error.message);
    res.status(500).json({ 
      message: 'Terjadi kesalahan pada server',
      error: error.message 
    });
  }
};

// Get User by ID
exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id, '-password -__v');
    
    if (!user) {
      return res.status(404).json({ 
        message: 'Pengguna tidak ditemukan' 
      });
    }

    res.json({ user });

  } catch (error) {
    console.error('❌ Error get user by id:', error.message);
    res.status(500).json({ 
      message: 'Terjadi kesalahan pada server',
      error: error.message 
    });
  }
};

// Update User Role/Status (Admin only)
exports.updateUser = async (req, res) => {
  try {
    const { role, isActive, sensorAccess } = req.body;
    const userId = req.params.id;

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ 
        message: 'Pengguna tidak ditemukan' 
      });
    }

    // Update data jika ada
    if (role) user.role = role;
    if (isActive !== undefined) user.isActive = isActive;
    if (sensorAccess) user.sensorAccess = sensorAccess;
    
    await user.save();

    res.json({
      message: 'Data pengguna berhasil diperbarui',
      user: user.toJSON()
    });

  } catch (error) {
    console.error('❌ Error update user:', error.message);
    res.status(500).json({ 
      message: 'Terjadi kesalahan pada server',
      error: error.message 
    });
  }
};

// Delete User (Admin only)
exports.deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;

    // Cek jika menghapus diri sendiri
    if (userId === req.user.id) {
      return res.status(400).json({ 
        message: 'Tidak dapat menghapus akun sendiri' 
      });
    }

    const user = await User.findByIdAndDelete(userId);
    
    if (!user) {
      return res.status(404).json({ 
        message: 'Pengguna tidak ditemukan' 
      });
    }

    res.json({
      message: 'Pengguna berhasil dihapus'
    });

  } catch (error) {
    console.error('❌ Error delete user:', error.message);
    res.status(500).json({ 
      message: 'Terjadi kesalahan pada server',
      error: error.message 
    });
  }
};

// Add Sensor Access to User
exports.addSensorAccess = async (req, res) => {
  res.status(410).json({ 
    success: false,
    message: 'Sistem sensorAccess lama telah dimatikan. Gunakan fitur Invite Admin pada menu Site.' 
  });
};

// [DEPRECATED] Remove Sensor Access from User
exports.removeSensorAccess = async (req, res) => {
  res.status(410).json({ 
    success: false,
    message: 'Sistem sensorAccess lama telah dimatikan. Gunakan fitur Remove Admin pada menu Site.' 
  });
};