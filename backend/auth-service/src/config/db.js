const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.POSTGRES_USER || 'o8m_user',
    password: process.env.POSTGRES_PASSWORD || 'change_me',
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB || 'o8m_db',
});

// Test connection on startup
pool.query('SELECT NOW()', (err) => {
    if (err) {
        console.error('PostgreSQL connection error:', err.message);
    } else {
        console.log('PostgreSQL connected successfully');
    }
});

module.exports = pool;
