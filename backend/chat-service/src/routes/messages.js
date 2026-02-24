const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

// GET /conversations — list conversations for the current user
router.get('/conversations', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) return res.status(401).json({ error: 'Not authenticated' });

        const conversations = await Conversation.find({
            $or: [{ callerId: userId }, { hostId: userId }],
        })
            .sort({ lastMessageAt: -1 })
            .lean();

        res.json({ conversations });
    } catch (err) {
        console.error('List conversations error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /conversations — create or get existing conversation
router.post('/conversations', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) return res.status(401).json({ error: 'Not authenticated' });

        const { hostId } = req.body;
        if (!hostId) {
            return res.status(400).json({ error: 'hostId is required' });
        }

        // The logged-in user is the caller
        const callerId = userId;

        // Don't allow messaging yourself
        if (callerId === hostId) {
            return res.status(400).json({ error: 'Cannot message yourself' });
        }

        // Find existing or create new
        let conversation = await Conversation.findOne({ callerId, hostId });
        if (!conversation) {
            conversation = await Conversation.create({ callerId, hostId });
        }

        res.json({ conversation });
    } catch (err) {
        console.error('Create conversation error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /conversations/:id/messages — paginated message history
router.get('/conversations/:id/messages', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) return res.status(401).json({ error: 'Not authenticated' });

        const conversationId = req.params.id;
        const { page = 1, limit = 50 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Verify user is part of conversation
        const convo = await Conversation.findById(conversationId);
        if (!convo) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        if (convo.callerId !== userId && convo.hostId !== userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const [messages, total] = await Promise.all([
            Message.find({ conversationId })
                .sort({ serverTimestamp: 1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            Message.countDocuments({ conversationId }),
        ]);

        res.json({
            messages,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (err) {
        console.error('Get messages error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
