const { poolPromise } = require('../config/db');

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
  const [rows] = await pool.query(`SELECT ${STORE_COLS} FROM StoreSettings WHERE Id = 1`);
  return rows[0];
};

exports.updateStore = async (s) => {
  const pool = await poolPromise;
  await pool.query(
    `UPDATE StoreSettings SET
      StoreName = COALESCE(?, StoreName), StreetAddress = COALESCE(?, StreetAddress),
      District = COALESCE(?, District), City = COALESCE(?, City),
      Hotline = COALESCE(?, Hotline), Phone = COALESCE(?, Phone),
      Email = COALESCE(?, Email), ZaloUrl = COALESCE(?, ZaloUrl),
      FacebookUrl = COALESCE(?, FacebookUrl), Hours = COALESCE(?, Hours),
      Timezone = COALESCE(?, Timezone), Currency = COALESCE(?, Currency)
      WHERE Id = 1`,
    [
      s.storeName ?? null,
      s.streetAddress ?? null,
      s.district ?? null,
      s.city ?? null,
      s.hotline ?? null,
      s.phone ?? null,
      s.email ?? null,
      s.zaloUrl ?? null,
      s.facebookUrl ?? null,
      s.hours ?? null,
      s.timezone ?? null,
      s.currency ?? null,
    ]
  );
  return exports.getStore();
};

exports.getPermissions = async () => {
  const pool = await poolPromise;
  const [rows] = await pool.query('SELECT PermKey, IsAllowed FROM StaffPermissions');
  const perms = {};
  PERM_KEYS.forEach((k) => {
    perms[k] = false;
  });
  rows.forEach((row) => {
    if (PERM_KEYS.includes(row.PermKey)) {
      perms[row.PermKey] = Boolean(row.IsAllowed);
    }
  });
  return { ...perms, settings: false };
};

exports.updatePermissions = async (p) => {
  const pool = await poolPromise;
  for (const k of PERM_KEYS) {
    if (p[k] !== undefined && p[k] !== null) {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `
          INSERT INTO StaffPermissions (PermKey, IsAllowed)
          VALUES (?, ?)
          ON DUPLICATE KEY UPDATE IsAllowed = VALUES(IsAllowed)
        `,
        [k, p[k] ? 1 : 0]
      );
    }
  }
  return exports.getPermissions();
};
