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
      message: 'An error occurred on the server',
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
        message: 'User not found' 
      });
    }

    res.json({ user });

  } catch (error) {
    console.error('❌ Error get user by id:', error.message);
    res.status(500).json({ 
      message: 'An error occurred on the server',
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
        message: 'User not found' 
      });
    }

    // Update data jika ada
    if (role) user.role = role;
    if (isActive !== undefined) user.isActive = isActive;
    if (sensorAccess) user.sensorAccess = sensorAccess;
    
    await user.save();

    res.json({
      message: 'User data updated successfully',
      user: user.toJSON()
    });

  } catch (error) {
    console.error('❌ Error update user:', error.message);
    res.status(500).json({ 
      message: 'An error occurred on the server',
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
        message: 'Cannot delete your own account' 
      });
    }

    const user = await User.findByIdAndDelete(userId);
    
    if (!user) {
      return res.status(404).json({ 
        message: 'User not found' 
      });
    }

    res.json({
      message: 'User deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error delete user:', error.message);
    res.status(500).json({ 
      message: 'An error occurred on the server',
      error: error.message 
    });
  }
};

// Add Sensor Access to User
exports.addSensorAccess = async (req, res) => {
  res.status(410).json({ 
    success: false,
    message: 'The old SensorAccess system has been disabled. Use the Invite Admin feature in the Site menu.' 
  });
};

// [DEPRECATED] Remove Sensor Access from User
exports.removeSensorAccess = async (req, res) => {
  res.status(410).json({ 
    success: false,
    message: 'The old SensorAccess system has been disabled. Use the Remove Admin feature in the Site menu.' 
  });
};