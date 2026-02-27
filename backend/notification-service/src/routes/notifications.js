const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');

// Get notifications for a user (paginated)
router.get('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const [notifications, total] = await Promise.all([
            Notification.find({ recipientId: userId })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Notification.countDocuments({ recipientId: userId }),
        ]);

        const unreadCount = await Notification.countDocuments({ recipientId: userId, read: false });

        res.json({ notifications, total, unreadCount, page, limit });
    } catch (err) {
        console.error('Get notifications error:', err.message);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

// Mark notification as read
router.put('/:notificationId/read', async (req, res) => {
    try {
        const { notificationId } = req.params;
        await Notification.findByIdAndUpdate(notificationId, { read: true });
        res.json({ success: true });
    } catch (err) {
        console.error('Mark read error:', err.message);
        res.status(500).json({ error: 'Failed to mark notification as read' });
    }
});

// Mark all as read for a user
router.put('/read-all/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        await Notification.updateMany({ recipientId: userId, read: false }, { read: true });
        res.json({ success: true });
    } catch (err) {
        console.error('Mark all read error:', err.message);
        res.status(500).json({ error: 'Failed to mark all as read' });
    }
});

module.exports = router;
