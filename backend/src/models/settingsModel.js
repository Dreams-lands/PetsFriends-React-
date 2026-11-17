const { sql, poolPromise } = require('../config/db');

const STORE_COLS = `StoreName AS storeName, StreetAddress AS streetAddress, District AS district, City AS city,
  Hotline AS hotline, Phone AS phone, Email AS email, ZaloUrl AS zaloUrl, FacebookUrl AS facebookUrl,
  Hours AS hours, Timezone AS timezone, Currency AS currency`;

const PERM_KEYS = [
  'ordersManage',
  'ordersInvoices',
  'pos',
  'appointments',
  'inventoryView',
  'inventoryEdit',
  'analytics',
];

exports.getStore = async () => {
  const pool = await poolPromise;
  const r = await pool.request().query(`SELECT ${STORE_COLS} FROM StoreSettings WHERE Id = 1`);
  return r.recordset[0];
};

// Trường nào không gửi (null) thì giữ nguyên giá trị cũ
exports.updateStore = async (s) => {
  const pool = await poolPromise;
  await pool.request()
    .input('storeName', sql.NVarChar(200), s.storeName)
    .input('street', sql.NVarChar(200), s.streetAddress)
    .input('district', sql.NVarChar(100), s.district)
    .input('city', sql.NVarChar(100), s.city)
    .input('hotline', sql.NVarChar(30), s.hotline)
    .input('phone', sql.NVarChar(30), s.phone)
    .input('email', sql.NVarChar(150), s.email)
    .input('zalo', sql.NVarChar(300), s.zaloUrl)
    .input('fb', sql.NVarChar(300), s.facebookUrl)
    .input('hours', sql.NVarChar(100), s.hours)
    .input('tz', sql.NVarChar(100), s.timezone)
    .input('cur', sql.NVarChar(30), s.currency)
    .query(`UPDATE StoreSettings SET
      StoreName = COALESCE(@storeName, StoreName), StreetAddress = COALESCE(@street, StreetAddress),
      District = COALESCE(@district, District), City = COALESCE(@city, City),
      Hotline = COALESCE(@hotline, Hotline), Phone = COALESCE(@phone, Phone),
      Email = COALESCE(@email, Email), ZaloUrl = COALESCE(@zalo, ZaloUrl),
      FacebookUrl = COALESCE(@fb, FacebookUrl), Hours = COALESCE(@hours, Hours),
      Timezone = COALESCE(@tz, Timezone), Currency = COALESCE(@cur, Currency)
      WHERE Id = 1`);
  return exports.getStore();
};

exports.getPermissions = async () => {
  const pool = await poolPromise;
  const r = await pool.request().query('SELECT PermKey, IsAllowed FROM StaffPermissions');
  const perms = {};
  PERM_KEYS.forEach((k) => { perms[k] = false; });
  r.recordset.forEach((row) => {
    if (PERM_KEYS.includes(row.PermKey)) {
      perms[row.PermKey] = Boolean(row.IsAllowed);
    }
  });
  return { ...perms, settings: false }; // settings luôn khóa cho admin
};

exports.updatePermissions = async (p) => {
  const pool = await poolPromise;
  for (const k of PERM_KEYS) {
    if (p[k] !== undefined && p[k] !== null) {
      await pool.request()
        .input('key', sql.NVarChar(50), k)
        .input('val', sql.Bit, p[k])
        .query(`
          IF EXISTS (SELECT 1 FROM StaffPermissions WHERE PermKey = @key)
            UPDATE StaffPermissions SET IsAllowed = @val WHERE PermKey = @key
          ELSE
            INSERT INTO StaffPermissions (PermKey, IsAllowed) VALUES (@key, @val)
        `);
    }
  }
  return exports.getPermissions();
};
