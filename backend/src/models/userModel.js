const { poolPromise } = require('../config/db');

const COLS = 'UserId AS id, FullName AS name, Email AS email, Role AS role, CreatedAt AS createdAt';

exports.findAll = async () => {
  const pool = await poolPromise;
  const [rows] = await pool.query(`SELECT ${COLS} FROM Users ORDER BY UserId DESC`);
  return rows;
};

exports.findById = async (id) => {
  const pool = await poolPromise;
  const [rows] = await pool.query(`SELECT ${COLS} FROM Users WHERE UserId = ?`, [id]);
  return rows[0] || null;
};

exports.findByEmailWithPassword = async (email) => {
  const pool = await poolPromise;
  const [rows] = await pool.query(
    'SELECT UserId AS id, FullName AS name, Email AS email, Role AS role, PasswordHash AS passwordHash FROM Users WHERE Email = ?',
    [email]
  );
  return rows[0] || null;
};

exports.create = async ({ name, email, passwordHash, role }) => {
  const pool = await poolPromise;
  const [ins] = await pool.query(
    'INSERT INTO Users (FullName, Email, PasswordHash, Role) VALUES (?, ?, ?, ?)',
    [name, email, passwordHash, role || 'customer']
  );
  return exports.findById(ins.insertId);
};

exports.update = async (id, { name, email, role, passwordHash }) => {
  const pool = await poolPromise;
  const [upd] = await pool.query(
    `UPDATE Users
     SET FullName = ?, Email = ?, Role = ?,
         PasswordHash = COALESCE(?, PasswordHash)
     WHERE UserId = ?`,
    [name, email, role, passwordHash || null, id]
  );
  return upd.affectedRows > 0 ? exports.findById(id) : null;
};

exports.remove = async (id) => {
  const pool = await poolPromise;
  const [res] = await pool.query('DELETE FROM Users WHERE UserId = ?', [id]);
  return res.affectedRows > 0;
};
