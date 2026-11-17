const { verifyUserToken } = require('../utils/passwordAndJwt');

function extractBearerToken(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }
  const match = authHeader.trim().match(/^Bearer\s+(.+)$/i);
  return match && match[1] ? match[1].trim() : null;
}

function verifyToken(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Vui lòng đăng nhập để tiếp tục.' });
  }
  try {
    req.user = verifyUserToken(token);
    return next();
  } catch (err) {
    return res.status(401).json({
      message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
    });
  }
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (!authHeader || !String(authHeader).trim()) {
    req.user = null;
    return next();
  }

  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({
      message: 'Định dạng Authorization header không hợp lệ (yêu cầu Bearer token).',
    });
  }

  try {
    req.user = verifyUserToken(token);
    return next();
  } catch (err) {
    return res.status(401).json({
      message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
    });
  }
}

function requireRole(...roles) {
  const allowedRoles = roles.flat();
  return (req, res, next) => {
    if (req.user) {
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          message: 'Bạn không có quyền thực hiện thao tác này.',
        });
      }
      return next();
    }
    if (process.env.STRICT_AUTH === 'true') {
      return res.status(401).json({ message: 'Vui lòng đăng nhập.' });
    }
    return next();
  };
}

function requireSelfOrAdmin(paramName = 'id') {
  return (req, res, next) => {
    if (req.user) {
      if (
        req.user.role !== 'admin' &&
        Number(req.user.userId) !== Number(req.params[paramName])
      ) {
        return res.status(403).json({
          message: 'Bạn chỉ có thể thao tác trên tài khoản của chính mình.',
        });
      }
      return next();
    }
    if (process.env.STRICT_AUTH === 'true') {
      return res.status(401).json({ message: 'Vui lòng đăng nhập.' });
    }
    return next();
  };
}

module.exports = {
  extractBearerToken,
  verifyToken,
  optionalAuth,
  requireRole,
  requireSelfOrAdmin,
};
