const express = require('express');
const router = express.Router();
const PushToken = require('../models/PushToken');

// Register / update push token
router.post('/register', async (req, res) => {
    try {
        const { userId, token, platform } = req.body;
        if (!userId || !token) {
            return res.status(400).json({ error: 'userId and token are required' });
        }

        await PushToken.findOneAndUpdate(
            { userId, platform: platform || 'WEB' },
            { token, updatedAt: new Date() },
            { upsert: true, new: true }
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Token register error:', err.message);
        res.status(500).json({ error: 'Failed to register token' });
    }
});

// Remove push token (logout)
router.delete('/remove', async (req, res) => {
    try {
        const { userId, platform } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        await PushToken.deleteMany({ userId, ...(platform ? { platform } : {}) });
        res.json({ success: true });
    } catch (err) {
        console.error('Token remove error:', err.message);
        res.status(500).json({ error: 'Failed to remove token' });
    }
});

module.exports = router;
