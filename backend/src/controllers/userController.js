const userService = require('../services/userService');
const asyncHandler = require('../utils/asyncHandler');

const toId = (v) => Number.parseInt(v, 10);

exports.getAll = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await userService.getAll() });
});

exports.getById = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await userService.getById(toId(req.params.id)) });
});

exports.create = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await userService.create(req.body) });
});

exports.update = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await userService.update(toId(req.params.id), req.body) });
});

exports.remove = asyncHandler(async (req, res) => {
  await userService.remove(toId(req.params.id));
  res.json({ success: true, message: 'Đã xóa người dùng' });
});