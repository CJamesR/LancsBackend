const crypto = require('crypto');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin'); 
const User = require('../models/userModel');
const Site = require('../models/siteModel');
const ActivityLog = require('../models/activityLogModel');
const PendingInvite = require('../models/pendingInviteModel');
const Invite = require('../models/inviteModel'); // 🔥 NEW: untuk user yang sudah punya akun

const formatWIB = (date) => {
    if (!date) return null;
    return new Date(date).toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' });
};

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const extractUserId = (req) => {
    const raw = req.user?._id ?? req.user?.userId ?? req.user?.id;
    if (!raw) throw new Error("User ID tidak ditemukan di token JWT.");
    return raw.toString();
};

// =========================================================================
// 1. GET MY SITES 
// =========================================================================
exports.getMySites = async (req, res) => {
    try {
        const userId = extractUserId(req);

        const sites = await Site.find({
            $or: [
                { ownerId: userId },
                { 'admins.userId': userId },
                { 'members.userId': userId }
            ]
        }).populate('ownerId', 'username email');

        const formattedSites = sites.map(site => {
            let role = 'member';
            let isOwner = site.ownerId._id.toString() === userId.toString();

            if (isOwner) {
                role = 'owner';
            } else if (site.admins.some(a => a.userId.toString() === userId.toString())) {
                role = 'admin';
            } else if (site.members && site.members.some(m => m.userId.toString() === userId.toString())) {
                const memberData = site.members.find(m => m.userId.toString() === userId.toString());
                role = memberData.role;
            }

            const responseData = {
                id: site._id,
                _id: site._id,
                name: site.name,
                location: site.location || "Unknown",
                role: role,
                ...(role !== 'owner' && { ownerUsername: site.ownerId.username }),
                deviceCount: site.devices.length,
                memberCount: (site.members?.length || 0) + site.admins.length + 1,
                createdAt: formatWIB(site.createdAt)
            };

            return responseData;
        });

        res.json({ success: true, count: formattedSites.length, data: formattedSites });
    } catch (error) {
        console.error("❌ Error Get My Sites:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// =========================================================================
// 2. INVITE USER — Menggunakan sistem Invite antrean (tidak langsung masuk Site)
// =========================================================================
exports.inviteUser = async (req, res) => {
    try {
        const { email, allowedDevices, permissions, role } = req.body;
        const { siteId } = req.params;
        const inviterId = extractUserId(req);

        const site = await Site.findById(siteId);
        if (!site) return res.status(404).json({ success: false, message: "Site tidak ditemukan." });

        const inviter = await User.findById(inviterId).select('username');

        const isOwner = site.ownerId.toString() === inviterId.toString();
        const isAdmin = site.admins.some(a => a.userId.toString() === inviterId.toString());

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ success: false, message: "Member tidak diizinkan menggunakan fitur ini." });
        }

        if (isAdmin && !isOwner && role === 'admin') {
            return res.status(403).json({ success: false, message: "Admins can only invite Members" });
        }

        const targetUser = await User.findOne({ email: email.toLowerCase() });

        if (targetUser) {
            // ============================================================
            // USER SUDAH PUNYA AKUN — Buat Invite antrean, kirim FCM/email
            // ============================================================
            if (targetUser._id.toString() === inviterId.toString()) {
                return res.status(400).json({ success: false, message: "Anda tidak bisa mengundang diri sendiri." });
            }

            const alreadyAdmin = site.admins.some(a => a.userId.toString() === targetUser._id.toString());
            const alreadyMember = site.members && site.members.some(m => m.userId.toString() === targetUser._id.toString());
            if (alreadyAdmin || alreadyMember || site.ownerId.toString() === targetUser._id.toString()) {
                return res.status(400).json({ success: false, message: "User sudah ada di dalam Site ini." });
            }

            // Cek apakah sudah ada invite pending ke user ini untuk site yang sama
            const existingInvite = await Invite.findOne({
                siteId: siteId,
                recipientEmail: email.toLowerCase(),
                status: 'pending'
            });
            if (existingInvite) {
                return res.status(400).json({ success: false, message: "Invite sudah terkirim dan sedang menunggu respons user." });
            }

            // Buat dokumen Invite (antrean)
            await Invite.create({
                siteId: siteId,
                siteName: site.name,
                inviterName: inviter ? inviter.username : 'Owner',
                recipientEmail: email.toLowerCase(),
                role: role || 'member',
                status: 'pending'
            });

            // Catat Aktivitas
            await ActivityLog.create({
                userId: inviterId,
                siteId: siteId,
                action: `Sent invite to ${targetUser.username} as ${role || 'member'}`
            });

            // 🔔 Kirim Push Notification FCM jika user punya fcmToken
            if (targetUser.fcmToken) {
                try {
                    await admin.messaging().send({
                        token: targetUser.fcmToken,
                        notification: {
                            title: "Undangan Site 📩",
                            body: `${inviter?.username || 'Someone'} mengundang Anda bergabung ke Site "${site.name}". Buka aplikasi untuk menerima atau menolak.`
                        },
                        data: {
                            type: "SITE_INVITE",
                            siteId: siteId.toString(),
                            siteName: site.name
                        }
                    });
                    console.log(`✅ Push notif berhasil dikirim ke ${targetUser.email}`);
                } catch (fcmErr) {
                    console.error("⚠️ Gagal kirim FCM:", fcmErr.message);
                }
            }

            // 📧 Kirim Email Notifikasi (fallback / tambahan)
            try {
                await transporter.sendMail({
                    from: `"Lancs IoT" <${process.env.EMAIL_USER}>`,
                    to: targetUser.email,
                    subject: `Undangan Bergabung ke Site ${site.name}`,
                    html: `
                        <div style="font-family: sans-serif; text-align: center; padding: 20px;">
                            <h2>Halo, ${targetUser.username}!</h2>
                            <p>Anda diundang bergabung ke Site <b>${site.name}</b> sebagai <b>${role || 'member'}</b> oleh <b>${inviter?.username || 'Owner'}</b>.</p>
                            <p>Buka aplikasi Lancs IoT untuk menerima atau menolak undangan ini.</p>
                        </div>
                    `
                });
            } catch (emailErr) {
                console.error("⚠️ Gagal kirim email notifikasi:", emailErr.message);
            }

            return res.status(200).json({ success: true, message: `Undangan berhasil dikirim ke ${targetUser.username}. Menunggu konfirmasi dari mereka.` });

        } else {
            // ============================================================
            // USER BELUM PUNYA AKUN — Kirim link pendaftaran (flow lama)
            // ============================================================
            const inviteToken = crypto.randomBytes(16).toString('hex');
            const inviteLink = `https://lancs-iot.app/register?token=${inviteToken}&email=${email}&siteId=${siteId}`;

            await PendingInvite.findOneAndUpdate(
                { email, siteId },
                { email, siteId, role: role || 'member', token: inviteToken, invitedBy: inviterId },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            await ActivityLog.create({
                userId: inviterId,
                siteId: siteId,
                action: `Sent pending invite to ${email}`
            });

            const mailOptions = {
                from: `"Lancs IoT" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: `Undangan Bergabung ke Site ${site.name}`,
                html: `<p>Klik link ini untuk mendaftar dan bergabung: <a href="${inviteLink}">Daftar & Bergabung</a></p>`
            };

            if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
                await transporter.sendMail(mailOptions);
                return res.status(200).json({ success: true, message: `Undangan pendaftaran telah dikirim ke ${email}` });
            } else {
                return res.status(500).json({ success: false, message: "Sistem email belum dikonfigurasi, undangan gagal." });
            }
        }
    } catch (error) {
        console.error("❌ Error Invite User:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// =========================================================================
// 3. GET SITE MEMBERS & HISTORY 
// =========================================================================
exports.getSiteMembers = async (req, res) => {
    try {
        const { siteId } = req.params;
        const userId = extractUserId(req);

        const site = await Site.findById(siteId)
            .populate('ownerId', 'username email lastOnline')
            .populate('admins.userId', 'username email lastOnline')
            .populate('members.userId', 'username email lastOnline'); 

        if (!site) return res.status(404).json({ success: false, message: "Site tidak ditemukan." });

        const isOwner = site.ownerId._id.toString() === userId;
        const isAdmin = site.admins.some(a => a.userId?._id?.toString() === userId);
        const isMember = site.members && site.members.some(m => m.userId?._id?.toString() === userId);

        if (!isOwner && !isAdmin && !isMember) {
            return res.status(403).json({ success: false, message: "Akses ditolak." });
        }

        const getActivitiesFormatted = async (targetUserId) => {
            const logs = await ActivityLog.find({ siteId: siteId, userId: targetUserId })
                .sort({ timestamp: -1 })
                .limit(10) 
                .select('action timestamp -_id'); 
            
            return logs.map(log => ({
                action: log.action,
                time: formatWIB(log.createdAt) 
            }));
        };

        const ownerActivities = await getActivitiesFormatted(site.ownerId._id);
        const ownerData = {
            id: site.ownerId._id,
            username: site.ownerId.username,
            email: site.ownerId.email,
            role: "owner",
            lastOnline: formatWIB(site.ownerId.lastOnline),
            activities: ownerActivities
        };

        const adminsData = await Promise.all(site.admins.map(async (a) => {
            if (!a.userId) return null; 
            const activities = await getActivitiesFormatted(a.userId._id);
            return {
                id: a.userId._id,
                username: a.userId.username,
                email: a.userId.email,
                role: "admin",
                lastOnline: formatWIB(a.userId.lastOnline),
                activities: activities
            };
        }));

        const membersData = await Promise.all((site.members || []).map(async (m) => {
            if (!m.userId) return null;
            const activities = await getActivitiesFormatted(m.userId._id);
            return {
                id: m.userId._id,
                username: m.userId.username,
                email: m.userId.email,
                role: m.role,
                lastOnline: formatWIB(m.userId.lastOnline),
                activities: activities
            };
        }));

        const allMembersMap = new Map();
        allMembersMap.set(ownerData.id.toString(), ownerData);
        
        adminsData.filter(Boolean).forEach(a => allMembersMap.set(a.id.toString(), a));
        membersData.filter(Boolean).forEach(m => {
            if (!allMembersMap.has(m.id.toString())) {
                allMembersMap.set(m.id.toString(), m);
            }
        });

        res.json({ 
            success: true, 
            siteName: site.name, 
            membersCount: allMembersMap.size,
            members: Array.from(allMembersMap.values()) 
        });

    } catch (error) {
        console.error("❌ Error Get Members:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// =========================================================================
// 4. REMOVE MEMBER FROM SITE (Owner & Admin bisa akses)
// =========================================================================
exports.removeMember = async (req, res) => {
    try {
        const { siteId, memberId } = req.params;
        const removerId = extractUserId(req);

        const site = await Site.findById(siteId);
        if (!site) return res.status(404).json({ success: false, message: "Site tidak ditemukan." });

        // Pastikan target bukan owner
        if (site.ownerId.toString() === memberId.toString()) {
            return res.status(400).json({ success: false, message: "Owner tidak dapat dikeluarkan dari Site." });
        }

        // Pastikan target bukan admin — endpoint ini hanya untuk hapus member
        const isTargetAdmin = site.admins.some(a => a.userId.toString() === memberId.toString());
        if (isTargetAdmin) {
            return res.status(403).json({
                success: false,
                message: "Gunakan endpoint /admins/:adminId untuk mengeluarkan Admin."
            });
        }

        const targetMemberIndex = (site.members || []).findIndex(
            m => m.userId.toString() === memberId.toString()
        );

        if (targetMemberIndex === -1) {
            return res.status(404).json({ success: false, message: "Member tidak ditemukan di Site ini." });
        }

        site.members.splice(targetMemberIndex, 1);
        await site.save();

        const targetUser = await User.findById(memberId).select('username');
        const targetName = targetUser ? targetUser.username : "Unknown User";

        await ActivityLog.create({
            userId: removerId,
            siteId: siteId,
            action: `Removed member ${targetName}`
        });

        res.json({ success: true, message: `${targetName} berhasil dikeluarkan dari Site.` });

    } catch (error) {
        console.error("❌ Error Remove Member:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// =========================================================================
// 5. REMOVE ADMIN FROM SITE (Owner saja yang bisa akses)
// =========================================================================
exports.removeAdmin = async (req, res) => {
    try {
        const { siteId, adminId } = req.params;
        const removerId = extractUserId(req);

        const site = await Site.findById(siteId);
        if (!site) return res.status(404).json({ success: false, message: "Site tidak ditemukan." });

        // Double-check: hanya owner yang boleh hapus admin
        if (site.ownerId.toString() !== removerId.toString()) {
            return res.status(403).json({
                success: false,
                message: "Hanya Owner yang dapat mengeluarkan Admin dari Site."
            });
        }

        // Pastikan target bukan owner itu sendiri
        if (site.ownerId.toString() === adminId.toString()) {
            return res.status(400).json({ success: false, message: "Owner tidak dapat dikeluarkan dari Site." });
        }

        const targetAdminIndex = site.admins.findIndex(
            a => a.userId.toString() === adminId.toString()
        );

        if (targetAdminIndex === -1) {
            return res.status(404).json({ success: false, message: "Admin tidak ditemukan di Site ini." });
        }

        site.admins.splice(targetAdminIndex, 1);
        await site.save();

        const targetUser = await User.findById(adminId).select('username');
        const targetName = targetUser ? targetUser.username : "Unknown User";

        await ActivityLog.create({
            userId: removerId,
            siteId: siteId,
            action: `Removed admin ${targetName}`
        });

        res.json({ success: true, message: `Admin ${targetName} berhasil dikeluarkan dari Site.` });

    } catch (error) {
        console.error("❌ Error Remove Admin:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};