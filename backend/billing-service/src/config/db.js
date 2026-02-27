const { Pool } = require('pg');

// Support DATABASE_URL (Render) or individual env vars (Docker)
const poolConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    }
    : {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT) || 5432,
        database: process.env.POSTGRES_DB || 'o8m_db',
        user: process.env.POSTGRES_USER || 'o8m_user',
        password: process.env.POSTGRES_PASSWORD || 'change_me',
    };

const pool = new Pool(poolConfig);

// Create billing tables
const initDB = async () => {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS wallets (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                user_id UUID UNIQUE NOT NULL,
                balance DECIMAL(12,2) DEFAULT 0.00,
                total_spent DECIMAL(12,2) DEFAULT 0.00,
                total_earned DECIMAL(12,2) DEFAULT 0.00,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                wallet_id UUID NOT NULL REFERENCES wallets(id),
                user_id UUID NOT NULL,
                type VARCHAR(20) NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                description TEXT,
                reference_id VARCHAR(255),
                balance_after DECIMAL(12,2) NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
            CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions(wallet_id);
            CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);

            CREATE TABLE IF NOT EXISTS pre_authorisations (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                user_id UUID NOT NULL,
                amount_locked DECIMAL(12,2) NOT NULL,
                status VARCHAR(20) DEFAULT 'LOCKED',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_pre_auth_user ON pre_authorisations(user_id);

            CREATE TABLE IF NOT EXISTS platform_ledger (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                event_id VARCHAR(255),
                session_id VARCHAR(255),
                amount DECIMAL(12,2) NOT NULL,
                type VARCHAR(30) NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_platform_ledger_session ON platform_ledger(session_id);
            CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference_id);
        `);
        console.log('Billing tables ready');
    } finally {
        client.release();
    }
};

module.exports = { pool, initDB };
