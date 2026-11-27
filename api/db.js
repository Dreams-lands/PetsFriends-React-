const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const host = process.env.DB_HOST || process.env.DB_SERVER || 'localhost';
const port = parseInt(process.env.DB_PORT, 10) || 3306;
const database = process.env.DB_NAME || 'QLThuCung';
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';

async function createPool() {
  const pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    charset: 'utf8mb4',
    timezone: 'Z',
    decimalNumbers: true,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 15000,
  });

  if (typeof pool.on === 'function') {
    pool.on('connection', (connection) => {
      connection.query("SET time_zone = '+00:00', sql_safe_updates = 0");
    });
  }

  pool.close = () => pool.end();

  const conn = await pool.getConnection();
  try {
    await conn.query("SET time_zone = '+00:00', sql_safe_updates = 0");
    await conn.query('SELECT 1 AS ok');
    console.log(`Kết nối MySQL (${host}:${port}/${database} - user: ${user}) thành công!`);
  } finally {
    conn.release();
  }

  return pool;
}

const poolPromise = createPool();
poolPromise.catch((err) => {
  console.error('Không thể kết nối MySQL:', err?.message || err);
});

module.exports = { mysql, poolPromise };
