const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

// GET /wallet — get current user's wallet
router.get('/', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) return res.status(401).json({ error: 'Not authenticated' });

        // Auto-create wallet if not exists
        let result = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
        if (result.rows.length === 0) {
            result = await pool.query(
                'INSERT INTO wallets (user_id) VALUES ($1) RETURNING *',
                [userId]
            );
        }

        res.json({ wallet: result.rows[0] });
    } catch (err) {
        console.error('Get wallet error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /wallet/purchase — buy credits
router.post('/purchase', async (req, res) => {
    const client = await pool.connect();
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) return res.status(401).json({ error: 'Not authenticated' });

        const { amount } = req.body;
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Valid amount required' });
        }

        await client.query('BEGIN');

        // Get or create wallet
        let walletRes = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
        if (walletRes.rows.length === 0) {
            walletRes = await client.query(
                'INSERT INTO wallets (user_id) VALUES ($1) RETURNING *',
                [userId]
            );
        }
        const wallet = walletRes.rows[0];

        const newBalance = parseFloat(wallet.balance) + parseFloat(amount);

        // Update wallet balance
        await client.query(
            'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2',
            [newBalance, wallet.id]
        );

        // Record transaction
        await client.query(
            `INSERT INTO transactions (wallet_id, user_id, type, amount, description, balance_after)
             VALUES ($1, $2, 'PURCHASE', $3, $4, $5)`,
            [wallet.id, userId, amount, `Purchased ${amount} credits`, newBalance]
        );

        await client.query('COMMIT');

        res.json({
            message: 'Credits purchased',
            balance: newBalance,
            purchased: parseFloat(amount),
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Purchase error:', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// GET /wallet/transactions — transaction history
router.get('/transactions', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) return res.status(401).json({ error: 'Not authenticated' });

        const { page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        const result = await pool.query(
            'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
            [userId, parseInt(limit), offset]
        );
        const countRes = await pool.query(
            'SELECT COUNT(*) FROM transactions WHERE user_id = $1',
            [userId]
        );

        res.json({
            transactions: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: parseInt(countRes.rows[0].count),
            },
        });
    } catch (err) {
        console.error('Transactions error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /wallet/deduct-message — called by Chat Service to bill per message
router.post('/deduct-message', async (req, res) => {
    const client = await pool.connect();
    try {
        const { callerId, hostId } = req.body;
        if (!callerId || !hostId) {
            return res.status(400).json({ error: 'callerId and hostId required' });
        }

        const MESSAGE_COST = 1.00; // credits per message
        const PLATFORM_CUT = 0.20; // 20% platform fee
        const hostEarning = MESSAGE_COST * (1 - PLATFORM_CUT);

        await client.query('BEGIN');

        // Get caller wallet
        let callerWallet = await client.query(
            'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [callerId]
        );
        if (callerWallet.rows.length === 0) {
            callerWallet = await client.query(
                'INSERT INTO wallets (user_id) VALUES ($1) RETURNING *', [callerId]
            );
        }
        const caller = callerWallet.rows[0];

        if (parseFloat(caller.balance) < MESSAGE_COST) {
            await client.query('ROLLBACK');
            return res.status(402).json({ error: 'Insufficient balance' });
        }

        const callerNewBalance = parseFloat(caller.balance) - MESSAGE_COST;

        // Deduct from caller
        await client.query(
            'UPDATE wallets SET balance = $1, total_spent = total_spent + $2, updated_at = NOW() WHERE id = $3',
            [callerNewBalance, MESSAGE_COST, caller.id]
        );
        await client.query(
            `INSERT INTO transactions (wallet_id, user_id, type, amount, description, balance_after)
             VALUES ($1, $2, 'MESSAGE_SENT', $3, 'Message sent', $4)`,
            [caller.id, callerId, -MESSAGE_COST, callerNewBalance]
        );

        // Credit host
        let hostWallet = await client.query(
            'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [hostId]
        );
        if (hostWallet.rows.length === 0) {
            hostWallet = await client.query(
                'INSERT INTO wallets (user_id) VALUES ($1) RETURNING *', [hostId]
            );
        }
        const host = hostWallet.rows[0];
        const hostNewBalance = parseFloat(host.balance) + hostEarning;

        await client.query(
            'UPDATE wallets SET balance = $1, total_earned = total_earned + $2, updated_at = NOW() WHERE id = $3',
            [hostNewBalance, hostEarning, host.id]
        );
        await client.query(
            `INSERT INTO transactions (wallet_id, user_id, type, amount, description, balance_after)
             VALUES ($1, $2, 'MESSAGE_RECEIVED', $3, 'Message received', $4)`,
            [host.id, hostId, hostEarning, hostNewBalance]
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            callerBalance: callerNewBalance,
            cost: MESSAGE_COST,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Deduct message error:', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
