const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');
const httpError = require('../utils/httpError');

exports.login = async ({ email, password }) => {
  if (!email || !password) throw httpError(400, 'Vui lòng nhập email và mật khẩu');

  const user = await userModel.findByEmailWithPassword(email.trim().toLowerCase());
  const ok = user && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) throw httpError(401, 'Email hoặc mật khẩu không đúng');

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  return {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
};