const { poolPromise } = require('../../../api/db');
const { mapUserRow, mapAddressRow, normalizePhoneDigits } = require('../utils/mappers');
const {
  isBcryptHash,
  hashPassword,
  verifyPassword,
  signUserToken,
} = require('../utils/passwordAndJwt');

class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
  }
}

function sqlNormalizedPhoneExpr(col = 'Phone') {
  const cleaned = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(${col}, ''), '+84', '0'), ' ', ''), '.', ''), '-', ''), '(', ''), ')', '')`;
  return `(CASE WHEN LEFT(${cleaned}, 2) = '84' AND CHAR_LENGTH(${cleaned}) >= 11 THEN CONCAT('0', SUBSTRING(${cleaned}, 3, 30)) ELSE ${cleaned} END)`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function validateUserId(userId) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) {
    throw new AppError('Mã người dùng không hợp lệ.', 400);
  }
  return uid;
}

function validateAddressId(addressId) {
  const aid = Number(addressId);
  if (!Number.isInteger(aid) || aid <= 0) {
    throw new AppError('Mã địa chỉ không hợp lệ.', 400);
  }
  return aid;
}

function normalizeAdminRoleInput(rawRole, strict = false) {
  const r = String(rawRole || '').trim().toLowerCase();
  if (r === 'admin') return 'admin';
  if (r === 'staff' || r === 'editor') return 'staff';
  if (r === 'customer' || r === 'user') return 'customer';
  if (strict) {
    throw new AppError('Vai trò người dùng không hợp lệ.', 400);
  }
  return 'customer';
}

async function fetchUserAddressesAndWishlist(pool, userId) {
  const [[addrRows], [wishRows]] = await Promise.all([
    pool.query(
      'SELECT * FROM UserAddresses WHERE UserId = ? ORDER BY IsDefault DESC, AddressId DESC',
      [userId]
    ),
    pool.query(
      'SELECT ProductId FROM UserWishlists WHERE UserId = ? ORDER BY CreatedAt DESC',
      [userId]
    ),
  ]);

  return {
    addresses: addrRows.map(mapAddressRow),
    wishlist: wishRows.map((r) => r.ProductId),
  };
}

async function login(payload = {}) {
  const { identifier, email, username, phone, password } = payload || {};
  const loginKey = String(identifier || email || username || phone || '').trim();

  if (!loginKey || password === undefined || password === null || String(password) === '') {
    throw new AppError('Vui lòng nhập đầy đủ tài khoản và mật khẩu.', 400);
  }

  const pool = await poolPromise;
  const cleanDigits = normalizePhoneDigits(loginKey);

  const [rows] = await pool.query(
    `
      SELECT UserId, Username, FullName, Email, Phone, PasswordHash, Role, Gender, Status, CreatedAt
      FROM Users
      WHERE LOWER(Email) = LOWER(?)
         OR LOWER(Username) = LOWER(?)
         OR (? <> '' AND ${sqlNormalizedPhoneExpr('Phone')} = ?)
      ORDER BY CASE WHEN Role = 'admin' THEN 0 WHEN Role = 'staff' THEN 1 ELSE 2 END, UserId ASC
    `,
    [loginKey, loginKey, cleanDigits, cleanDigits]
  );

  const matchedRows = [];
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await verifyPassword(password, row.PasswordHash);
    if (ok) {
      matchedRows.push(row);
    }
  }

  if (matchedRows.length === 0) {
    throw new AppError('Tên đăng nhập / email hoặc mật khẩu không chính xác.', 401);
  }

  const matchedRow =
    matchedRows.find((r) => (r.Status || 'active') === 'active') || matchedRows[0];

  if (matchedRow.Status && matchedRow.Status !== 'active') {
    throw new AppError(
      'Tài khoản của bạn hiện đang bị khóa hoặc tạm ngưng hoạt động.',
      403
    );
  }

  if (!isBcryptHash(matchedRow.PasswordHash)) {
    const upgradedHash = await hashPassword(password);
    await pool.query('UPDATE Users SET PasswordHash = ? WHERE UserId = ?', [
      upgradedHash,
      matchedRow.UserId,
    ]);
  }

  const user = mapUserRow(matchedRow);
  const { addresses, wishlist } = await fetchUserAddressesAndWishlist(pool, user.userId);
  const token = signUserToken(user);

  return { user, token, addresses, wishlist };
}

async function register(payload = {}) {
  const { username, fullName, name, email, phone, password, gender, address } = payload || {};
  const resolvedName = String(fullName || name || '').trim();
  const resolvedEmail = String(email || '').trim();
  const resolvedUsername =
    username !== undefined && username !== null && String(username).trim() !== ''
      ? String(username).trim()
      : null;
  const rawPhone =
    phone !== undefined && phone !== null && String(phone).trim() !== ''
      ? String(phone).trim()
      : null;

  if (!resolvedName) {
    throw new AppError('Vui lòng nhập đầy đủ họ tên.', 400);
  }
  if (!resolvedEmail || !isValidEmail(resolvedEmail)) {
    throw new AppError('Địa chỉ email không hợp lệ.', 400);
  }
  if (!password || String(password).length < 6) {
    throw new AppError('Mật khẩu phải có ít nhất 6 ký tự.', 400);
  }

  let cleanPhone = '';
  let storedPhone = null;
  if (rawPhone) {
    cleanPhone = normalizePhoneDigits(rawPhone);
    if (cleanPhone.length < 9 || cleanPhone.length > 11) {
      throw new AppError('Số điện thoại không hợp lệ (cần từ 9 đến 11 chữ số).', 400);
    }
    storedPhone = rawPhone.length <= 20 ? rawPhone : cleanPhone;
  }

  const pool = await poolPromise;

  const [dupEmail] = await pool.query(
    'SELECT UserId FROM Users WHERE LOWER(Email) = LOWER(?)',
    [resolvedEmail]
  );
  if (dupEmail.length > 0) {
    throw new AppError('Email này đã được đăng ký tài khoản.', 409);
  }

  if (resolvedUsername) {
    const [dupUser] = await pool.query(
      'SELECT UserId FROM Users WHERE LOWER(Username) = LOWER(?)',
      [resolvedUsername]
    );
    if (dupUser.length > 0) {
      throw new AppError('Tên đăng nhập này đã được sử dụng.', 409);
    }
  }

  if (cleanPhone) {
    const [dupPhone] = await pool.query(
      `SELECT UserId FROM Users WHERE Role = 'customer' AND ${sqlNormalizedPhoneExpr('Phone')} = ?`,
      [cleanPhone]
    );
    if (dupPhone.length > 0) {
      throw new AppError('Số điện thoại này đã được đăng ký hội viên.', 409);
    }
  }

  const hashed = await hashPassword(password);
  const safeGender = ['Nam', 'Nữ', 'Khác'].includes(gender) ? gender : 'Nam';

  const [insertRes] = await pool.query(
    `
      INSERT INTO Users (Username, FullName, Email, Phone, PasswordHash, Role, Gender, Status)
      VALUES (?, ?, ?, ?, ?, 'customer', ?, 'active')
    `,
    [resolvedUsername, resolvedName, resolvedEmail, storedPhone, hashed, safeGender]
  );

  const [insertedUsers] = await pool.query('SELECT * FROM Users WHERE UserId = ?', [
    insertRes.insertId,
  ]);
  const user = mapUserRow(insertedUsers[0]);
  const addresses = [];

  if (address && String(address).trim()) {
    const [addrIns] = await pool.query(
      `
        INSERT INTO UserAddresses (UserId, Label, RecipientName, Phone, FullAddress, IsDefault)
        VALUES (?, ?, ?, ?, ?, 1)
      `,
      [
        user.userId,
        'Nhà riêng',
        resolvedName,
        storedPhone || '0900000000',
        String(address).trim(),
      ]
    );
    const [addrRows] = await pool.query(
      'SELECT * FROM UserAddresses WHERE AddressId = ?',
      [addrIns.insertId]
    );
    addresses.push(mapAddressRow(addrRows[0]));
  }

  const token = signUserToken(user);
  return { user, token, addresses };
}

async function getProfileMe(userId) {
  const uid = validateUserId(userId);
  const pool = await poolPromise;

  const [userRows] = await pool.query('SELECT * FROM Users WHERE UserId = ?', [uid]);

  if (userRows.length === 0) {
    throw new AppError('Không tìm thấy tài khoản người dùng.', 404);
  }

  const user = mapUserRow(userRows[0]);
  const { addresses, wishlist } = await fetchUserAddressesAndWishlist(pool, uid);
  return { user, addresses, wishlist };
}

async function lookupByPhone(phone) {
  const cleanPhone = normalizePhoneDigits(phone);
  if (!cleanPhone) {
    throw new AppError('Vui lòng cung cấp số điện thoại.', 400);
  }

  const pool = await poolPromise;
  const [rows] = await pool.query(
    `
      SELECT *
      FROM Users
      WHERE ${sqlNormalizedPhoneExpr('Phone')} = ?
      ORDER BY CASE WHEN Role = 'customer' THEN 0 ELSE 1 END, UserId DESC
      LIMIT 1
    `,
    [cleanPhone]
  );

  if (rows.length === 0) {
    throw new AppError('Chưa có hội viên khớp SĐT này.', 404);
  }

  return { found: true, user: mapUserRow(rows[0]) };
}

async function listUsers({ search, role, status } = {}) {
  const pool = await poolPromise;
  const clauses = ['1 = 1'];
  const params = [];

  if (role && String(role).trim() && String(role).trim().toLowerCase() !== 'all') {
    const normalizedRole = normalizeAdminRoleInput(role, false);
    clauses.push('Role = ?');
    params.push(normalizedRole);
  }

  if (status && String(status).trim() && String(status).trim().toLowerCase() !== 'all') {
    clauses.push("IFNULL(Status, 'active') = ?");
    params.push(String(status).trim().toLowerCase());
  }

  if (search && String(search).trim()) {
    const q = `%${String(search).trim()}%`;
    const cleanDigits = normalizePhoneDigits(search);
    if (cleanDigits) {
      clauses.push(
        `(FullName LIKE ? OR Email LIKE ? OR IFNULL(Phone, '') LIKE ? OR IFNULL(Username, '') LIKE ? OR ${sqlNormalizedPhoneExpr('Phone')} LIKE ?)`
      );
      params.push(q, q, q, q, `%${cleanDigits}%`);
    } else {
      clauses.push(
        `(FullName LIKE ? OR Email LIKE ? OR IFNULL(Phone, '') LIKE ? OR IFNULL(Username, '') LIKE ?)`
      );
      params.push(q, q, q, q);
    }
  }

  const [rows] = await pool.query(
    `
      SELECT *
      FROM Users
      WHERE ${clauses.join(' AND ')}
      ORDER BY UserId DESC
    `,
    params
  );

  return rows.map(mapUserRow);
}

async function getUserById(userId) {
  const uid = validateUserId(userId);
  const pool = await poolPromise;
  const [rows] = await pool.query('SELECT * FROM Users WHERE UserId = ?', [uid]);

  if (rows.length === 0) {
    throw new AppError('Không tìm thấy người dùng.', 404);
  }
  return mapUserRow(rows[0]);
}

async function createUserByAdmin(payload = {}) {
  const { username, fullName, name, email, phone, password, role, status, gender } =
    payload || {};
  const resolvedName = String(fullName || name || '').trim();
  const resolvedEmail = String(email || '').trim();
  const resolvedUsername =
    username !== undefined && username !== null && String(username).trim() !== ''
      ? String(username).trim()
      : null;
  const rawPhone =
    phone !== undefined && phone !== null && String(phone).trim() !== ''
      ? String(phone).trim()
      : null;

  if (!resolvedName) {
    throw new AppError('Vui lòng nhập họ tên người dùng.', 400);
  }
  if (!resolvedEmail || !isValidEmail(resolvedEmail)) {
    throw new AppError('Địa chỉ email không hợp lệ.', 400);
  }

  let storedPhone = null;
  if (rawPhone) {
    const cleanDigits = normalizePhoneDigits(rawPhone);
    if (cleanDigits.length < 8 || cleanDigits.length > 15) {
      throw new AppError('Số điện thoại không hợp lệ.', 400);
    }
    storedPhone = rawPhone.length <= 20 ? rawPhone : cleanDigits;
  }

  const normalizedRole = normalizeAdminRoleInput(role, false);
  const normalizedStatus = ['active', 'inactive', 'banned'].includes(status)
    ? status
    : 'active';
  const safeGender = ['Nam', 'Nữ', 'Khác'].includes(gender) ? gender : 'Nam';

  if (password !== undefined && password !== null && String(password) !== '') {
    if (String(password).length < 6) {
      throw new AppError('Mật khẩu phải có ít nhất 6 ký tự.', 400);
    }
  }
  const rawPass =
    password !== undefined && password !== null && String(password) !== ''
      ? String(password)
      : 'PetsFriend@123';
  const hashed = await hashPassword(rawPass);

  const pool = await poolPromise;

  const [dupEmail] = await pool.query(
    'SELECT UserId FROM Users WHERE LOWER(Email) = LOWER(?)',
    [resolvedEmail]
  );
  if (dupEmail.length > 0) {
    throw new AppError('Email này đã được sử dụng.', 409);
  }

  if (resolvedUsername) {
    const [dupUser] = await pool.query(
      'SELECT UserId FROM Users WHERE LOWER(Username) = LOWER(?)',
      [resolvedUsername]
    );
    if (dupUser.length > 0) {
      throw new AppError('Tên đăng nhập này đã được sử dụng.', 409);
    }
  }

  const [insertRes] = await pool.query(
    `
      INSERT INTO Users (Username, FullName, Email, Phone, PasswordHash, Role, Gender, Status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      resolvedUsername,
      resolvedName,
      resolvedEmail,
      storedPhone,
      hashed,
      normalizedRole,
      safeGender,
      normalizedStatus,
    ]
  );

  const [rows] = await pool.query('SELECT * FROM Users WHERE UserId = ?', [
    insertRes.insertId,
  ]);
  return mapUserRow(rows[0]);
}

async function updateUserByAdmin(userId, payload = {}) {
  const uid = validateUserId(userId);
  const pool = await poolPromise;

  const [existingRows] = await pool.query('SELECT * FROM Users WHERE UserId = ?', [uid]);

  if (existingRows.length === 0) {
    throw new AppError('Không tìm thấy người dùng.', 404);
  }

  const existing = existingRows[0];

  const mergedName =
    payload.fullName !== undefined || payload.name !== undefined
      ? String(payload.fullName ?? payload.name ?? '').trim()
      : existing.FullName;
  if (!mergedName) {
    throw new AppError('Họ tên người dùng không được để trống.', 400);
  }

  const mergedEmail =
    payload.email !== undefined ? String(payload.email || '').trim() : existing.Email;
  if (!mergedEmail || !isValidEmail(mergedEmail)) {
    throw new AppError('Địa chỉ email không hợp lệ.', 400);
  }

  const mergedUsername =
    payload.username !== undefined
      ? String(payload.username || '').trim() || null
      : existing.Username;

  let mergedPhone = existing.Phone;
  if (payload.phone !== undefined) {
    const rawP = String(payload.phone || '').trim();
    if (!rawP) {
      mergedPhone = null;
    } else {
      const digits = normalizePhoneDigits(rawP);
      if (digits.length < 8 || digits.length > 15) {
        throw new AppError('Số điện thoại không hợp lệ.', 400);
      }
      mergedPhone = rawP.length <= 20 ? rawP : digits;
    }
  }

  const mergedRole =
    payload.role !== undefined
      ? normalizeAdminRoleInput(payload.role, true)
      : existing.Role;

  let mergedStatus = existing.Status || 'active';
  if (payload.status !== undefined) {
    if (!['active', 'inactive', 'banned'].includes(payload.status)) {
      throw new AppError('Trạng thái tài khoản không hợp lệ.', 400);
    }
    mergedStatus = payload.status;
  }

  let mergedGender = existing.Gender || 'Nam';
  if (payload.gender !== undefined && payload.gender !== null && String(payload.gender).trim() !== '') {
    if (!['Nam', 'Nữ', 'Khác'].includes(payload.gender)) {
      throw new AppError('Giới tính không hợp lệ (Nam, Nữ hoặc Khác).', 400);
    }
    mergedGender = payload.gender;
  }

  const currentStatus = existing.Status || 'active';
  if (
    existing.Role === 'admin' &&
    currentStatus === 'active' &&
    (mergedRole !== 'admin' || mergedStatus !== 'active')
  ) {
    const [adminCntRows] = await pool.query(
      "SELECT COUNT(*) AS cnt FROM Users WHERE Role = 'admin' AND IFNULL(Status, 'active') = 'active' AND UserId <> ?",
      [uid]
    );
    if (Number(adminCntRows[0].cnt) === 0) {
      throw new AppError(
        'Không thể hạ quyền hoặc khóa tài khoản Quản trị viên duy nhất.',
        400
      );
    }
  }

  const [dupEmail] = await pool.query(
    'SELECT UserId FROM Users WHERE LOWER(Email) = LOWER(?) AND UserId <> ?',
    [mergedEmail, uid]
  );
  if (dupEmail.length > 0) {
    throw new AppError('Email này đã thuộc về tài khoản khác.', 409);
  }

  if (mergedUsername) {
    const [dupUser] = await pool.query(
      'SELECT UserId FROM Users WHERE LOWER(Username) = LOWER(?) AND UserId <> ?',
      [mergedUsername, uid]
    );
    if (dupUser.length > 0) {
      throw new AppError('Tên đăng nhập này đã được sử dụng.', 409);
    }
  }

  let mergedPasswordHash = existing.PasswordHash;
  if (payload.password !== undefined && payload.password !== null && String(payload.password) !== '') {
    if (String(payload.password).length < 6) {
      throw new AppError('Mật khẩu phải có ít nhất 6 ký tự.', 400);
    }
    mergedPasswordHash = await hashPassword(payload.password);
  }

  await pool.query(
    `
      UPDATE Users
      SET Username = ?,
          FullName = ?,
          Email = ?,
          Phone = ?,
          PasswordHash = ?,
          Role = ?,
          Gender = ?,
          Status = ?
      WHERE UserId = ?
    `,
    [
      mergedUsername,
      mergedName,
      mergedEmail,
      mergedPhone,
      mergedPasswordHash,
      mergedRole,
      mergedGender,
      mergedStatus,
      uid,
    ]
  );

  const [updatedRows] = await pool.query('SELECT * FROM Users WHERE UserId = ?', [uid]);
  return mapUserRow(updatedRows[0]);
}

async function updateUserRole(userId, role) {
  if (!['customer', 'staff', 'admin'].includes(role)) {
    throw new AppError('Vai trò không hợp lệ (chỉ chấp nhận customer, staff, admin).', 400);
  }
  return updateUserByAdmin(userId, { role });
}

async function updateUserStatus(userId, status) {
  if (!['active', 'inactive', 'banned'].includes(status)) {
    throw new AppError('Trạng thái không hợp lệ (chỉ chấp nhận active, inactive, banned).', 400);
  }
  return updateUserByAdmin(userId, { status });
}

async function deleteUserByAdmin(userId, requesterUserId = null) {
  const uid = validateUserId(userId);

  if (requesterUserId && Number(requesterUserId) === uid) {
    throw new AppError('Không thể tự xóa tài khoản đang đăng nhập.', 400);
  }

  const pool = await poolPromise;
  const [existingRows] = await pool.query('SELECT * FROM Users WHERE UserId = ?', [uid]);

  if (existingRows.length === 0) {
    throw new AppError('Không tìm thấy người dùng.', 404);
  }

  const existing = existingRows[0];
  if (existing.Role === 'admin') {
    const [adminCntRows] = await pool.query(
      "SELECT COUNT(*) AS cnt FROM Users WHERE Role = 'admin' AND UserId <> ?",
      [uid]
    );
    if (Number(adminCntRows[0].cnt) === 0) {
      throw new AppError('Không thể xóa tài khoản Quản trị viên cuối cùng.', 400);
    }
  }

  await pool.query('DELETE FROM Users WHERE UserId = ?', [uid]);

  return { deleted: true };
}

async function updateProfile(userId, payload = {}) {
  const uid = validateUserId(userId);
  const { fullName, name, email, phone, gender } = payload || {};

  const pool = await poolPromise;
  const [existingRows] = await pool.query('SELECT * FROM Users WHERE UserId = ?', [uid]);

  if (existingRows.length === 0) {
    throw new AppError('Không tìm thấy tài khoản.', 404);
  }

  const existing = existingRows[0];

  const mergedName =
    fullName !== undefined || name !== undefined
      ? String(fullName ?? name ?? '').trim()
      : existing.FullName;
  if (!mergedName) {
    throw new AppError('Họ tên không được để trống.', 400);
  }

  const mergedEmail =
    email !== undefined ? String(email || '').trim() : existing.Email;
  if (!mergedEmail || !isValidEmail(mergedEmail)) {
    throw new AppError('Địa chỉ email không hợp lệ.', 400);
  }

  const [dupCheck] = await pool.query(
    'SELECT UserId FROM Users WHERE LOWER(Email) = LOWER(?) AND UserId <> ?',
    [mergedEmail, uid]
  );
  if (dupCheck.length > 0) {
    throw new AppError('Email này đã thuộc về tài khoản khác.', 409);
  }

  let mergedPhone = existing.Phone;
  if (phone !== undefined) {
    const rawP = String(phone || '').trim();
    if (!rawP) {
      mergedPhone = null;
    } else {
      const cleanDigits = normalizePhoneDigits(rawP);
      if (cleanDigits.length < 9 || cleanDigits.length > 11) {
        throw new AppError('Số điện thoại không hợp lệ (cần từ 9 đến 11 chữ số).', 400);
      }
      mergedPhone = rawP.length <= 20 ? rawP : cleanDigits;
    }
  }

  let mergedGender = existing.Gender || 'Nam';
  if (gender !== undefined && gender !== null && String(gender).trim() !== '') {
    if (!['Nam', 'Nữ', 'Khác'].includes(gender)) {
      throw new AppError('Giới tính không hợp lệ (Nam, Nữ hoặc Khác).', 400);
    }
    mergedGender = gender;
  }

  await pool.query(
    `
      UPDATE Users
      SET FullName = ?, Email = ?, Phone = ?, Gender = ?
      WHERE UserId = ?
    `,
    [mergedName, mergedEmail, mergedPhone, mergedGender, uid]
  );

  const [updatedRows] = await pool.query('SELECT * FROM Users WHERE UserId = ?', [uid]);
  return mapUserRow(updatedRows[0]);
}

async function changePassword(userId, payload = {}) {
  const uid = validateUserId(userId);
  const { currentPassword, newPassword } = payload || {};

  if (!currentPassword || !newPassword || String(newPassword).length < 6) {
    throw new AppError(
      'Vui lòng nhập mật khẩu hiện tại và mật khẩu mới tối thiểu 6 ký tự.',
      400
    );
  }

  const pool = await poolPromise;
  const [userRows] = await pool.query(
    'SELECT PasswordHash FROM Users WHERE UserId = ?',
    [uid]
  );

  if (userRows.length === 0) {
    throw new AppError('Không tìm thấy tài khoản.', 404);
  }

  const isMatch = await verifyPassword(currentPassword, userRows[0].PasswordHash);
  if (!isMatch) {
    throw new AppError('Mật khẩu hiện tại không chính xác.', 400);
  }

  const hashed = await hashPassword(newPassword);
  await pool.query('UPDATE Users SET PasswordHash = ? WHERE UserId = ?', [
    hashed,
    uid,
  ]);

  return { updated: true };
}

async function listAllAddresses() {
  const pool = await poolPromise;
  const [rows] = await pool.query(
    'SELECT * FROM UserAddresses ORDER BY IsDefault DESC, AddressId DESC'
  );
  return rows.map(mapAddressRow);
}

async function getUserAddresses(userId) {
  const uid = validateUserId(userId);
  const pool = await poolPromise;
  const [rows] = await pool.query(
    'SELECT * FROM UserAddresses WHERE UserId = ? ORDER BY IsDefault DESC, AddressId DESC',
    [uid]
  );
  return rows.map(mapAddressRow);
}

async function addUserAddress(userId, payload = {}) {
  const uid = validateUserId(userId);
  const { label, recipient, recipientName, phone, address, fullAddress, isDefault } =
    payload || {};

  const finalLabel = String(label || 'Nhà riêng').trim() || 'Nhà riêng';
  const finalRecipient = String(recipient || recipientName || '').trim();
  const finalPhone = String(phone || '').trim();
  const finalAddress = String(address || fullAddress || '').trim();

  if (!finalRecipient || !finalPhone || !finalAddress) {
    throw new AppError('Vui lòng điền người nhận, số điện thoại và địa chỉ.', 400);
  }

  const pool = await poolPromise;
  const [userCheck] = await pool.query('SELECT UserId FROM Users WHERE UserId = ?', [
    uid,
  ]);
  if (userCheck.length === 0) {
    throw new AppError('Không tìm thấy người dùng.', 404);
  }

  const [countRows] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM UserAddresses WHERE UserId = ?',
    [uid]
  );

  const shouldBeDefault = Boolean(isDefault) || Number(countRows[0].cnt) === 0;
  if (shouldBeDefault) {
    await pool.query('UPDATE UserAddresses SET IsDefault = 0 WHERE UserId = ?', [uid]);
  }

  const [insertRes] = await pool.query(
    `
      INSERT INTO UserAddresses (UserId, Label, RecipientName, Phone, FullAddress, IsDefault)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [uid, finalLabel, finalRecipient, finalPhone, finalAddress, shouldBeDefault ? 1 : 0]
  );

  const [addrRows] = await pool.query(
    'SELECT * FROM UserAddresses WHERE AddressId = ?',
    [insertRes.insertId]
  );
  return mapAddressRow(addrRows[0]);
}

async function updateUserAddress(userId, addressId, payload = {}) {
  const uid = validateUserId(userId);
  const aid = validateAddressId(addressId);
  const { label, recipient, recipientName, phone, address, fullAddress, isDefault } =
    payload || {};

  const pool = await poolPromise;
  const [existingRows] = await pool.query(
    'SELECT * FROM UserAddresses WHERE AddressId = ? AND UserId = ?',
    [aid, uid]
  );

  if (existingRows.length === 0) {
    throw new AppError('Không tìm thấy địa chỉ.', 404);
  }

  const existing = existingRows[0];

  const mergedLabel =
    label !== undefined ? String(label || '').trim() || existing.Label : existing.Label;
  const mergedRecipient =
    recipient !== undefined || recipientName !== undefined
      ? String(recipient ?? recipientName ?? '').trim()
      : existing.RecipientName;
  const mergedPhone =
    phone !== undefined ? String(phone || '').trim() : existing.Phone;
  const mergedAddress =
    address !== undefined || fullAddress !== undefined
      ? String(address ?? fullAddress ?? '').trim()
      : existing.FullAddress;

  if (!mergedRecipient || !mergedPhone || !mergedAddress) {
    throw new AppError('Người nhận, số điện thoại và địa chỉ không được để trống.', 400);
  }

  let mergedIsDefault =
    isDefault !== undefined ? Boolean(isDefault) : Boolean(existing.IsDefault);

  if (mergedIsDefault) {
    await pool.query(
      'UPDATE UserAddresses SET IsDefault = 0 WHERE UserId = ? AND AddressId <> ?',
      [uid, aid]
    );
  } else if (Boolean(existing.IsDefault) && isDefault === false) {
    const [otherRows] = await pool.query(
      'SELECT AddressId FROM UserAddresses WHERE UserId = ? AND AddressId <> ? ORDER BY AddressId DESC LIMIT 1',
      [uid, aid]
    );
    if (otherRows.length > 0) {
      await pool.query('UPDATE UserAddresses SET IsDefault = 1 WHERE AddressId = ?', [
        otherRows[0].AddressId,
      ]);
    } else {
      mergedIsDefault = true;
    }
  }

  await pool.query(
    `
      UPDATE UserAddresses
      SET Label = ?,
          RecipientName = ?,
          Phone = ?,
          FullAddress = ?,
          IsDefault = ?
      WHERE AddressId = ? AND UserId = ?
    `,
    [
      mergedLabel,
      mergedRecipient,
      mergedPhone,
      mergedAddress,
      mergedIsDefault ? 1 : 0,
      aid,
      uid,
    ]
  );

  const [updatedRows] = await pool.query(
    'SELECT * FROM UserAddresses WHERE AddressId = ?',
    [aid]
  );
  return mapAddressRow(updatedRows[0]);
}

async function setDefaultUserAddress(userId, addressId) {
  const uid = validateUserId(userId);
  const aid = validateAddressId(addressId);
  const pool = await poolPromise;

  const [existingRows] = await pool.query(
    'SELECT AddressId FROM UserAddresses WHERE AddressId = ? AND UserId = ?',
    [aid, uid]
  );

  if (existingRows.length === 0) {
    throw new AppError('Không tìm thấy địa chỉ.', 404);
  }

  await pool.query('UPDATE UserAddresses SET IsDefault = 0 WHERE UserId = ?', [uid]);
  await pool.query(
    'UPDATE UserAddresses SET IsDefault = 1 WHERE AddressId = ? AND UserId = ?',
    [aid, uid]
  );

  const [rows] = await pool.query('SELECT * FROM UserAddresses WHERE AddressId = ?', [
    aid,
  ]);
  return mapAddressRow(rows[0]);
}

async function deleteUserAddress(userId, addressId) {
  const uid = validateUserId(userId);
  const aid = validateAddressId(addressId);
  const pool = await poolPromise;

  const [existingRows] = await pool.query(
    'SELECT AddressId, IsDefault FROM UserAddresses WHERE AddressId = ? AND UserId = ?',
    [aid, uid]
  );

  if (existingRows.length === 0) {
    throw new AppError('Không tìm thấy địa chỉ nhận hàng.', 404);
  }

  const wasDefault = Boolean(existingRows[0].IsDefault);

  await pool.query(
    'DELETE FROM UserAddresses WHERE AddressId = ? AND UserId = ?',
    [aid, uid]
  );

  if (wasDefault) {
    await pool.query(
      'UPDATE UserAddresses SET IsDefault = 1 WHERE UserId = ? ORDER BY AddressId DESC LIMIT 1',
      [uid]
    );
  }

  return { deleted: true };
}

module.exports = {
  AppError,
  login,
  register,
  getProfileMe,
  lookupByPhone,
  listUsers,
  getUserById,
  createUserByAdmin,
  updateUserByAdmin,
  updateUserRole,
  updateUserStatus,
  deleteUserByAdmin,
  updateProfile,
  changePassword,
  listAllAddresses,
  getUserAddresses,
  addUserAddress,
  updateUserAddress,
  setDefaultUserAddress,
  deleteUserAddress,
};
