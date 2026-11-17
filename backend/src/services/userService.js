const { sql, poolPromise } = require('../../../api/db');
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
  const cleaned = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(${col}, N''), N'+84', N'0'), N' ', N''), N'.', N''), N'-', N''), N'(', N''), N')', N'')`;
  return `(CASE WHEN LEFT(${cleaned}, 2) = N'84' AND LEN(${cleaned}) >= 11 THEN N'0' + SUBSTRING(${cleaned}, 3, 30) ELSE ${cleaned} END)`;
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
  const [addrRes, wishRes] = await Promise.all([
    pool
      .request()
      .input('userId', sql.Int, userId)
      .query(
        'SELECT * FROM dbo.UserAddresses WHERE UserId = @userId ORDER BY IsDefault DESC, AddressId DESC'
      ),
    pool
      .request()
      .input('userId', sql.Int, userId)
      .query(
        'SELECT ProductId FROM dbo.UserWishlists WHERE UserId = @userId ORDER BY CreatedAt DESC'
      ),
  ]);

  return {
    addresses: addrRes.recordset.map(mapAddressRow),
    wishlist: wishRes.recordset.map((r) => r.ProductId),
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

  const result = await pool
    .request()
    .input('loginKey', sql.NVarChar(150), loginKey)
    .input('cleanDigits', sql.NVarChar(30), cleanDigits)
    .query(`
      SELECT UserId, Username, FullName, Email, Phone, PasswordHash, Role, Gender, Status, CreatedAt
      FROM dbo.Users
      WHERE LOWER(Email) = LOWER(@loginKey)
         OR LOWER(Username) = LOWER(@loginKey)
         OR (@cleanDigits <> N'' AND ${sqlNormalizedPhoneExpr('Phone')} = @cleanDigits)
      ORDER BY CASE WHEN Role = N'admin' THEN 0 WHEN Role = N'staff' THEN 1 ELSE 2 END, UserId ASC
    `);

  const matchedRows = [];
  for (const row of result.recordset) {
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
    await pool
      .request()
      .input('userId', sql.Int, matchedRow.UserId)
      .input('passwordHash', sql.NVarChar(255), upgradedHash)
      .query('UPDATE dbo.Users SET PasswordHash = @passwordHash WHERE UserId = @userId');
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

  const dupEmail = await pool
    .request()
    .input('email', sql.NVarChar(150), resolvedEmail)
    .query('SELECT UserId FROM dbo.Users WHERE LOWER(Email) = LOWER(@email)');
  if (dupEmail.recordset.length > 0) {
    throw new AppError('Email này đã được đăng ký tài khoản.', 409);
  }

  if (resolvedUsername) {
    const dupUser = await pool
      .request()
      .input('username', sql.NVarChar(50), resolvedUsername)
      .query('SELECT UserId FROM dbo.Users WHERE LOWER(Username) = LOWER(@username)');
    if (dupUser.recordset.length > 0) {
      throw new AppError('Tên đăng nhập này đã được sử dụng.', 409);
    }
  }

  if (cleanPhone) {
    const dupPhone = await pool
      .request()
      .input('cleanPhone', sql.NVarChar(30), cleanPhone)
      .query(
        `SELECT UserId FROM dbo.Users WHERE Role = N'customer' AND ${sqlNormalizedPhoneExpr('Phone')} = @cleanPhone`
      );
    if (dupPhone.recordset.length > 0) {
      throw new AppError('Số điện thoại này đã được đăng ký hội viên.', 409);
    }
  }

  const hashed = await hashPassword(password);
  const safeGender = ['Nam', 'Nữ', 'Khác'].includes(gender) ? gender : 'Nam';

  const insertRes = await pool
    .request()
    .input('username', sql.NVarChar(50), resolvedUsername)
    .input('fullName', sql.NVarChar(120), resolvedName)
    .input('email', sql.NVarChar(150), resolvedEmail)
    .input('phone', sql.NVarChar(20), storedPhone)
    .input('passwordHash', sql.NVarChar(255), hashed)
    .input('gender', sql.NVarChar(15), safeGender)
    .query(`
      INSERT INTO dbo.Users (Username, FullName, Email, Phone, PasswordHash, Role, Gender, Status)
      OUTPUT INSERTED.*
      VALUES (@username, @fullName, @email, @phone, @passwordHash, N'customer', @gender, N'active')
    `);

  const user = mapUserRow(insertRes.recordset[0]);
  const addresses = [];

  if (address && String(address).trim()) {
    const addrRes = await pool
      .request()
      .input('userId', sql.Int, user.userId)
      .input('label', sql.NVarChar(60), 'Nhà riêng')
      .input('recipient', sql.NVarChar(120), resolvedName)
      .input('phone', sql.NVarChar(20), storedPhone || '0900000000')
      .input('fullAddress', sql.NVarChar(300), String(address).trim())
      .query(`
        INSERT INTO dbo.UserAddresses (UserId, Label, RecipientName, Phone, FullAddress, IsDefault)
        OUTPUT INSERTED.*
        VALUES (@userId, @label, @recipient, @phone, @fullAddress, 1)
      `);
    addresses.push(mapAddressRow(addrRes.recordset[0]));
  }

  const token = signUserToken(user);
  return { user, token, addresses };
}

async function getProfileMe(userId) {
  const uid = validateUserId(userId);
  const pool = await poolPromise;

  const userRes = await pool
    .request()
    .input('userId', sql.Int, uid)
    .query('SELECT * FROM dbo.Users WHERE UserId = @userId');

  if (userRes.recordset.length === 0) {
    throw new AppError('Không tìm thấy tài khoản người dùng.', 404);
  }

  const user = mapUserRow(userRes.recordset[0]);
  const { addresses, wishlist } = await fetchUserAddressesAndWishlist(pool, uid);
  return { user, addresses, wishlist };
}

async function lookupByPhone(phone) {
  const cleanPhone = normalizePhoneDigits(phone);
  if (!cleanPhone) {
    throw new AppError('Vui lòng cung cấp số điện thoại.', 400);
  }

  const pool = await poolPromise;
  const result = await pool
    .request()
    .input('cleanPhone', sql.NVarChar(30), cleanPhone)
    .query(`
      SELECT TOP 1 *
      FROM dbo.Users
      WHERE ${sqlNormalizedPhoneExpr('Phone')} = @cleanPhone
      ORDER BY CASE WHEN Role = N'customer' THEN 0 ELSE 1 END, UserId DESC
    `);

  if (result.recordset.length === 0) {
    throw new AppError('Chưa có hội viên khớp SĐT này.', 404);
  }

  return { found: true, user: mapUserRow(result.recordset[0]) };
}

async function listUsers({ search, role, status } = {}) {
  const pool = await poolPromise;
  const req = pool.request();
  const clauses = ['1 = 1'];

  if (role && String(role).trim() && String(role).trim().toLowerCase() !== 'all') {
    const normalizedRole = normalizeAdminRoleInput(role, false);
    req.input('role', sql.NVarChar(20), normalizedRole);
    clauses.push('Role = @role');
  }

  if (status && String(status).trim() && String(status).trim().toLowerCase() !== 'all') {
    req.input('status', sql.NVarChar(20), String(status).trim().toLowerCase());
    clauses.push("ISNULL(Status, N'active') = @status");
  }

  if (search && String(search).trim()) {
    const q = `%${String(search).trim()}%`;
    const cleanDigits = normalizePhoneDigits(search);
    req.input('q', sql.NVarChar(160), q);
    if (cleanDigits) {
      req.input('digitsLike', sql.NVarChar(40), `%${cleanDigits}%`);
      clauses.push(
        `(FullName LIKE @q OR Email LIKE @q OR ISNULL(Phone, N'') LIKE @q OR ISNULL(Username, N'') LIKE @q OR ${sqlNormalizedPhoneExpr('Phone')} LIKE @digitsLike)`
      );
    } else {
      clauses.push(
        `(FullName LIKE @q OR Email LIKE @q OR ISNULL(Phone, N'') LIKE @q OR ISNULL(Username, N'') LIKE @q)`
      );
    }
  }

  const result = await req.query(`
    SELECT *
    FROM dbo.Users
    WHERE ${clauses.join(' AND ')}
    ORDER BY UserId DESC
  `);

  return result.recordset.map(mapUserRow);
}

async function getUserById(userId) {
  const uid = validateUserId(userId);
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input('userId', sql.Int, uid)
    .query('SELECT * FROM dbo.Users WHERE UserId = @userId');

  if (result.recordset.length === 0) {
    throw new AppError('Không tìm thấy người dùng.', 404);
  }
  return mapUserRow(result.recordset[0]);
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

  const dupEmail = await pool
    .request()
    .input('email', sql.NVarChar(150), resolvedEmail)
    .query('SELECT UserId FROM dbo.Users WHERE LOWER(Email) = LOWER(@email)');
  if (dupEmail.recordset.length > 0) {
    throw new AppError('Email này đã được sử dụng.', 409);
  }

  if (resolvedUsername) {
    const dupUser = await pool
      .request()
      .input('username', sql.NVarChar(50), resolvedUsername)
      .query('SELECT UserId FROM dbo.Users WHERE LOWER(Username) = LOWER(@username)');
    if (dupUser.recordset.length > 0) {
      throw new AppError('Tên đăng nhập này đã được sử dụng.', 409);
    }
  }

  const insertRes = await pool
    .request()
    .input('username', sql.NVarChar(50), resolvedUsername)
    .input('fullName', sql.NVarChar(120), resolvedName)
    .input('email', sql.NVarChar(150), resolvedEmail)
    .input('phone', sql.NVarChar(20), storedPhone)
    .input('passwordHash', sql.NVarChar(255), hashed)
    .input('role', sql.NVarChar(20), normalizedRole)
    .input('gender', sql.NVarChar(15), safeGender)
    .input('status', sql.NVarChar(20), normalizedStatus)
    .query(`
      INSERT INTO dbo.Users (Username, FullName, Email, Phone, PasswordHash, Role, Gender, Status)
      OUTPUT INSERTED.*
      VALUES (@username, @fullName, @email, @phone, @passwordHash, @role, @gender, @status)
    `);

  return mapUserRow(insertRes.recordset[0]);
}

async function updateUserByAdmin(userId, payload = {}) {
  const uid = validateUserId(userId);
  const pool = await poolPromise;

  const existingRes = await pool
    .request()
    .input('userId', sql.Int, uid)
    .query('SELECT * FROM dbo.Users WHERE UserId = @userId');

  if (existingRes.recordset.length === 0) {
    throw new AppError('Không tìm thấy người dùng.', 404);
  }

  const existing = existingRes.recordset[0];

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
    const adminCntRes = await pool
      .request()
      .input('userId', sql.Int, uid)
      .query(
        "SELECT COUNT(*) AS cnt FROM dbo.Users WHERE Role = N'admin' AND ISNULL(Status, N'active') = N'active' AND UserId <> @userId"
      );
    if (Number(adminCntRes.recordset[0].cnt) === 0) {
      throw new AppError(
        'Không thể hạ quyền hoặc khóa tài khoản Quản trị viên duy nhất.',
        400
      );
    }
  }

  const dupEmail = await pool
    .request()
    .input('email', sql.NVarChar(150), mergedEmail)
    .input('userId', sql.Int, uid)
    .query(
      'SELECT UserId FROM dbo.Users WHERE LOWER(Email) = LOWER(@email) AND UserId <> @userId'
    );
  if (dupEmail.recordset.length > 0) {
    throw new AppError('Email này đã thuộc về tài khoản khác.', 409);
  }

  if (mergedUsername) {
    const dupUser = await pool
      .request()
      .input('username', sql.NVarChar(50), mergedUsername)
      .input('userId', sql.Int, uid)
      .query(
        'SELECT UserId FROM dbo.Users WHERE LOWER(Username) = LOWER(@username) AND UserId <> @userId'
      );
    if (dupUser.recordset.length > 0) {
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

  const updateRes = await pool
    .request()
    .input('userId', sql.Int, uid)
    .input('username', sql.NVarChar(50), mergedUsername)
    .input('fullName', sql.NVarChar(120), mergedName)
    .input('email', sql.NVarChar(150), mergedEmail)
    .input('phone', sql.NVarChar(20), mergedPhone)
    .input('passwordHash', sql.NVarChar(255), mergedPasswordHash)
    .input('role', sql.NVarChar(20), mergedRole)
    .input('gender', sql.NVarChar(15), mergedGender)
    .input('status', sql.NVarChar(20), mergedStatus)
    .query(`
      UPDATE dbo.Users
      SET Username = @username,
          FullName = @fullName,
          Email = @email,
          Phone = @phone,
          PasswordHash = @passwordHash,
          Role = @role,
          Gender = @gender,
          Status = @status
      OUTPUT INSERTED.*
      WHERE UserId = @userId
    `);

  return mapUserRow(updateRes.recordset[0]);
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
  const existingRes = await pool
    .request()
    .input('userId', sql.Int, uid)
    .query('SELECT * FROM dbo.Users WHERE UserId = @userId');

  if (existingRes.recordset.length === 0) {
    throw new AppError('Không tìm thấy người dùng.', 404);
  }

  const existing = existingRes.recordset[0];
  if (existing.Role === 'admin') {
    const adminCntRes = await pool
      .request()
      .input('userId', sql.Int, uid)
      .query("SELECT COUNT(*) AS cnt FROM dbo.Users WHERE Role = N'admin' AND UserId <> @userId");
    if (Number(adminCntRes.recordset[0].cnt) === 0) {
      throw new AppError('Không thể xóa tài khoản Quản trị viên cuối cùng.', 400);
    }
  }

  await pool
    .request()
    .input('userId', sql.Int, uid)
    .query('DELETE FROM dbo.Users WHERE UserId = @userId');

  return { deleted: true };
}

async function updateProfile(userId, payload = {}) {
  const uid = validateUserId(userId);
  const { fullName, name, email, phone, gender } = payload || {};

  const pool = await poolPromise;
  const existingRes = await pool
    .request()
    .input('userId', sql.Int, uid)
    .query('SELECT * FROM dbo.Users WHERE UserId = @userId');

  if (existingRes.recordset.length === 0) {
    throw new AppError('Không tìm thấy tài khoản.', 404);
  }

  const existing = existingRes.recordset[0];

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

  const dupCheck = await pool
    .request()
    .input('email', sql.NVarChar(150), mergedEmail)
    .input('userId', sql.Int, uid)
    .query(
      'SELECT UserId FROM dbo.Users WHERE LOWER(Email) = LOWER(@email) AND UserId <> @userId'
    );
  if (dupCheck.recordset.length > 0) {
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

  const result = await pool
    .request()
    .input('userId', sql.Int, uid)
    .input('fullName', sql.NVarChar(120), mergedName)
    .input('email', sql.NVarChar(150), mergedEmail)
    .input('phone', sql.NVarChar(20), mergedPhone)
    .input('gender', sql.NVarChar(15), mergedGender)
    .query(`
      UPDATE dbo.Users
      SET FullName = @fullName, Email = @email, Phone = @phone, Gender = @gender
      OUTPUT INSERTED.*
      WHERE UserId = @userId
    `);

  return mapUserRow(result.recordset[0]);
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
  const userRes = await pool
    .request()
    .input('userId', sql.Int, uid)
    .query('SELECT PasswordHash FROM dbo.Users WHERE UserId = @userId');

  if (userRes.recordset.length === 0) {
    throw new AppError('Không tìm thấy tài khoản.', 404);
  }

  const isMatch = await verifyPassword(currentPassword, userRes.recordset[0].PasswordHash);
  if (!isMatch) {
    throw new AppError('Mật khẩu hiện tại không chính xác.', 400);
  }

  const hashed = await hashPassword(newPassword);
  await pool
    .request()
    .input('userId', sql.Int, uid)
    .input('passwordHash', sql.NVarChar(255), hashed)
    .query('UPDATE dbo.Users SET PasswordHash = @passwordHash WHERE UserId = @userId');

  return { updated: true };
}

async function listAllAddresses() {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .query('SELECT * FROM dbo.UserAddresses ORDER BY IsDefault DESC, AddressId DESC');
  return result.recordset.map(mapAddressRow);
}

async function getUserAddresses(userId) {
  const uid = validateUserId(userId);
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input('userId', sql.Int, uid)
    .query(
      'SELECT * FROM dbo.UserAddresses WHERE UserId = @userId ORDER BY IsDefault DESC, AddressId DESC'
    );
  return result.recordset.map(mapAddressRow);
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
  const userCheck = await pool
    .request()
    .input('userId', sql.Int, uid)
    .query('SELECT UserId FROM dbo.Users WHERE UserId = @userId');
  if (userCheck.recordset.length === 0) {
    throw new AppError('Không tìm thấy người dùng.', 404);
  }

  const countRes = await pool
    .request()
    .input('userId', sql.Int, uid)
    .query('SELECT COUNT(*) AS cnt FROM dbo.UserAddresses WHERE UserId = @userId');

  const shouldBeDefault = Boolean(isDefault) || Number(countRes.recordset[0].cnt) === 0;
  if (shouldBeDefault) {
    await pool
      .request()
      .input('userId', sql.Int, uid)
      .query('UPDATE dbo.UserAddresses SET IsDefault = 0 WHERE UserId = @userId');
  }

  const insertRes = await pool
    .request()
    .input('userId', sql.Int, uid)
    .input('label', sql.NVarChar(60), finalLabel)
    .input('recipient', sql.NVarChar(120), finalRecipient)
    .input('phone', sql.NVarChar(20), finalPhone)
    .input('fullAddress', sql.NVarChar(300), finalAddress)
    .input('isDefault', sql.Bit, shouldBeDefault ? 1 : 0)
    .query(`
      INSERT INTO dbo.UserAddresses (UserId, Label, RecipientName, Phone, FullAddress, IsDefault)
      OUTPUT INSERTED.*
      VALUES (@userId, @label, @recipient, @phone, @fullAddress, @isDefault)
    `);

  return mapAddressRow(insertRes.recordset[0]);
}

async function updateUserAddress(userId, addressId, payload = {}) {
  const uid = validateUserId(userId);
  const aid = validateAddressId(addressId);
  const { label, recipient, recipientName, phone, address, fullAddress, isDefault } =
    payload || {};

  const pool = await poolPromise;
  const existingRes = await pool
    .request()
    .input('addressId', sql.Int, aid)
    .input('userId', sql.Int, uid)
    .query('SELECT * FROM dbo.UserAddresses WHERE AddressId = @addressId AND UserId = @userId');

  if (existingRes.recordset.length === 0) {
    throw new AppError('Không tìm thấy địa chỉ.', 404);
  }

  const existing = existingRes.recordset[0];

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
    await pool
      .request()
      .input('userId', sql.Int, uid)
      .input('addressId', sql.Int, aid)
      .query(
        'UPDATE dbo.UserAddresses SET IsDefault = 0 WHERE UserId = @userId AND AddressId <> @addressId'
      );
  } else if (Boolean(existing.IsDefault) && isDefault === false) {
    const otherRes = await pool
      .request()
      .input('userId', sql.Int, uid)
      .input('addressId', sql.Int, aid)
      .query(
        'SELECT TOP 1 AddressId FROM dbo.UserAddresses WHERE UserId = @userId AND AddressId <> @addressId ORDER BY AddressId DESC'
      );
    if (otherRes.recordset.length > 0) {
      await pool
        .request()
        .input('otherId', sql.Int, otherRes.recordset[0].AddressId)
        .query('UPDATE dbo.UserAddresses SET IsDefault = 1 WHERE AddressId = @otherId');
    } else {
      mergedIsDefault = true;
    }
  }

  const updateRes = await pool
    .request()
    .input('addressId', sql.Int, aid)
    .input('userId', sql.Int, uid)
    .input('label', sql.NVarChar(60), mergedLabel)
    .input('recipient', sql.NVarChar(120), mergedRecipient)
    .input('phone', sql.NVarChar(20), mergedPhone)
    .input('fullAddress', sql.NVarChar(300), mergedAddress)
    .input('isDefault', sql.Bit, mergedIsDefault ? 1 : 0)
    .query(`
      UPDATE dbo.UserAddresses
      SET Label = @label,
          RecipientName = @recipient,
          Phone = @phone,
          FullAddress = @fullAddress,
          IsDefault = @isDefault
      OUTPUT INSERTED.*
      WHERE AddressId = @addressId AND UserId = @userId
    `);

  return mapAddressRow(updateRes.recordset[0]);
}

async function setDefaultUserAddress(userId, addressId) {
  const uid = validateUserId(userId);
  const aid = validateAddressId(addressId);
  const pool = await poolPromise;

  const existingRes = await pool
    .request()
    .input('addressId', sql.Int, aid)
    .input('userId', sql.Int, uid)
    .query(
      'SELECT AddressId FROM dbo.UserAddresses WHERE AddressId = @addressId AND UserId = @userId'
    );

  if (existingRes.recordset.length === 0) {
    throw new AppError('Không tìm thấy địa chỉ.', 404);
  }

  await pool
    .request()
    .input('userId', sql.Int, uid)
    .query('UPDATE dbo.UserAddresses SET IsDefault = 0 WHERE UserId = @userId');

  const result = await pool
    .request()
    .input('addressId', sql.Int, aid)
    .input('userId', sql.Int, uid)
    .query(`
      UPDATE dbo.UserAddresses
      SET IsDefault = 1
      OUTPUT INSERTED.*
      WHERE AddressId = @addressId AND UserId = @userId
    `);

  return mapAddressRow(result.recordset[0]);
}

async function deleteUserAddress(userId, addressId) {
  const uid = validateUserId(userId);
  const aid = validateAddressId(addressId);
  const pool = await poolPromise;

  const existingRes = await pool
    .request()
    .input('addressId', sql.Int, aid)
    .input('userId', sql.Int, uid)
    .query(
      'SELECT AddressId, IsDefault FROM dbo.UserAddresses WHERE AddressId = @addressId AND UserId = @userId'
    );

  if (existingRes.recordset.length === 0) {
    throw new AppError('Không tìm thấy địa chỉ nhận hàng.', 404);
  }

  const wasDefault = Boolean(existingRes.recordset[0].IsDefault);

  await pool
    .request()
    .input('addressId', sql.Int, aid)
    .input('userId', sql.Int, uid)
    .query('DELETE FROM dbo.UserAddresses WHERE AddressId = @addressId AND UserId = @userId');

  if (wasDefault) {
    await pool
      .request()
      .input('userId', sql.Int, uid)
      .query(`
        UPDATE dbo.UserAddresses
        SET IsDefault = 1
        WHERE AddressId = (
          SELECT TOP 1 AddressId
          FROM dbo.UserAddresses
          WHERE UserId = @userId
          ORDER BY AddressId DESC
        )
      `);
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
