const settingsModel = require('../models/settingsModel');
const httpError = require('../utils/httpError');

// Admin luôn được qua. Staff chỉ qua khi quyền đó được bật trong ma trận phân quyền.
exports.requirePermission = (key) => async (req, res, next) => {
  try {
    if (!req.user) return next(httpError(401, 'Bạn chưa đăng nhập'));
    if (req.user.role === 'admin') return next();
    if (req.user.role === 'staff') {
      const perms = await settingsModel.getPermissions();
      if (perms[key]) return next();
    }
    next(httpError(403, 'Bạn không có quyền truy cập'));
  } catch (e) {
    next(e);
  }
};