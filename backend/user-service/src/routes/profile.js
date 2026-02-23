const express = require('express');
const router = express.Router();
const Profile = require('../models/Profile');

// POST /profile/ensure — create profile if it doesn't exist (fallback when Kafka is down)
router.post('/ensure', async (req, res) => {
    try {
        const { userId, email, role } = req.body;
        if (!userId || !email || !role) {
            return res.status(400).json({ error: 'userId, email, and role required' });
        }

        let profile = await Profile.findOne({ userId });
        if (!profile) {
            profile = await Profile.create({
                userId,
                email,
                role,
                displayName: email.split('@')[0],
            });
        }
        res.status(200).json({ profile });
    } catch (err) {
        console.error('Ensure profile error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /profile — get current user's profile
// Expects X-User-Id header from API Gateway
router.get('/', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const profile = await Profile.findOne({ userId });
        if (!profile) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        res.json({ profile });
    } catch (err) {
        console.error('Get profile error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /profile/:userId — get any user's public profile
router.get('/:userId', async (req, res) => {
    try {
        const profile = await Profile.findOne({ userId: req.params.userId });
        if (!profile) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        // Return public fields only
        res.json({
            profile: {
                userId: profile.userId,
                displayName: profile.displayName,
                bio: profile.bio,
                avatarUrl: profile.avatarUrl,
                role: profile.role,
                ratePerMinute: profile.ratePerMinute,
                expertise: profile.expertise,
                isAvailable: profile.isAvailable,
                totalCalls: profile.totalCalls,
                averageRating: profile.averageRating,
            },
        });
    } catch (err) {
        console.error('Get public profile error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /profile — update current user's profile
router.put('/', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const allowedFields = ['displayName', 'bio', 'avatarUrl', 'expertise', 'isAvailable'];
        const updates = {};

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        }

        const profile = await Profile.findOneAndUpdate(
            { userId },
            { $set: updates },
            { new: true, runValidators: true }
        );

        if (!profile) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        res.json({ message: 'Profile updated', profile });
    } catch (err) {
        console.error('Update profile error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /profile/rate — set host rate per minute
router.put('/rate', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { ratePerMinute } = req.body;
        if (ratePerMinute === undefined || ratePerMinute < 0) {
            return res.status(400).json({ error: 'Valid ratePerMinute required' });
        }

        const profile = await Profile.findOne({ userId });
        if (!profile) {
            return res.status(404).json({ error: 'Profile not found' });
        }
        if (profile.role !== 'HOST') {
            return res.status(403).json({ error: 'Only hosts can set rates' });
        }

        profile.ratePerMinute = ratePerMinute;
        await profile.save();

        res.json({ message: 'Rate updated', ratePerMinute: profile.ratePerMinute });
    } catch (err) {
        console.error('Set rate error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
