const settingsService = require('../services/settingsService');
const asyncHandler = require('../utils/asyncHandler');

exports.getStore = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await settingsService.getStore() });
});

exports.updateStore = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await settingsService.updateStore(req.body) });
});

exports.getPermissions = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await settingsService.getPermissions() });
});

exports.updatePermissions = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await settingsService.updatePermissions(req.body) });
});