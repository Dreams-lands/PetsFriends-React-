const { sql, poolPromise } = require('../config/db');

const STORE_COLS = `StoreName AS storeName, StreetAddress AS streetAddress, District AS district, City AS city,
  Hotline AS hotline, Phone AS phone, Email AS email, ZaloUrl AS zaloUrl, FacebookUrl AS facebookUrl,
  Hours AS hours, Timezone AS timezone, Currency AS currency`;

const PERM_COLS = `OrdersManage AS ordersManage, OrdersInvoices AS ordersInvoices, Pos AS pos,
  Appointments AS appointments, InventoryView AS inventoryView, InventoryEdit AS inventoryEdit,
  Analytics AS analytics`;

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
  const r = await pool.request().query(`SELECT ${PERM_COLS} FROM StaffPermissions WHERE Id = 1`);
  return { ...r.recordset[0], settings: false }; // settings luôn khóa cho admin
};

exports.updatePermissions = async (p) => {
  const pool = await poolPromise;
  const req = pool.request();
  Object.keys(p).forEach((k) => req.input(k, sql.Bit, p[k]));
  await req.query(`UPDATE StaffPermissions SET
    OrdersManage = COALESCE(@ordersManage, OrdersManage), OrdersInvoices = COALESCE(@ordersInvoices, OrdersInvoices),
    Pos = COALESCE(@pos, Pos), Appointments = COALESCE(@appointments, Appointments),
    InventoryView = COALESCE(@inventoryView, InventoryView), InventoryEdit = COALESCE(@inventoryEdit, InventoryEdit),
    Analytics = COALESCE(@analytics, Analytics) WHERE Id = 1`);
  return exports.getPermissions();
};