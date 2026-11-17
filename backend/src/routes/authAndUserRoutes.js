const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../../../api/db');
const { mapUserRow, mapAddressRow } = require('../../../api/utils/mappers');

// 1. Đăng nhập (hỗ trợ Email, Username như admin/staff, hoặc SĐT)
router.post('/auth/login', async (req, res) => {
  const { identifier, email, username, phone, password } = req.body;
  const loginKey = String(identifier || email || username || phone || '').trim();

  if (!loginKey || !password) {
    return res.status(400).json({ message: 'Vui lòng nhập đầy đủ tài khoản và mật khẩu.' });
  }

  try {
    const pool = await poolPromise;
    const cleanDigits = loginKey.replace(/\D/g, '');
    const result = await pool
      .request()
      .input('loginKey', sql.NVarChar(150), loginKey)
      .input('cleanDigits', sql.NVarChar(30), cleanDigits || '__NONE__')
      .input('password', sql.NVarChar(255), password)
      .query(`
        SELECT UserId, Username, FullName, Email, Phone, Role, CreatedAt
        FROM dbo.Users
        WHERE (
          LOWER(Email) = LOWER(@loginKey)
          OR LOWER(Username) = LOWER(@loginKey)
          OR REPLACE(REPLACE(ISNULL(Phone, ''), ' ', ''), '.', '') = @cleanDigits
        )
        AND PasswordHash = @password
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({
        message: 'Tên đăng nhập / email hoặc mật khẩu không chính xác.',
      });
    }

    const user = mapUserRow(result.recordset[0]);
    const addrRes = await pool
      .request()
      .input('userId', sql.Int, user.userId)
      .query('SELECT * FROM dbo.UserAddresses WHERE UserId = @userId ORDER BY IsDefault DESC, AddressId DESC');

    res.status(200).json({
      message: 'Đăng nhập thành công!',
      user,
      addresses: addrRes.recordset.map(mapAddressRow),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 2. Đăng ký hội viên mới
router.post('/auth/register', async (req, res) => {
  const { username, fullName, name, email, phone, password, address } = req.body;
  const resolvedName = String(fullName || name || '').trim();
  const resolvedEmail = String(email || '').trim();

  if (!resolvedName || !resolvedEmail || !password) {
    return res.status(400).json({ message: 'Vui lòng nhập đầy đủ họ tên, email và mật khẩu.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ message: 'Mật khẩu phải có ít nhất 6 ký tự.' });
  }

  try {
    const pool = await poolPromise;
    const dupCheck = await pool
      .request()
      .input('email', sql.NVarChar(150), resolvedEmail)
      .query('SELECT UserId FROM dbo.Users WHERE LOWER(Email) = LOWER(@email)');

    if (dupCheck.recordset.length > 0) {
      return res.status(409).json({ message: 'Email này đã được đăng ký tài khoản.' });
    }

    const insertRes = await pool
      .request()
      .input('username', sql.NVarChar(50), username ? String(username).trim() : null)
      .input('fullName', sql.NVarChar(120), resolvedName)
      .input('email', sql.NVarChar(150), resolvedEmail)
      .input('phone', sql.NVarChar(20), phone ? String(phone).trim() : null)
      .input('password', sql.NVarChar(255), String(password))
      .query(`
        INSERT INTO dbo.Users (Username, FullName, Email, Phone, PasswordHash, Role)
        OUTPUT INSERTED.UserId, INSERTED.Username, INSERTED.FullName, INSERTED.Email, INSERTED.Phone, INSERTED.Role, INSERTED.CreatedAt
        VALUES (@username, @fullName, @email, @phone, @password, N'customer')
      `);

    const user = mapUserRow(insertRes.recordset[0]);

    if (address && String(address).trim()) {
      await pool
        .request()
        .input('userId', sql.Int, user.userId)
        .input('recipient', sql.NVarChar(120), resolvedName)
        .input('phone', sql.NVarChar(20), phone ? String(phone).trim() : '0900000000')
        .input('fullAddress', sql.NVarChar(300), String(address).trim())
        .query(`
          INSERT INTO dbo.UserAddresses (UserId, Label, RecipientName, Phone, FullAddress, IsDefault)
          VALUES (@userId, N'Nhà riêng', @recipient, @phone, @fullAddress, 1)
        `);
    }

    res.status(201).json({
      message: 'Đăng ký tài khoản thành công!',
      user,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 3. Tra cứu nhanh hội viên bằng SĐT tại quầy POS
router.get('/users/lookup-phone', async (req, res) => {
  const cleanPhone = String(req.query.phone || '').replace(/\D/g, '');
  if (!cleanPhone) {
    return res.status(400).json({ message: 'Vui lòng cung cấp số điện thoại.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('cleanPhone', sql.NVarChar(30), cleanPhone)
      .query(`
        SELECT TOP 1 UserId, Username, FullName, Email, Phone, Role, CreatedAt
        FROM dbo.Users
        WHERE REPLACE(REPLACE(ISNULL(Phone, ''), ' ', ''), '.', '') = @cleanPhone
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ found: false, message: 'Chưa có hội viên khớp SĐT này.' });
    }

    res.status(200).json({ found: true, user: mapUserRow(result.recordset[0]) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 4. Danh sách người dùng & quản trị Users
router.get('/users', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .query('SELECT UserId, Username, FullName, Email, Phone, Role, CreatedAt FROM dbo.Users ORDER BY UserId DESC');
    const mapped = result.recordset.map(mapUserRow);
    res.status(200).json({ data: mapped, users: mapped });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('id', sql.Int, Number(req.params.id))
      .query('SELECT UserId, Username, FullName, Email, Phone, Role, CreatedAt FROM dbo.Users WHERE UserId = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
    }
    res.status(200).json({ data: mapUserRow(result.recordset[0]) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 5. Cập nhật hồ sơ cá nhân (AccountPage -> Hồ sơ của tôi)
router.put('/users/:id/profile', async (req, res) => {
  const userId = Number(req.params.id);
  const { fullName, name, email, phone } = req.body;
  const resolvedName = String(fullName || name || '').trim();
  const resolvedEmail = String(email || '').trim();

  if (!resolvedName || !resolvedEmail) {
    return res.status(400).json({ message: 'Họ tên và email không được để trống.' });
  }

  try {
    const pool = await poolPromise;
    const dupCheck = await pool
      .request()
      .input('email', sql.NVarChar(150), resolvedEmail)
      .input('userId', sql.Int, userId)
      .query('SELECT UserId FROM dbo.Users WHERE LOWER(Email) = LOWER(@email) AND UserId <> @userId');

    if (dupCheck.recordset.length > 0) {
      return res.status(409).json({ message: 'Email này đã thuộc về tài khoản khác.' });
    }

    const result = await pool
      .request()
      .input('userId', sql.Int, userId)
      .input('fullName', sql.NVarChar(120), resolvedName)
      .input('email', sql.NVarChar(150), resolvedEmail)
      .input('phone', sql.NVarChar(20), phone ? String(phone).trim() : null)
      .query(`
        UPDATE dbo.Users
        SET FullName = @fullName, Email = @email, Phone = @phone
        OUTPUT INSERTED.UserId, INSERTED.Username, INSERTED.FullName, INSERTED.Email, INSERTED.Phone, INSERTED.Role, INSERTED.CreatedAt
        WHERE UserId = @userId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản.' });
    }
    res.status(200).json({
      message: 'Đã cập nhật hồ sơ thành công!',
      user: mapUserRow(result.recordset[0]),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 6. Đổi mật khẩu (AccountPage -> Đổi mật khẩu)
router.put('/users/:id/password', async (req, res) => {
  const userId = Number(req.params.id);
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword || String(newPassword).length < 6) {
    return res.status(400).json({
      message: 'Vui lòng nhập mật khẩu hiện tại và mật khẩu mới tối thiểu 6 ký tự.',
    });
  }

  try {
    const pool = await poolPromise;
    const userRes = await pool
      .request()
      .input('userId', sql.Int, userId)
      .query('SELECT PasswordHash FROM dbo.Users WHERE UserId = @userId');

    if (userRes.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản.' });
    }
    if (userRes.recordset[0].PasswordHash !== currentPassword) {
      return res.status(400).json({ message: 'Mật khẩu hiện tại không chính xác.' });
    }

    await pool
      .request()
      .input('userId', sql.Int, userId)
      .input('newPassword', sql.NVarChar(255), String(newPassword))
      .query('UPDATE dbo.Users SET PasswordHash = @newPassword WHERE UserId = @userId');

    res.status(200).json({ message: 'Đổi mật khẩu thành công!' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 7. Sổ địa chỉ nhận hàng của hội viên (CRUD + đặt mặc định)
router.get('/user-addresses', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM dbo.UserAddresses ORDER BY IsDefault DESC, AddressId DESC');
    res.status(200).json(result.recordset.map(mapAddressRow));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/users/:userId/addresses', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('userId', sql.Int, Number(req.params.userId))
      .query('SELECT * FROM dbo.UserAddresses WHERE UserId = @userId ORDER BY IsDefault DESC, AddressId DESC');
    res.status(200).json(result.recordset.map(mapAddressRow));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/users/:userId/addresses', async (req, res) => {
  const userId = Number(req.params.userId);
  const { label, recipient, recipientName, phone, address, fullAddress, isDefault } = req.body;
  const finalRecipient = String(recipient || recipientName || '').trim();
  const finalAddress = String(address || fullAddress || '').trim();
  const finalPhone = String(phone || '').trim();

  if (!finalRecipient || !finalPhone || !finalAddress) {
    return res.status(400).json({ message: 'Vui lòng điền người nhận, số điện thoại và địa chỉ.' });
  }

  try {
    const pool = await poolPromise;
    const countRes = await pool
      .request()
      .input('userId', sql.Int, userId)
      .query('SELECT COUNT(*) AS cnt FROM dbo.UserAddresses WHERE UserId = @userId');

    const shouldBeDefault = Boolean(isDefault) || countRes.recordset[0].cnt === 0;
    if (shouldBeDefault) {
      await pool
        .request()
        .input('userId', sql.Int, userId)
        .query('UPDATE dbo.UserAddresses SET IsDefault = 0 WHERE UserId = @userId');
    }

    const insertRes = await pool
      .request()
      .input('userId', sql.Int, userId)
      .input('label', sql.NVarChar(60), String(label || 'Nhà riêng').trim())
      .input('recipient', sql.NVarChar(120), finalRecipient)
      .input('phone', sql.NVarChar(20), finalPhone)
      .input('fullAddress', sql.NVarChar(300), finalAddress)
      .input('isDefault', sql.Bit, shouldBeDefault ? 1 : 0)
      .query(`
        INSERT INTO dbo.UserAddresses (UserId, Label, RecipientName, Phone, FullAddress, IsDefault)
        OUTPUT INSERTED.*
        VALUES (@userId, @label, @recipient, @phone, @fullAddress, @isDefault)
      `);

    res.status(201).json(mapAddressRow(insertRes.recordset[0]));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/users/:userId/addresses/:addressId', async (req, res) => {
  const userId = Number(req.params.userId);
  const addressId = Number(req.params.addressId);
  const { label, recipient, recipientName, phone, address, fullAddress, isDefault } = req.body;

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
      .input('addressId', sql.Int, addressId)
      .input('userId', sql.Int, userId)
      .input('label', sql.NVarChar(60), String(label || 'Nhà riêng').trim())
      .input('recipient', sql.NVarChar(120), String(recipient || recipientName || '').trim())
      .input('phone', sql.NVarChar(20), String(phone || '').trim())
      .input('fullAddress', sql.NVarChar(300), String(address || fullAddress || '').trim())
      .input('isDefault', sql.Bit, isDefault ? 1 : 0)
      .query(`
        UPDATE dbo.UserAddresses
        SET Label = @label, RecipientName = @recipient, Phone = @phone, FullAddress = @fullAddress, IsDefault = @isDefault
        OUTPUT INSERTED.*
        WHERE AddressId = @addressId AND UserId = @userId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy địa chỉ.' });
    }
    res.status(200).json(mapAddressRow(result.recordset[0]));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/users/:userId/addresses/:addressId/default', async (req, res) => {
  const userId = Number(req.params.userId);
  const addressId = Number(req.params.addressId);

  try {
    const pool = await poolPromise;
    await pool
      .request()
      .input('userId', sql.Int, userId)
      .query('UPDATE dbo.UserAddresses SET IsDefault = 0 WHERE UserId = @userId');

    const result = await pool
      .request()
      .input('addressId', sql.Int, addressId)
      .input('userId', sql.Int, userId)
      .query(`
        UPDATE dbo.UserAddresses
        SET IsDefault = 1
        OUTPUT INSERTED.*
        WHERE AddressId = @addressId AND UserId = @userId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy địa chỉ.' });
    }
    res.status(200).json(mapAddressRow(result.recordset[0]));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/users/:userId/addresses/:addressId', async (req, res) => {
  const userId = Number(req.params.userId);
  const addressId = Number(req.params.addressId);

  try {
    const pool = await poolPromise;
    await pool
      .request()
      .input('addressId', sql.Int, addressId)
      .input('userId', sql.Int, userId)
      .query('DELETE FROM dbo.UserAddresses WHERE AddressId = @addressId AND UserId = @userId');

    res.status(200).json({ message: 'Đã xóa địa chỉ nhận hàng.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;