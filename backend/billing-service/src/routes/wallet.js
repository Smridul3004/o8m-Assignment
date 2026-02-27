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

// GET /wallet/earnings — get host earnings summary and history
router.get('/earnings', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        if (!userId) return res.status(401).json({ error: 'Not authenticated' });

        const { page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Get total earnings
        let walletRes = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
        if (walletRes.rows.length === 0) {
            walletRes = await pool.query(
                'INSERT INTO wallets (user_id) VALUES ($1) RETURNING *',
                [userId]
            );
        }
        const wallet = walletRes.rows[0];

        // Get earning transactions
        const earnings = await pool.query(
            `SELECT * FROM transactions WHERE user_id = $1 AND type IN ('CALL_EARNING', 'MESSAGE_RECEIVED')
             ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
            [userId, parseInt(limit), offset]
        );
        const countRes = await pool.query(
            `SELECT COUNT(*) FROM transactions WHERE user_id = $1 AND type IN ('CALL_EARNING', 'MESSAGE_RECEIVED')`,
            [userId]
        );

        res.json({
            totalEarned: parseFloat(wallet.total_earned),
            currentBalance: parseFloat(wallet.balance),
            earnings: earnings.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: parseInt(countRes.rows[0].count),
            },
        });
    } catch (err) {
        console.error('Earnings error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /wallet/deduct-message — called by Chat Service to bill per message
router.post('/deduct-message', async (req, res) => {
    const client = await pool.connect();
    try {
        const { callerId, hostId, messageRate } = req.body;
        if (!callerId || !hostId) {
            return res.status(400).json({ error: 'callerId and hostId required' });
        }

        const MESSAGE_COST = parseFloat(messageRate) || 1.00; // configurable per-message rate
        const PLATFORM_CUT = parseFloat(process.env.PLATFORM_CUT_PERCENT || 30) / 100;
        const hostEarning = MESSAGE_COST * (1 - PLATFORM_CUT);
        const platformAmount = MESSAGE_COST * PLATFORM_CUT;

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

        // Platform ledger entry
        await client.query(
            `INSERT INTO platform_ledger (event_id, session_id, amount, type)
             VALUES ($1, $2, $3, 'MESSAGE')`,
            [`msg_${Date.now()}`, null, platformAmount]
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

// POST /wallet/pre-auth — lock credits before a call starts
router.post('/pre-auth', async (req, res) => {
    const client = await pool.connect();
    try {
        const { callerId, hostId, ratePerMinute } = req.body;
        if (!callerId || !ratePerMinute) {
            return res.status(400).json({ error: 'callerId and ratePerMinute required' });
        }

        const amountToLock = parseFloat(ratePerMinute); // Lock 1 minute minimum

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

        if (parseFloat(caller.balance) < amountToLock) {
            await client.query('ROLLBACK');
            return res.status(402).json({ error: 'Insufficient balance for call' });
        }

        // Deduct locked amount from available balance
        const newBalance = parseFloat(caller.balance) - amountToLock;
        await client.query(
            'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2',
            [newBalance, caller.id]
        );

        // Create pre-auth record
        const preAuth = await client.query(
            `INSERT INTO pre_authorisations (user_id, amount_locked, status)
             VALUES ($1, $2, 'LOCKED') RETURNING id`,
            [callerId, amountToLock]
        );

        await client.query('COMMIT');

        res.json({
            preAuthId: preAuth.rows[0].id,
            amountLocked: amountToLock,
            remainingBalance: newBalance,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Pre-auth error:', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// POST /wallet/deduct-minute — per-minute deduction during active call
router.post('/deduct-minute', async (req, res) => {
    const client = await pool.connect();
    try {
        const { sessionId, callerId, hostId, ratePerMinute, eventId } = req.body;
        if (!callerId || !hostId || !ratePerMinute) {
            return res.status(400).json({ error: 'callerId, hostId, ratePerMinute required' });
        }

        const rate = parseFloat(ratePerMinute);
        const PLATFORM_CUT = parseFloat(process.env.PLATFORM_CUT_PERCENT || 30) / 100;
        const hostEarning = rate * (1 - PLATFORM_CUT);

        await client.query('BEGIN');

        // Idempotency check
        if (eventId) {
            const existing = await client.query(
                'SELECT id FROM transactions WHERE reference_id = $1', [eventId]
            );
            if (existing.rows.length > 0) {
                await client.query('ROLLBACK');
                // Already processed — return success to avoid re-processing
                const wallet = await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [callerId]);
                return res.json({
                    success: true,
                    alreadyProcessed: true,
                    remainingBalance: parseFloat(wallet.rows[0]?.balance || 0),
                });
            }
        }

        // Get caller wallet
        const callerWallet = await client.query(
            'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [callerId]
        );
        if (callerWallet.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(402).json({ error: 'Insufficient balance' });
        }
        const caller = callerWallet.rows[0];

        if (parseFloat(caller.balance) < rate) {
            await client.query('ROLLBACK');
            return res.status(402).json({ error: 'Insufficient balance' });
        }

        const callerNewBalance = parseFloat(caller.balance) - rate;

        // Deduct from caller
        await client.query(
            'UPDATE wallets SET balance = $1, total_spent = total_spent + $2, updated_at = NOW() WHERE id = $3',
            [callerNewBalance, rate, caller.id]
        );
        await client.query(
            `INSERT INTO transactions (wallet_id, user_id, type, amount, description, reference_id, balance_after)
             VALUES ($1, $2, 'CALL_MINUTE', $3, $4, $5, $6)`,
            [caller.id, callerId, -rate, `Call minute - session ${sessionId}`, eventId, callerNewBalance]
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
            `INSERT INTO transactions (wallet_id, user_id, type, amount, description, reference_id, balance_after)
             VALUES ($1, $2, 'CALL_EARNING', $3, $4, $5, $6)`,
            [host.id, hostId, hostEarning, `Call earning - session ${sessionId}`, eventId, hostNewBalance]
        );

        // Platform ledger entry
        const platformAmount = rate - hostEarning;
        await client.query(
            `INSERT INTO platform_ledger (event_id, session_id, amount, type)
             VALUES ($1, $2, $3, 'CALL_MINUTE')`,
            [eventId, sessionId, platformAmount]
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            remainingBalance: callerNewBalance,
            amountDeducted: rate,
            hostEarning,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Deduct minute error:', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// POST /wallet/release-pre-auth — release unused locked credits
router.post('/release-pre-auth', async (req, res) => {
    const client = await pool.connect();
    try {
        const { preAuthId, callerId } = req.body;
        if (!preAuthId || !callerId) {
            return res.status(400).json({ error: 'preAuthId and callerId required' });
        }

        await client.query('BEGIN');

        // Get pre-auth record
        const preAuth = await client.query(
            'SELECT * FROM pre_authorisations WHERE id = $1 AND status = $2 FOR UPDATE',
            [preAuthId, 'LOCKED']
        );
        if (preAuth.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.json({ success: true, message: 'Already released or consumed' });
        }

        const amountLocked = parseFloat(preAuth.rows[0].amount_locked);

        // Release back to caller balance
        await client.query(
            'UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2',
            [amountLocked, callerId]
        );

        // Mark pre-auth as released
        await client.query(
            'UPDATE pre_authorisations SET status = $1, updated_at = NOW() WHERE id = $2',
            ['RELEASED', preAuthId]
        );

        await client.query('COMMIT');

        res.json({ success: true, amountReleased: amountLocked });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Release pre-auth error:', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
