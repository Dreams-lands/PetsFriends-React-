const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const useWindowsAuth = (process.env.DB_AUTH || '').toLowerCase() === 'windows';

let sql;
if (useWindowsAuth) {
  try {
    sql = require('mssql/msnodesqlv8');
  } catch {
    console.warn('msnodesqlv8 chưa được cài đặt, chuyển sang dùng driver mssql mặc định.');
    sql = require('mssql');
  }
} else {
  sql = require('mssql');
}

const server = process.env.DB_SERVER || 'localhost';
const database = process.env.DB_NAME || 'QLThuCung';

async function createPool() {
  if (!useWindowsAuth) {
    const user = process.env.DB_USER || 'sa';
    const password = process.env.DB_PASSWORD || '';
    
    if (!process.env.DB_PASSWORD) {
      console.warn('CHÚ Ý: Chưa tìm thấy DB_PASSWORD trong file api/.env. Đang thử kết nối user sa...');
    }

    const sqlConfig = {
      user,
      password,
      server,
      database,
      port: parseInt(process.env.DB_PORT, 10) || 1433,
      options: {
        encrypt: false,
        trustServerCertificate: true,
      },
      connectionTimeout: 15000,
      requestTimeout: 15000,
    };
    const pool = await new sql.ConnectionPool(sqlConfig).connect();
    console.log(`Kết nối SQL Server (SQL Auth - user: ${user}) thành công!`);
    return pool;
  }

  const drivers = [
    process.env.DB_ODBC_DRIVER,
    'ODBC Driver 18 for SQL Server',
    'ODBC Driver 17 for SQL Server',
    'SQL Server',
  ].filter(Boolean);

  let lastErr;
  for (const driver of drivers) {
    const connectionString =
      driver === 'SQL Server'
        ? `Driver={${driver}};Server=${server};Database=${database};Trusted_Connection=Yes;`
        : `Driver={${driver}};Server=${server};Database=${database};Trusted_Connection=yes;TrustServerCertificate=yes;`;

    try {
      const pool = await new sql.ConnectionPool({ connectionString }).connect();
      console.log(`Kết nối SQL Server (Windows Auth - ${driver}) thành công!`);
      return pool;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      if (!msg.includes('IM002') && !msg.includes('Data source name not found')) {
        break;
      }
    }
  }

  console.error('Lỗi kết nối SQL Server:', lastErr?.message || lastErr);
  throw lastErr;
}

const poolPromise = createPool();
poolPromise.catch((err) => {
  console.error('Không thể kết nối SQL Server:', err?.message || err);
});

module.exports = { sql, poolPromise };