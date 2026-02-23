const pool = require('../config/db');

async function migrate() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Create users table
        await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(10) NOT NULL CHECK (role IN ('CALLER', 'HOST')),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

        // Create refresh_tokens table
        await client.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL,
        device_id VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, device_id)
      );
    `);

        // Index for faster lookups
        await client.query(`
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_device 
      ON refresh_tokens(user_id, device_id);
    `);

        await client.query('COMMIT');
        console.log('Migration completed: users and refresh_tokens tables created');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// Run migration if called directly
if (require.main === module) {
    migrate()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = migrate;
