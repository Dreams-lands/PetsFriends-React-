const bookingService = require('../services/bookingService');
const asyncHandler = require('../utils/asyncHandler');

exports.services = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await bookingService.getServices() });
});

exports.getAll = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await bookingService.getAll(req.query) });
});

exports.getById = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await bookingService.getById(req.params.id) });
});

exports.create = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await bookingService.create(req.body) });
});

exports.changeStatus = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await bookingService.changeStatus(req.params.id, req.body.status) });
});