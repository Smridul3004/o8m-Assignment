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

// GET /profile/public/:userId — get any user's public profile (explicit URL used by other services)
router.get('/public/:userId', async (req, res) => {
    try {
        const profile = await Profile.findOne({ userId: req.params.userId });
        if (!profile) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        res.json({
            profile: {
                userId: profile.userId,
                email: profile.email,
                displayName: profile.displayName,
                bio: profile.bio,
                avatarUrl: profile.avatarUrl,
                role: profile.role,
                ratePerMinute: profile.ratePerMinute,
                audioRate: profile.audioRate,
                videoRate: profile.videoRate,
                messageRate: profile.messageRate,
                expertise: profile.expertise,
                isAvailable: profile.isAvailable,
                availabilityStatus: profile.availabilityStatus,
                totalCalls: profile.totalCalls,
                averageRating: profile.averageRating,
            },
        });
    } catch (err) {
        console.error('Get public profile error:', err);
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
                email: profile.email,
                displayName: profile.displayName,
                bio: profile.bio,
                avatarUrl: profile.avatarUrl,
                role: profile.role,
                ratePerMinute: profile.ratePerMinute,
                audioRate: profile.audioRate,
                videoRate: profile.videoRate,
                messageRate: profile.messageRate,
                expertise: profile.expertise,
                isAvailable: profile.isAvailable,
                availabilityStatus: profile.availabilityStatus,
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

        const allowedFields = ['displayName', 'bio', 'avatarUrl', 'expertise', 'isAvailable', 'availabilityStatus'];
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

// PUT /profile/rate — set host rates (audio, video, message)
router.put('/rate', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { ratePerMinute, audioRate, videoRate, messageRate } = req.body;

        const profile = await Profile.findOne({ userId });
        if (!profile) {
            return res.status(404).json({ error: 'Profile not found' });
        }
        if (profile.role !== 'HOST') {
            return res.status(403).json({ error: 'Only hosts can set rates' });
        }

        // Support both legacy single rate and new separate rates
        if (audioRate !== undefined) {
            if (audioRate < 0) return res.status(400).json({ error: 'Audio rate must be non-negative' });
            profile.audioRate = audioRate;
            // Also update legacy field to audio rate for backwards compat
            profile.ratePerMinute = audioRate;
        }
        if (videoRate !== undefined) {
            if (videoRate < 0) return res.status(400).json({ error: 'Video rate must be non-negative' });
            if (profile.audioRate > 0 && videoRate <= profile.audioRate) {
                return res.status(400).json({ error: 'Video rate must be higher than audio rate' });
            }
            profile.videoRate = videoRate;
        }
        if (messageRate !== undefined) {
            if (messageRate < 0) return res.status(400).json({ error: 'Message rate must be non-negative' });
            profile.messageRate = messageRate;
        }
        // Legacy single rate support
        if (ratePerMinute !== undefined && audioRate === undefined) {
            if (ratePerMinute < 0) return res.status(400).json({ error: 'Rate must be non-negative' });
            profile.ratePerMinute = ratePerMinute;
            profile.audioRate = ratePerMinute;
            // Auto-set video rate to 1.5x if not set
            if (!profile.videoRate || profile.videoRate <= ratePerMinute) {
                profile.videoRate = ratePerMinute * 1.5;
            }
        }

        await profile.save();

        res.json({
            message: 'Rates updated',
            ratePerMinute: profile.ratePerMinute,
            audioRate: profile.audioRate,
            videoRate: profile.videoRate,
            messageRate: profile.messageRate,
        });
    } catch (err) {
        console.error('Set rate error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /profile/availability — set availability status
router.put('/availability', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { status } = req.body;
        const validStatuses = ['ONLINE', 'BUSY', 'OFFLINE', 'IN_CALL'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
        }

        const profile = await Profile.findOneAndUpdate(
            { userId },
            {
                $set: {
                    availabilityStatus: status,
                    isAvailable: status === 'ONLINE',
                },
            },
            { new: true }
        );

        if (!profile) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        res.json({ message: 'Availability updated', availabilityStatus: profile.availabilityStatus });
    } catch (err) {
        console.error('Set availability error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
