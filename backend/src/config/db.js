const sql = require('mssql');
require('dotenv').config();

const config = {
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
};

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then((pool) => {
    console.log('Da ket noi SQL Server');
    return pool;
  })
  .catch((err) => {
    console.error('Loi ket noi SQL Server:', err.message);
    throw err;
  });

module.exports = { sql, poolPromise };