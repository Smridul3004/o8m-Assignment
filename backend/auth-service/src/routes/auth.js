const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { publishEvent } = require('../config/kafka');

const router = express.Router();

// Validation rules
const registerValidation = [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').isIn(['CALLER', 'HOST']).withMessage('Role must be CALLER or HOST'),
];

const loginValidation = [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
];

// Helper: Generate tokens
function generateAccessToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' }
    );
}

function generateRefreshToken() {
    return uuidv4();
}

// ========================================
// POST /register
// ========================================
router.post('/register', registerValidation, async (req, res) => {
    // Check validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { email, password, role } = req.body;

    try {
        // Check if email already exists
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Insert user
        const result = await pool.query(
            'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role, created_at',
            [email, passwordHash, role]
        );
        const user = result.rows[0];

        // Generate tokens
        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken();
        const deviceId = req.body.device_id || 'default';

        // Store refresh token (hashed)
        const refreshHash = await bcrypt.hash(refreshToken, 10);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        await pool.query(
            'INSERT INTO refresh_tokens (user_id, token_hash, device_id, expires_at) VALUES ($1, $2, $3, $4)',
            [user.id, refreshHash, deviceId, expiresAt]
        );

        // Publish Kafka event for other services (User Service will create profile)
        await publishEvent('user.registered', {
            userId: user.id,
            email: user.email,
            role: user.role,
            createdAt: user.created_at,
        });

        res.status(201).json({
            message: 'Registration successful',
            user: { id: user.id, email: user.email, role: user.role },
            accessToken,
            refreshToken,
        });
    } catch (err) {
        console.error('Registration error:', err.message);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// ========================================
// POST /login
// ========================================
router.post('/login', loginValidation, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Valid email and password required' });
    }

    const { email, password } = req.body;
    const deviceId = req.body.device_id || 'default';

    try {
        // Find user
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        const user = result.rows[0];

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Generate tokens
        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken();

        // Store refresh token (replace existing for this device)
        const refreshHash = await bcrypt.hash(refreshToken, 10);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await pool.query(
            `INSERT INTO refresh_tokens (user_id, token_hash, device_id, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, device_id) 
       DO UPDATE SET token_hash = $2, expires_at = $4, created_at = NOW()`,
            [user.id, refreshHash, deviceId, expiresAt]
        );

        res.json({
            message: 'Login successful',
            user: { id: user.id, email: user.email, role: user.role },
            accessToken,
            refreshToken,
        });
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ========================================
// POST /refresh
// ========================================
router.post('/refresh', async (req, res) => {
    const { refreshToken, device_id: deviceId = 'default' } = req.body;

    if (!refreshToken || typeof refreshToken !== 'string') {
        return res.status(400).json({ error: 'Refresh token required (must be a string)' });
    }

    try {
        // Find all refresh tokens for this device
        const result = await pool.query(
            `SELECT rt.*, u.email, u.role 
       FROM refresh_tokens rt 
       JOIN users u ON rt.user_id = u.id 
       WHERE rt.device_id = $1 AND rt.expires_at > NOW()`,
            [deviceId]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid or expired refresh token' });
        }

        // Verify the token against stored hash
        let validRow = null;
        for (const row of result.rows) {
            const isValid = await bcrypt.compare(refreshToken, row.token_hash);
            if (isValid) {
                validRow = row;
                break;
            }
        }

        if (!validRow) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        // Rotate: generate new tokens
        const user = { id: validRow.user_id, email: validRow.email, role: validRow.role };
        const newAccessToken = generateAccessToken(user);
        const newRefreshToken = generateRefreshToken();

        // Replace old refresh token with new one
        const newHash = await bcrypt.hash(newRefreshToken, 10);
        const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await pool.query(
            'UPDATE refresh_tokens SET token_hash = $1, expires_at = $2, created_at = NOW() WHERE id = $3',
            [newHash, newExpiry, validRow.id]
        );

        res.json({
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
        });
    } catch (err) {
        console.error('Token refresh error:', err.message);
        res.status(500).json({ error: 'Token refresh failed' });
    }
});

// ========================================
// GET /me — requires JWT (handled by gateway)
// ========================================
router.get('/me', async (req, res) => {
    // User ID comes from the API Gateway via X-User-Id header
    const userId = req.headers['x-user-id'];
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const result = await pool.query(
            'SELECT id, email, role, created_at FROM users WHERE id = $1',
            [userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ user: result.rows[0] });
    } catch (err) {
        console.error('Get user error:', err.message);
        res.status(500).json({ error: 'Failed to get user' });
    }
});

module.exports = router;
