const authService = require('../services/authService');
const asyncHandler = require('../utils/asyncHandler');

exports.login = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await authService.login(req.body) });
});

exports.me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: req.user });
});