const express = require('express');
const router = express.Router();
const Profile = require('../models/Profile');

// GET /hosts — list available hosts with optional filters
// Query params: ?expertise=tech&minRate=0&maxRate=100&search=keyword&page=1&limit=20
router.get('/', async (req, res) => {
    try {
        const {
            expertise,
            minRate,
            maxRate,
            search,
            page = 1,
            limit = 20,
            sortBy = 'averageRating',
            sortOrder = 'desc',
        } = req.query;

        const filter = { role: 'HOST' };

        // Filter by expertise tag
        if (expertise) {
            filter.expertise = { $in: expertise.split(',').map(e => e.trim()) };
        }

        // Filter by rate range
        if (minRate || maxRate) {
            filter.ratePerMinute = {};
            if (minRate) filter.ratePerMinute.$gte = parseFloat(minRate);
            if (maxRate) filter.ratePerMinute.$lte = parseFloat(maxRate);
        }

        // Text search on displayName, bio, expertise
        if (search) {
            const regex = new RegExp(search, 'i');
            filter.$or = [
                { displayName: regex },
                { bio: regex },
                { expertise: regex },
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortField = ['averageRating', 'ratePerMinute', 'totalCalls', 'createdAt'].includes(sortBy)
            ? sortBy
            : 'averageRating';
        const sort = { [sortField]: sortOrder === 'asc' ? 1 : -1 };

        const [hosts, total] = await Promise.all([
            Profile.find(filter)
                .select('-__v')
                .sort(sort)
                .skip(skip)
                .limit(parseInt(limit)),
            Profile.countDocuments(filter),
        ]);

        res.json({
            hosts,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (err) {
        console.error('List hosts error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /hosts/:userId — get single host profile
router.get('/:userId', async (req, res) => {
    try {
        const host = await Profile.findOne({
            userId: req.params.userId,
            role: 'HOST',
        }).select('-__v');

        if (!host) {
            return res.status(404).json({ error: 'Host not found' });
        }

        res.json({ host });
    } catch (err) {
        console.error('Get host error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
