const paymentService = require('../services/paymentService');
const asyncHandler = require('../utils/asyncHandler');

exports.getSettings = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await paymentService.getSettings() });
});

exports.updateSettings = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await paymentService.updateSettings(req.body) });
});

exports.setOrderPayment = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await paymentService.setOrderPayment(req.params.id, req.body.paymentStatus) });
});