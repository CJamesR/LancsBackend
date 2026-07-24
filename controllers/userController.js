const User = require('../models/userModel');
const Invite = require('../models/inviteModel'); 
const Site = require('../models/siteModel');
const ActivityLog = require('../models/activityLogModel');
const Node = require('../models/nodeModel');
const Sensor = require('../models/sensorModel');
const Notification = require('../models/notificationModel');

// @desc    Get all users (admin only)
// @route   GET /api/users
// @access  Private/Admin
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password -refreshToken').lean();
    
    res.json({
      success: true,
      count: users.length,
      data: users
    });

  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting users',
      error: error.message
    });
  }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    const updates = req.body;
    const userId = req.user.userId;

    // Remove restricted fields
    delete updates.password;
    delete updates.role;
    delete updates.isActive;
    delete updates.subscription;

    const user = await User.findByIdAndUpdate(
      userId,
      updates,
      { new: true, runValidators:  true }
    ).select('-password -refreshToken');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: user
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile',
      error: error.message
    });
  }
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password -refreshToken').lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: user
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting profile',
      error: error.message
    });
  }
};

// @desc    Change password
// @route   PUT /api/users/change-password
// @access  Private
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    const user = await User.findById(userId).select('+password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check current password
    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error changing password',
      error: error.message
    });
  }
};

// @desc    Melihat daftar undangan masuk (Pending Invites)
// @route   GET /api/user/invites
// @access  Private
exports.getPendingInvites = async (req, res) => {
    try {
        const userId = req.user.userId || req.user._id;
        const user = await User.findById(userId);
        
        if (!user) return res.status(404).json({ success: false, message: "User tidak ditemukan" });

        const invites = await Invite.find({ recipientEmail: user.email.toLowerCase(), status: 'pending' });
        
        res.json({ success: true, count: invites.length, data: invites });
    } catch (error) {
        console.error("Error Get Invites:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// @desc    Merespons undangan (Accept / Reject)
// @route   POST /api/user/invites/respond
// @access  Private
exports.respondToInvite = async (req, res) => {
    try {
        const { inviteId, action } = req.body; // action wajib berisi 'accept' atau 'reject'
        const userId = req.user.userId || req.user._id;

        if (!action || !['accept', 'reject'].includes(action.toLowerCase())) {
            return res.status(400).json({ success: false, message: "Action must be 'accept' or 'reject'" });
        }

        const invite = await Invite.findById(inviteId);
        if (!invite) return res.status(404).json({ success: false, message: 'Undangan tidak ditemukan' });

        if (action.toLowerCase() === 'accept') {
            const site = await Site.findById(invite.siteId);
            if (site) {
                // Validasi agar tidak terjadi duplikasi jika user sudah pernah masuk
                const isOwner = site.ownerId.toString() === userId.toString();
                const isAdmin = site.admins.some(a => a.userId.toString() === userId.toString());
                const isMember = site.members && site.members.some(m => m.userId.toString() === userId.toString());

                if (!isOwner && !isAdmin && !isMember) {
                    if (invite.role === 'admin') {
                        site.admins.push({ userId: userId, allowedDevices: [] });
                    } else {
                        if (!site.members) site.members = [];
                        site.members.push({ userId: userId, role: invite.role });
                    }
                    await site.save();

                    // Catat aktivitas bergabung
                    await ActivityLog.create({
                        userId: userId,
                        siteId: site._id,
                        action: `Joined the site as ${invite.role}`
                    });
                }
            }
        }

        // Hapus undangan setelah direspons (diterima maupun ditolak)
        await Invite.findByIdAndDelete(inviteId);
        res.json({ success: true, message: `Undangan berhasil di-${action}` });

    } catch (error) {
        console.error("Error Respond Invite:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// exports.deleteAccount = async (req, res) => {
//   try {
//     const userId = req.user._id;

//     const ownedSites = await Site.find({ ownerId: userId });

//     for (const site of ownedSites) {
//       const siteId = site._id;

//       await ActivityLog.deleteMany({ siteId: siteId });
//       await Invite.deleteMany ({ siteId: siteId});
//       await Notification.deleteMany({ siteId: siteId });

//       const nodes = await Node.find({ siteId: siteId });
//       for (const node of nodes) {
//         await Sensor.deleteMany({ nodeId: node._id });
//       }

//       await Node.deleteMany({ siteId: siteId });
//       await Site.deleteOne({ _id: siteId });
//     }
//     await Site.updateMany(
//       {members: userId},
//       {$pull: {members: userId}}
//     );
//     await User.findByIdAndDelete(userId);
//     return res.json({ success: true, message: 'Account and all data included successfully deleted' });
//   }
//   catch (error) {
//     console.error('Delete account error:', error);
//     return res.status(500).json({ success: false, message: 'Error deleting account', error: error.message });
//   }
// }