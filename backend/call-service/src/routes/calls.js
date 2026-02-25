const express = require('express');
const router = express.Router();
const sessionManager = require('../services/sessionManager');

// GET /calls/active — check if user has an active call session (crash recovery)
router.get('/active', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) return res.status(401).json({ error: 'Not authenticated' });

        const session = await sessionManager.findActiveSessionForUser(userId);
        if (session) {
            res.json({ hasActiveSession: true, session });
        } else {
            res.json({ hasActiveSession: false });
        }
    } catch (err) {
        console.error('Check active session error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /calls/:sessionId — get session details
router.get('/:sessionId', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) return res.status(401).json({ error: 'Not authenticated' });

        const session = await sessionManager.getSession(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Only participants can view
        if (session.callerId !== userId && session.hostId !== userId) {
            return res.status(403).json({ error: 'Not a participant' });
        }

        res.json({ session });
    } catch (err) {
        console.error('Get session error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
