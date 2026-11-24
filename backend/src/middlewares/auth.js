const { verifyUserToken } = require('../utils/passwordAndJwt');
const httpError = require('../utils/httpError');

exports.requireAuth = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(httpError(401, 'Bạn chưa đăng nhập'));

  try {
    req.user = verifyUserToken(token);
    next();
  } catch {
    next(httpError(401, 'Phiên đăng nhập hết hạn hoặc không hợp lệ'));
  }
};

exports.requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return next(httpError(403, 'Bạn không có quyền truy cập'));
  }
  next();
};
exports.requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(httpError(403, 'Bạn không có quyền truy cập'));
  }
  next();
};