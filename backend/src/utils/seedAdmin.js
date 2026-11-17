require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sql, poolPromise } = require('../config/db');

const ACCOUNTS = [
  { name: 'Admin', email: 'admin@petsfriends.com', password: 'Admin@123', role: 'admin' },
  { name: 'Trịnh Anh Khoa', email: 'admin@pethub.vn', password: 'Admin@123', role: 'admin' },
  { name: 'Linh Phạm', email: 'staff@pethub.vn', password: 'Staff@123', role: 'staff' },
];

(async () => {
  try {
    const pool = await poolPromise;
    for (const a of ACCOUNTS) {
      const hash = await bcrypt.hash(a.password, 10);
      await pool.request()
        .input('name', sql.NVarChar(100), a.name)
        .input('email', sql.NVarChar(150), a.email)
        .input('hash', sql.NVarChar(255), hash)
        .input('role', sql.NVarChar(20), a.role)
        .query(`
          IF EXISTS (SELECT 1 FROM Users WHERE Email = @email)
            UPDATE Users SET Name = @name, PasswordHash = @hash, Role = @role WHERE Email = @email
          ELSE
            INSERT INTO Users (Name, Email, PasswordHash, Role) VALUES (@name, @email, @hash, @role)
        `);
      console.log('OK:', a.role, a.email, '/', a.password);
    }
    process.exit(0);
  } catch (err) {
    console.error('Loi:', err.message);
    process.exit(1);
  }
})();