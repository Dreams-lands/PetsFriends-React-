require('dotenv').config();

const useWindowsAuth =
  (process.env.DB_AUTH || '').toLowerCase() === 'windows' ||
  !process.env.DB_USER;

const sql = useWindowsAuth
  ? require('mssql/msnodesqlv8')
  : require('mssql');

const server = process.env.DB_SERVER || 'localhost';
const database = process.env.DB_NAME || 'QLThuCung';

async function createPool() {
  if (!useWindowsAuth) {
    const sqlConfig = {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      server,
      database,
      port: parseInt(process.env.DB_PORT, 10) || 1433,
      options: {
        encrypt: false,
        trustServerCertificate: true,
      },
    };
    const pool = await new sql.ConnectionPool(sqlConfig).connect();
    console.log('Kết nối SQL Server (SQL Auth) thành công!');
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
poolPromise.catch(() => {});

module.exports = { sql, poolPromise };