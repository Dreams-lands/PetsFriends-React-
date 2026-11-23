const orderService = require('../services/orderService');
const asyncHandler = require('../utils/asyncHandler');

exports.getAll = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await orderService.getAll(req.query) });
});

exports.getById = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await orderService.getById(req.params.id) });
});

exports.create = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await orderService.create(req.body) });
});

exports.changeStatus = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await orderService.changeStatus(req.params.id, req.body.status) });
});