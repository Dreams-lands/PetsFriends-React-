const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../../../api/db');

// Đăng nhập (Hỗ trợ cả Email hoặc Username, khớp với tài khoản mẫu trong DB)
router.post('/auth/login', async (req, res) => {
  const { email, username, password } = req.body;
  const identifier = email || username;

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Vui lòng nhập tài khoản và mật khẩu.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('identifier', sql.NVarChar(150), identifier)
      .input('password', sql.NVarChar(255), password)
      .query(`
        SELECT UserId, Username, FullName, Email, Phone, Role, CreatedAt
        FROM dbo.Users
        WHERE (Email = @identifier OR Username = @identifier)
          AND PasswordHash = @password
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu.' });
    }

    res.status(200).json({
      message: 'Đăng nhập thành công!',
      user: result.recordset[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Đăng ký tài khoản mới
router.post('/auth/register', async (req, res) => {
  const { username, fullName, email, phone, password } = req.body;

  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'Họ tên, email và mật khẩu là bắt buộc.' });
  }

  try {
    const pool = await poolPromise;
    const checkExist = await pool
      .request()
      .input('email', sql.NVarChar(150), email)
      .query('SELECT UserId FROM dbo.Users WHERE Email = @email');

    if (checkExist.recordset.length > 0) {
      return res.status(409).json({ error: 'Email này đã được sử dụng.' });
    }

    const result = await pool
      .request()
      .input('username', sql.NVarChar(50), username || null)
      .input('fullName', sql.NVarChar(120), fullName)
      .input('email', sql.NVarChar(150), email)
      .input('phone', sql.NVarChar(20), phone || null)
      .input('password', sql.NVarChar(255), password)
      .query(`
        INSERT INTO dbo.Users (Username, FullName, Email, Phone, PasswordHash, Role)
        OUTPUT INSERTED.UserId, INSERTED.Username, INSERTED.FullName, INSERTED.Email, INSERTED.Phone, INSERTED.Role
        VALUES (@username, @fullName, @email, @phone, @password, N'customer')
      `);

    res.status(201).json({
      message: 'Đăng ký thành công!',
      user: result.recordset[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lấy sổ địa chỉ của người dùng
router.get('/users/:userId/addresses', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('userId', sql.Int, req.params.userId)
      .query('SELECT * FROM dbo.UserAddresses WHERE UserId = @userId ORDER BY IsDefault DESC, AddressId DESC');
    res.status(200).json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Thêm địa chỉ mới
router.post('/users/:userId/addresses', async (req, res) => {
  const { label, recipientName, phone, fullAddress, isDefault } = req.body;
  const userId = req.params.userId;

  try {
    const pool = await poolPromise;
    if (isDefault) {
      await pool
        .request()
        .input('userId', sql.Int, userId)
        .query('UPDATE dbo.UserAddresses SET IsDefault = 0 WHERE UserId = @userId');
    }

    const result = await pool
      .request()
      .input('userId', sql.Int, userId)
      .input('label', sql.NVarChar(60), label)
      .input('recipientName', sql.NVarChar(120), recipientName)
      .input('phone', sql.NVarChar(20), phone)
      .input('fullAddress', sql.NVarChar(300), fullAddress)
      .input('isDefault', sql.Bit, isDefault ? 1 : 0)
      .query(`
        INSERT INTO dbo.UserAddresses (UserId, Label, RecipientName, Phone, FullAddress, IsDefault)
        OUTPUT INSERTED.*
        VALUES (@userId, @label, @recipientName, @phone, @fullAddress, @isDefault)
      `);

    res.status(201).json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;