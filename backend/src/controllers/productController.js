const productService = require('../services/productService');
const asyncHandler = require('../utils/asyncHandler');

exports.getAll = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productService.getAll(req.query) });
});

exports.lowStock = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productService.getLowStock() });
});

exports.getById = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productService.getById(req.params.id) });
});

exports.create = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await productService.create(req.body) });
});

exports.update = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productService.update(req.params.id, req.body) });
});

exports.updateStock = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await productService.updateStock(req.params.id, req.body.stockCount) });
});

exports.remove = asyncHandler(async (req, res) => {
  await productService.remove(req.params.id);
  res.json({ success: true, message: 'Đã xóa sản phẩm' });
});