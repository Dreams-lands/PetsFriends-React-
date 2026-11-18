const productService = require('../services/productService');

function handleError(res, err) {
  const status = err.statusCode || 500;
  return res.status(status).json({
    message: err.message || 'Lỗi máy chủ nội bộ.',
  });
}

// ============================================================================
// 1. CATEGORIES
// ============================================================================

async function listCategories(req, res) {
  try {
    const categories = await productService.listCategories();
    return res.status(200).json(categories);
  } catch (err) {
    return handleError(res, err);
  }
}

async function getCategoryByCode(req, res) {
  try {
    const category = await productService.getCategoryByCode(req.params.code);
    return res.status(200).json(category);
  } catch (err) {
    return handleError(res, err);
  }
}

async function createCategory(req, res) {
  try {
    const created = await productService.createCategory(req.body);
    return res.status(201).json(created);
  } catch (err) {
    return handleError(res, err);
  }
}

async function updateCategory(req, res) {
  try {
    const updated = await productService.updateCategory(req.params.code, req.body);
    return res.status(200).json(updated);
  } catch (err) {
    return handleError(res, err);
  }
}

async function deleteCategory(req, res) {
  try {
    const result = await productService.deleteCategory(req.params.code);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ============================================================================
// 2. PRODUCTS
// ============================================================================

async function listProducts(req, res) {
  try {
    const items = await productService.listProducts(req.query);
    return res.status(200).json(items);
  } catch (err) {
    return handleError(res, err);
  }
}

async function listPromotionProducts(req, res) {
  try {
    const items = await productService.listPromotionProducts(req.query);
    return res.status(200).json(items);
  } catch (err) {
    return handleError(res, err);
  }
}

async function listFeaturedProducts(req, res) {
  try {
    const items = await productService.listFeaturedProducts(req.query);
    return res.status(200).json(items);
  } catch (err) {
    return handleError(res, err);
  }
}

async function listLowStockProducts(req, res) {
  try {
    const items = await productService.listLowStockProducts(req.query);
    return res.status(200).json(items);
  } catch (err) {
    return handleError(res, err);
  }
}

async function getProductById(req, res) {
  try {
    const item = await productService.getProductById(req.params.id);
    return res.status(200).json(item);
  } catch (err) {
    return handleError(res, err);
  }
}

async function createProduct(req, res) {
  try {
    const created = await productService.createProduct(req.body);
    return res.status(201).json(created);
  } catch (err) {
    return handleError(res, err);
  }
}

async function updateProduct(req, res) {
  try {
    const updated = await productService.updateProduct(req.params.id, req.body);
    return res.status(200).json(updated);
  } catch (err) {
    return handleError(res, err);
  }
}

async function adjustProductStock(req, res) {
  try {
    const updated = await productService.adjustProductStock(req.params.id, req.body);
    return res.status(200).json(updated);
  } catch (err) {
    return handleError(res, err);
  }
}

async function restoreProduct(req, res) {
  try {
    const restored = await productService.restoreProduct(req.params.id);
    return res.status(200).json(restored);
  } catch (err) {
    return handleError(res, err);
  }
}

async function softDeleteProduct(req, res) {
  try {
    const result = await productService.softDeleteProduct(req.params.id);
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ============================================================================
// 3. PRODUCT REVIEWS
// ============================================================================

async function listAllReviews(req, res) {
  try {
    const reviews = await productService.listAllReviews(req.query);
    return res.status(200).json(reviews);
  } catch (err) {
    return handleError(res, err);
  }
}

async function listProductReviews(req, res) {
  try {
    const reviews = await productService.listProductReviews(req.params.id);
    return res.status(200).json(reviews);
  } catch (err) {
    return handleError(res, err);
  }
}

async function createProductReview(req, res) {
  try {
    const created = await productService.createProductReview(
      req.params.id,
      req.body,
      req.user || null
    );
    return res.status(201).json(created);
  } catch (err) {
    return handleError(res, err);
  }
}

async function updateProductReview(req, res) {
  try {
    const updated = await productService.updateProductReview(
      req.params.reviewId,
      req.body,
      req.user || null
    );
    return res.status(200).json(updated);
  } catch (err) {
    return handleError(res, err);
  }
}

async function deleteProductReview(req, res) {
  try {
    const result = await productService.deleteProductReview(
      req.params.reviewId,
      req.user || null
    );
    return res.status(200).json(result);
  } catch (err) {
    return handleError(res, err);
  }
}

// ============================================================================
// 4. IMAGE UPLOAD
// ============================================================================

function uploadProductImage(req, res) {
  if (!req.uploadedImage) {
    return res.status(400).json({ message: 'Không tìm thấy dữ liệu ảnh đã tải lên.' });
  }

  return res.status(201).json({
    message: 'Tải ảnh sản phẩm thành công!',
    imageUrl: req.uploadedImage.imageUrl,
    filename: req.uploadedImage.filename,
  });
}

module.exports = {
  listCategories,
  getCategoryByCode,
  createCategory,
  updateCategory,
  deleteCategory,
  listProducts,
  listPromotionProducts,
  listFeaturedProducts,
  listLowStockProducts,
  getProductById,
  createProduct,
  updateProduct,
  adjustProductStock,
  restoreProduct,
  softDeleteProduct,
  listAllReviews,
  listProductReviews,
  createProductReview,
  updateProductReview,
  deleteProductReview,
  uploadProductImage,
};
