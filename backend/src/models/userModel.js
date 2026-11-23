const { sql, poolPromise } = require('../config/db');

const COLS = 'Id AS id, Name AS name, Email AS email, Role AS role, CreatedAt AS createdAt';
const OUT = 'INSERTED.Id AS id, INSERTED.Name AS name, INSERTED.Email AS email, INSERTED.Role AS role, INSERTED.CreatedAt AS createdAt';

exports.findAll = async () => {
  const pool = await poolPromise;
  const r = await pool.request().query(`SELECT ${COLS} FROM Users ORDER BY Id DESC`);
  return r.recordset;
};

exports.findById = async (id) => {
  const pool = await poolPromise;
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query(`SELECT ${COLS} FROM Users WHERE Id = @id`);
  return r.recordset[0] || null;
};

exports.findByEmailWithPassword = async (email) => {
  const pool = await poolPromise;
  const r = await pool.request()
    .input('email', sql.NVarChar(150), email)
    .query('SELECT Id AS id, Name AS name, Email AS email, Role AS role, PasswordHash AS passwordHash FROM Users WHERE Email = @email');
  return r.recordset[0] || null;
};

exports.create = async ({ name, email, passwordHash, role }) => {
  const pool = await poolPromise;
  const r = await pool.request()
    .input('name', sql.NVarChar(100), name)
    .input('email', sql.NVarChar(150), email)
    .input('passwordHash', sql.NVarChar(255), passwordHash)
    .input('role', sql.NVarChar(20), role)
    .query(`INSERT INTO Users (Name, Email, PasswordHash, Role)
            OUTPUT ${OUT}
            VALUES (@name, @email, @passwordHash, @role)`);
  return r.recordset[0];
};

exports.update = async (id, { name, email, role, passwordHash }) => {
  const pool = await poolPromise;
  const r = await pool.request()
    .input('id', sql.Int, id)
    .input('name', sql.NVarChar(100), name)
    .input('email', sql.NVarChar(150), email)
    .input('role', sql.NVarChar(20), role)
    .input('passwordHash', sql.NVarChar(255), passwordHash || null)
    .query(`UPDATE Users
            SET Name = @name, Email = @email, Role = @role,
                PasswordHash = COALESCE(@passwordHash, PasswordHash)
            OUTPUT ${OUT}
            WHERE Id = @id`);
  return r.recordset[0] || null;
};

exports.remove = async (id) => {
  const pool = await poolPromise;
  const r = await pool.request()
    .input('id', sql.Int, id)
    .query('DELETE FROM Users WHERE Id = @id');
  return r.rowsAffected[0] > 0;
};