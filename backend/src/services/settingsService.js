const settingsModel = require('../models/settingsModel');
const httpError = require('../utils/httpError');

const STORE_FIELDS = ['storeName', 'streetAddress', 'district', 'city', 'hotline', 'phone',
  'email', 'zaloUrl', 'facebookUrl', 'hours', 'timezone', 'currency'];
const PERM_KEYS = ['ordersManage', 'ordersInvoices', 'pos', 'appointments', 'inventoryView', 'inventoryEdit', 'analytics'];

exports.getStore = () => settingsModel.getStore();

exports.updateStore = (b) => {
  const s = {};
  STORE_FIELDS.forEach((f) => { s[f] = b[f] === undefined || b[f] === null ? null : String(b[f]).trim(); });
  if (s.storeName !== null && !s.storeName) throw httpError(400, 'Tên cửa hàng không được để trống');
  if (s.email && !/^\S+@\S+\.\S+$/.test(s.email)) throw httpError(400, 'Email không hợp lệ');
  return settingsModel.updateStore(s);
};

exports.getPermissions = () => settingsModel.getPermissions();

exports.updatePermissions = (b) => {
  if (b.settings === true) throw httpError(400, 'Quyền Hệ thống chỉ dành cho admin, không thể cấp cho staff');
  const p = {};
  PERM_KEYS.forEach((k) => { p[k] = b[k] === undefined ? null : !!b[k]; });
  return settingsModel.updatePermissions(p);
};