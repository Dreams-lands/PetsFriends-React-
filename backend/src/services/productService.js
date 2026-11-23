const productModel = require('../models/productModel');
const httpError = require('../utils/httpError');

const CATEGORIES = ['food', 'hygiene', 'bed', 'backpack'];
const PET_TYPES = ['dog', 'cat', 'both'];

const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;

function normalize(b, id) {
  const name = (b.name || '').trim();
  if (!name) throw httpError(400, 'Tên sản phẩm không được để trống');
  if (!CATEGORIES.includes(b.category)) throw httpError(400, 'Danh mục không hợp lệ');
  if (b.petType && !PET_TYPES.includes(b.petType)) throw httpError(400, 'Loại thú cưng không hợp lệ');

  const priceNum = Number(b.priceNum);
  const stockCount = b.stockCount === undefined ? 0 : Number(b.stockCount);
  const low = b.lowStockThreshold === undefined ? 15 : Number(b.lowStockThreshold);
  const originalPrice = b.originalPrice ? Number(b.originalPrice) : null;
  if (!isNonNegInt(priceNum)) throw httpError(400, 'Giá không hợp lệ');
  if (!isNonNegInt(stockCount)) throw httpError(400, 'Tồn kho không hợp lệ');
  if (!isNonNegInt(low)) throw httpError(400, 'Ngưỡng cảnh báo không hợp lệ');
  if (originalPrice !== null && !isNonNegInt(originalPrice)) throw httpError(400, 'Giá gốc không hợp lệ');

  return {
    id,
    brand: b.brand || '',
    name,
    shortDesc: b.shortDesc || null,
    description: b.description || null,
    packSize: b.packSize || null,
    sizes: JSON.stringify(b.sizes || []),
    gallery: JSON.stringify(b.gallery || []),
    highlights: JSON.stringify(b.highlights || []),
    priceNum,
    originalPrice,
    badge: b.badge || null,
    category: b.category,
    subType: b.subType || null,
    petType: b.petType || null,
    image: b.image || null,
    stockCount,
    lowStockThreshold: low,
    isFeatured: !!b.isFeatured,
    isFlashSale: !!b.isFlashSale,
  };
}

exports.getAll = (query) => productModel.findAll({ category: query.category, search: query.search });
exports.getLowStock = () => productModel.findLowStock();

exports.getById = async (id) => {
  const p = await productModel.findById(id);
  if (!p) throw httpError(404, 'Không tìm thấy sản phẩm');
  return p;
};

exports.create = (body) => productModel.create(normalize(body, body.id || `prod-${Date.now()}`));

exports.update = async (id, body) => {
  const p = await productModel.update(id, normalize(body, id));
  if (!p) throw httpError(404, 'Không tìm thấy sản phẩm');
  return p;
};

exports.updateStock = async (id, stockCount) => {
  const n = Number(stockCount);
  if (!isNonNegInt(n)) throw httpError(400, 'Tồn kho không hợp lệ');
  const p = await productModel.updateStock(id, n);
  if (!p) throw httpError(404, 'Không tìm thấy sản phẩm');
  return p;
};

exports.remove = async (id) => {
  if (!(await productModel.remove(id))) throw httpError(404, 'Không tìm thấy sản phẩm');
};