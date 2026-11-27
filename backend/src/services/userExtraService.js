const { poolPromise } = require('../../../api/db');
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
  const [userRows] = await pool.query('SELECT UserId FROM Users WHERE UserId = ?', [uid]);

  if (userRows.length === 0) {
    throw new AppError('Không tìm thấy người dùng.', 404);
  }
  return uid;
}

async function fetchActiveWishlistIds(pool, uid) {
  const [rows] = await pool.query(
    `
      SELECT w.ProductId
      FROM UserWishlists w
      INNER JOIN Products p ON w.ProductId = p.ProductId
      WHERE w.UserId = ? AND p.IsActive = 1
      ORDER BY w.CreatedAt DESC
    `,
    [uid]
  );
  return rows.map((r) => r.ProductId);
}

async function getUserWishlist(userId) {
  const pool = await poolPromise;
  const uid = await ensureUserExists(pool, userId);

  const [rows] = await pool.query(
    `
      SELECT p.*
      FROM UserWishlists w
      INNER JOIN Products p ON w.ProductId = p.ProductId
      WHERE w.UserId = ? AND p.IsActive = 1
      ORDER BY w.CreatedAt DESC
    `,
    [uid]
  );

  if (rows.length === 0) {
    return { productIds: [], items: [] };
  }

  const productIdsParam = rows.map((r) => r.ProductId);
  const placeholders = productIdsParam.map(() => '?').join(', ');

  const [revRows] = await pool.query(
    `
      SELECT *
      FROM ProductReviews
      WHERE ProductId IN (${placeholders})
      ORDER BY ReviewId DESC
    `,
    productIdsParam
  );

  const reviewsByProduct = new Map();
  for (const revRow of revRows) {
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

  const [prodCheck] = await pool.query(
    'SELECT ProductId FROM Products WHERE ProductId = ? AND IsActive = 1',
    [pid]
  );

  if (prodCheck.length === 0) {
    throw new AppError('Không tìm thấy sản phẩm.', 404);
  }

  await pool.query(
    'INSERT IGNORE INTO UserWishlists (UserId, ProductId) VALUES (?, ?)',
    [uid, pid]
  );

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

  await pool.query(
    'DELETE FROM UserWishlists WHERE UserId = ? AND ProductId = ?',
    [uid, pid]
  );

  const productIds = await fetchActiveWishlistIds(pool, uid);
  return { productId: pid, productIds };
}

async function getStaffRoster() {
  const pool = await poolPromise;
  const [rows] = await pool.query(
    'SELECT StaffId, StaffName, CreatedAt FROM StaffRoster ORDER BY StaffId ASC'
  );

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
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM StaffRoster');
    for (const name of uniqueNames) {
      // eslint-disable-next-line no-await-in-loop
      await conn.query('INSERT INTO StaffRoster (StaffName) VALUES (?)', [
        name.slice(0, 120),
      ]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }

  return { staffRoster: uniqueNames };
}

async function addStaffMember(staffName) {
  const trimmed = String(staffName || '').trim();
  if (!trimmed) {
    throw new AppError('Vui lòng nhập tên nhân viên trực.', 400);
  }

  const pool = await poolPromise;
  const [dupRows] = await pool.query(
    'SELECT StaffId FROM StaffRoster WHERE LOWER(StaffName) = LOWER(?)',
    [trimmed]
  );

  if (dupRows.length > 0) {
    throw new AppError('Nhân viên này đã có trong danh sách trực.', 409);
  }

  await pool.query('INSERT INTO StaffRoster (StaffName) VALUES (?)', [
    trimmed.slice(0, 120),
  ]);

  return getStaffRoster();
}

async function removeStaffMember(staffName) {
  const trimmed = String(staffName || '').trim();
  if (!trimmed) {
    throw new AppError('Vui lòng cung cấp tên nhân viên cần xóa.', 400);
  }

  const pool = await poolPromise;
  const [countRows] = await pool.query('SELECT COUNT(*) AS cnt FROM StaffRoster');

  if (Number(countRows[0].cnt) <= 1) {
    throw new AppError('Cần giữ ít nhất 1 nhân viên sử dụng tài khoản staff.', 400);
  }

  const [delRes] = await pool.query(
    'DELETE FROM StaffRoster WHERE LOWER(StaffName) = LOWER(?)',
    [trimmed]
  );

  if (!delRes.affectedRows) {
    throw new AppError('Không tìm thấy nhân viên trong danh sách.', 404);
  }

  return getStaffRoster();
}

async function getStaffPermissions() {
  const pool = await poolPromise;
  const [rows] = await pool.query('SELECT PermKey, IsAllowed FROM StaffPermissions');

  const permissions = { ...DEFAULT_STAFF_PERMISSIONS };
  for (const row of rows) {
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
    await pool.query(
      `
        INSERT INTO StaffPermissions (PermKey, IsAllowed)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE IsAllowed = VALUES(IsAllowed)
      `,
      [key, allowedBit]
    );
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
