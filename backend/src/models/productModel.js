const { poolPromise } = require('../config/db');
const productService = require('../services/productService');

exports.findAll = async ({ category, search } = {}) =>
  productService.listProducts({ category, search, includeInactive: 'true' });

exports.findLowStock = async () => productService.listLowStockProducts({});

exports.findById = async (id) => {
  try {
    return await productService.getProductById(id);
  } catch {
    return null;
  }
};

exports.create = async (p) => productService.createProduct(p);

exports.update = async (id, p) => {
  try {
    return await productService.updateProduct(id, p);
  } catch {
    return null;
  }
};

exports.updateStock = async (id, stockCount) => {
  try {
    return await productService.adjustProductStock(id, { stockCount });
  } catch {
    return null;
  }
};

exports.remove = async (id) => {
  const pool = await poolPromise;
  const [res] = await pool.query('DELETE FROM Products WHERE ProductId = ?', [id]);
  return res.affectedRows > 0;
};
