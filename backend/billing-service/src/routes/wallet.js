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

module.exports = router;
