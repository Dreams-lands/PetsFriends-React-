require('dotenv').config();
const bcrypt = require('bcryptjs');
const { poolPromise } = require('../config/db');

const ACCOUNTS = [
  { name: 'Admin', email: 'admin@petsfriends.com', password: 'Admin@123', role: 'admin' },
  { name: 'Trịnh Anh Khoa', email: 'admin@pethub.vn', password: 'Admin@123', role: 'admin' },
  { name: 'Linh Phạm', email: 'staff@pethub.vn', password: 'Staff@123', role: 'staff' },
];

(async () => {
  try {
    const pool = await poolPromise;
    for (const a of ACCOUNTS) {
      // eslint-disable-next-line no-await-in-loop
      const hash = await bcrypt.hash(a.password, 10);
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `
          INSERT INTO Users (FullName, Email, PasswordHash, Role, Status)
          VALUES (?, ?, ?, ?, 'active')
          ON DUPLICATE KEY UPDATE
            FullName = VALUES(FullName),
            PasswordHash = VALUES(PasswordHash),
            Role = VALUES(Role)
        `,
        [a.name, a.email, hash, a.role]
      );
      console.log('OK:', a.role, a.email, '/', a.password);
    }
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Loi:', err.message);
    process.exit(1);
  }
})();
