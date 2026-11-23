const bcrypt = require('bcryptjs');
const userModel = require('../models/userModel');
const httpError = require('../utils/httpError');

const ROLES = ['admin', 'staff', 'user'];
const DEFAULT_PASSWORD = '123456'; // chỉ dùng khi form không gửi mật khẩu

function validate({ name, email, role }) {
  if (!name || !name.trim()) throw httpError(400, 'Tên không được để trống');
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw httpError(400, 'Email không hợp lệ');
  if (role && !ROLES.includes(role)) throw httpError(400, 'Vai trò không hợp lệ');
}

exports.getAll = () => userModel.findAll();

exports.getById = async (id) => {
  const user = await userModel.findById(id);
  if (!user) throw httpError(404, 'Không tìm thấy người dùng');
  return user;
};

exports.create = async (body) => {
  validate(body);
  const passwordHash = await bcrypt.hash(body.password || DEFAULT_PASSWORD, 10);
  return userModel.create({
    name: body.name.trim(),
    email: body.email.trim().toLowerCase(),
    passwordHash,
    role: body.role || 'user',
  });
};

exports.update = async (id, body) => {
  validate(body);
  const passwordHash = body.password ? await bcrypt.hash(body.password, 10) : null;
  const user = await userModel.update(id, {
    name: body.name.trim(),
    email: body.email.trim().toLowerCase(),
    role: body.role || 'user',
    passwordHash,
  });
  if (!user) throw httpError(404, 'Không tìm thấy người dùng');
  return user;
};

exports.remove = async (id) => {
  const ok = await userModel.remove(id);
  if (!ok) throw httpError(404, 'Không tìm thấy người dùng');
};