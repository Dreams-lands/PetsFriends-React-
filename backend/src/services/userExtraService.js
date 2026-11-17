const { sql, poolPromise } = require('../../../api/db');
const { mapProductRow, mapReviewRow } = require('../utils/mappers');
const { AppError } = require('./userService');

const DEFAULT_STAFF_PERMISSIONS = {
  ordersManage: true,
  ordersInvoices: true,
  pos: true,
  appointments: true,
  inventoryView: true,
  inventoryEdit: false,
  analytics: false,
  settings: false,
};

const ALLOWED_PERMISSION_KEYS = [
  'ordersManage',
  'ordersInvoices',
  'pos',
  'appointments',
  'inventoryView',
  'inventoryEdit',
  'analytics',
  'settings',
];

async function ensureUserExists(pool, userId) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) {
    throw new AppError('Mã người dùng không hợp lệ.', 400);
  }
  const userRes = await pool
    .request()
    .input('userId', sql.Int, uid)
    .query('SELECT UserId FROM dbo.Users WHERE UserId = @userId');

  if (userRes.recordset.length === 0) {
    throw new AppError('Không tìm thấy người dùng.', 404);
  }
  return uid;
}

async function fetchActiveWishlistIds(pool, uid) {
  const res = await pool
    .request()
    .input('userId', sql.Int, uid)
    .query(`
      SELECT w.ProductId
      FROM dbo.UserWishlists w
      INNER JOIN dbo.Products p ON w.ProductId = p.ProductId
      WHERE w.UserId = @userId AND p.IsActive = 1
      ORDER BY w.CreatedAt DESC
    `);
  return res.recordset.map((r) => r.ProductId);
}

async function getUserWishlist(userId) {
  const pool = await poolPromise;
  const uid = await ensureUserExists(pool, userId);

  const prodRes = await pool
    .request()
    .input('userId', sql.Int, uid)
    .query(`
      SELECT p.*
      FROM dbo.UserWishlists w
      INNER JOIN dbo.Products p ON w.ProductId = p.ProductId
      WHERE w.UserId = @userId AND p.IsActive = 1
      ORDER BY w.CreatedAt DESC
    `);

  const rows = prodRes.recordset;
  if (rows.length === 0) {
    return { productIds: [], items: [] };
  }

  const revReq = pool.request();
  const placeholders = rows.map((r, idx) => {
    const param = `pid${idx}`;
    revReq.input(param, sql.NVarChar(60), r.ProductId);
    return `@${param}`;
  });

  const revRes = await revReq.query(`
    SELECT *
    FROM dbo.ProductReviews
    WHERE ProductId IN (${placeholders.join(', ')})
    ORDER BY ReviewId DESC
  `);

  const reviewsByProduct = new Map();
  for (const revRow of revRes.recordset) {
    const list = reviewsByProduct.get(revRow.ProductId) || [];
    list.push(mapReviewRow(revRow));
    reviewsByProduct.set(revRow.ProductId, list);
  }

  const items = rows.map((row) =>
    mapProductRow(row, reviewsByProduct.get(row.ProductId) || [])
  );
  const productIds = items.map((item) => item.id);

  return { productIds, items };
}

async function addToWishlist(userId, productId) {
  const pid = String(productId || '').trim();
  if (!pid) {
    throw new AppError('Vui lòng cung cấp mã sản phẩm.', 400);
  }

  const pool = await poolPromise;
  const uid = await ensureUserExists(pool, userId);

  const prodCheck = await pool
    .request()
    .input('productId', sql.NVarChar(60), pid)
    .query('SELECT ProductId FROM dbo.Products WHERE ProductId = @productId AND IsActive = 1');

  if (prodCheck.recordset.length === 0) {
    throw new AppError('Không tìm thấy sản phẩm.', 404);
  }

  await pool
    .request()
    .input('userId', sql.Int, uid)
    .input('productId', sql.NVarChar(60), pid)
    .query(`
      IF NOT EXISTS (
        SELECT 1 FROM dbo.UserWishlists WHERE UserId = @userId AND ProductId = @productId
      )
      BEGIN
        INSERT INTO dbo.UserWishlists (UserId, ProductId)
        VALUES (@userId, @productId);
      END
    `);

  const productIds = await fetchActiveWishlistIds(pool, uid);
  return { productId: pid, productIds };
}

async function removeFromWishlist(userId, productId) {
  const pid = String(productId || '').trim();
  if (!pid) {
    throw new AppError('Vui lòng cung cấp mã sản phẩm.', 400);
  }

  const pool = await poolPromise;
  const uid = await ensureUserExists(pool, userId);

  await pool
    .request()
    .input('userId', sql.Int, uid)
    .input('productId', sql.NVarChar(60), pid)
    .query('DELETE FROM dbo.UserWishlists WHERE UserId = @userId AND ProductId = @productId');

  const productIds = await fetchActiveWishlistIds(pool, uid);
  return { productId: pid, productIds };
}

async function getStaffRoster() {
  const pool = await poolPromise;
  const res = await pool
    .request()
    .query('SELECT StaffId, StaffName, CreatedAt FROM dbo.StaffRoster ORDER BY StaffId ASC');

  const rows = res.recordset;
  return {
    staffRoster: rows.map((r) => r.StaffName),
    items: rows,
  };
}

async function replaceStaffRoster(staffNames) {
  if (!Array.isArray(staffNames)) {
    throw new AppError('Danh sách nhân viên trực không hợp lệ.', 400);
  }

  const seen = new Set();
  const uniqueNames = [];
  for (const raw of staffNames) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueNames.push(trimmed);
    }
  }

  if (uniqueNames.length === 0) {
    throw new AppError('Danh sách nhân viên trực phải có ít nhất 1 nhân viên.', 400);
  }

  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await new sql.Request(tx).query('DELETE FROM dbo.StaffRoster');
    for (const name of uniqueNames) {
      // eslint-disable-next-line no-await-in-loop
      await new sql.Request(tx)
        .input('staffName', sql.NVarChar(120), name)
        .query('INSERT INTO dbo.StaffRoster (StaffName) VALUES (@staffName)');
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }

  return { staffRoster: uniqueNames };
}

async function addStaffMember(staffName) {
  const trimmed = String(staffName || '').trim();
  if (!trimmed) {
    throw new AppError('Vui lòng nhập tên nhân viên trực.', 400);
  }

  const pool = await poolPromise;
  const dupRes = await pool
    .request()
    .input('staffName', sql.NVarChar(120), trimmed)
    .query('SELECT StaffId FROM dbo.StaffRoster WHERE LOWER(StaffName) = LOWER(@staffName)');

  if (dupRes.recordset.length > 0) {
    throw new AppError('Nhân viên này đã có trong danh sách trực.', 409);
  }

  await pool
    .request()
    .input('staffName', sql.NVarChar(120), trimmed)
    .query('INSERT INTO dbo.StaffRoster (StaffName) VALUES (@staffName)');

  return getStaffRoster();
}

async function removeStaffMember(staffName) {
  const trimmed = String(staffName || '').trim();
  if (!trimmed) {
    throw new AppError('Vui lòng cung cấp tên nhân viên cần xóa.', 400);
  }

  const pool = await poolPromise;
  const countRes = await pool
    .request()
    .query('SELECT COUNT(*) AS cnt FROM dbo.StaffRoster');

  if (Number(countRes.recordset[0].cnt) <= 1) {
    throw new AppError('Cần giữ ít nhất 1 nhân viên sử dụng tài khoản staff.', 400);
  }

  const delRes = await pool
    .request()
    .input('staffName', sql.NVarChar(120), trimmed)
    .query('DELETE FROM dbo.StaffRoster WHERE LOWER(StaffName) = LOWER(@staffName)');

  if (!delRes.rowsAffected || delRes.rowsAffected[0] === 0) {
    throw new AppError('Không tìm thấy nhân viên trong danh sách.', 404);
  }

  return getStaffRoster();
}

async function getStaffPermissions() {
  const pool = await poolPromise;
  const res = await pool
    .request()
    .query('SELECT PermKey, IsAllowed FROM dbo.StaffPermissions');

  const permissions = { ...DEFAULT_STAFF_PERMISSIONS };
  for (const row of res.recordset) {
    if (ALLOWED_PERMISSION_KEYS.includes(row.PermKey)) {
      permissions[row.PermKey] = Boolean(row.IsAllowed);
    }
  }
  permissions.settings = false;
  return permissions;
}

async function updateStaffPermissions(permsObj) {
  if (!permsObj || typeof permsObj !== 'object' || Array.isArray(permsObj)) {
    throw new AppError('Dữ liệu phân quyền nhân viên không hợp lệ.', 400);
  }

  const source =
    permsObj.permissions &&
    typeof permsObj.permissions === 'object' &&
    !Array.isArray(permsObj.permissions)
      ? permsObj.permissions
      : permsObj;

  const pool = await poolPromise;

  for (const key of ALLOWED_PERMISSION_KEYS) {
    const isSettings = key === 'settings';
    if (!isSettings && source[key] === undefined) {
      continue;
    }
    const allowedBit = isSettings ? 0 : source[key] ? 1 : 0;
    // eslint-disable-next-line no-await-in-loop
    await pool
      .request()
      .input('permKey', sql.NVarChar(50), key)
      .input('isAllowed', sql.Bit, allowedBit)
      .query(`
        IF EXISTS (SELECT 1 FROM dbo.StaffPermissions WHERE PermKey = @permKey)
          UPDATE dbo.StaffPermissions SET IsAllowed = @isAllowed WHERE PermKey = @permKey;
        ELSE
          INSERT INTO dbo.StaffPermissions (PermKey, IsAllowed) VALUES (@permKey, @isAllowed);
      `);
  }

  return getStaffPermissions();
}

module.exports = {
  getUserWishlist,
  addToWishlist,
  removeFromWishlist,
  getStaffRoster,
  replaceStaffRoster,
  addStaffMember,
  removeStaffMember,
  getStaffPermissions,
  updateStaffPermissions,
};
