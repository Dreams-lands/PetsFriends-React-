const userService = require('../services/userService');

async function login(req, res) {
  try {
    const body = req.body || {};
    const identifier = body.identifier || body.email || body.username || body.phone;
    const { user, token, addresses, wishlist } = await userService.login({
      ...body,
      identifier,
    });
    return res.status(200).json({
      message: 'Đăng nhập thành công!',
      token,
      user,
      addresses,
      wishlist,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function register(req, res) {
  try {
    const { user, token, addresses } = await userService.register(req.body || {});
    return res.status(201).json({
      message: 'Đăng ký tài khoản thành công!',
      token,
      user,
      addresses,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function getMe(req, res) {
  try {
    const { user, addresses, wishlist } = await userService.getProfileMe(req.user.userId);
    return res.status(200).json({
      user,
      addresses,
      wishlist,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function changePassword(req, res) {
  try {
    await userService.changePassword(req.user.userId, req.body || {});
    return res.status(200).json({
      message: 'Đổi mật khẩu thành công!',
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

module.exports = {
  login,
  register,
  getMe,
  changePassword,
};
