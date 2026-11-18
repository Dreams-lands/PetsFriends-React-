const express = require('express');
const router = express.Router();

const { optionalAuth, requireRole } = require('../middlewares/authMiddleware');
const { parseProductImageUpload } = require('../middlewares/uploadMiddleware');
const productController = require('../controllers/productController');

// 1. Danh mục sản phẩm (Categories)
router.get('/categories', productController.listCategories);
router.get('/categories/:code', productController.getCategoryByCode);
router.post('/categories', optionalAuth, requireRole('admin'), productController.createCategory);
router.put('/categories/:code', optionalAuth, requireRole('admin'), productController.updateCategory);
router.delete('/categories/:code', optionalAuth, requireRole('admin'), productController.deleteCategory);

// 2. Tải ảnh sản phẩm (Image Upload - đặt trước /products/:id)
router.post(
  '/upload',
  optionalAuth,
  requireRole('admin', 'staff'),
  parseProductImageUpload,
  productController.uploadProductImage
);
router.post(
  '/products/upload-image',
  optionalAuth,
  requireRole('admin', 'staff'),
  parseProductImageUpload,
  productController.uploadProductImage
);

// 3. Sản phẩm (Products - các đường dẫn tĩnh đặt TRƯỚC /products/:id)
router.get('/products', productController.listProducts);
router.get('/products/promotions', productController.listPromotionProducts);
router.get('/products/featured', productController.listFeaturedProducts);
router.get(
  '/products/low-stock',
  optionalAuth,
  requireRole('admin', 'staff'),
  productController.listLowStockProducts
);
router.get('/products/:id', productController.getProductById);
router.post('/products', optionalAuth, requireRole('admin'), productController.createProduct);
router.put('/products/:id', optionalAuth, requireRole('admin'), productController.updateProduct);
router.patch(
  '/products/:id/stock',
  optionalAuth,
  requireRole('admin', 'staff'),
  productController.adjustProductStock
);
router.patch(
  '/products/:id/restore',
  optionalAuth,
  requireRole('admin'),
  productController.restoreProduct
);
router.delete('/products/:id', optionalAuth, requireRole('admin'), productController.softDeleteProduct);

// 4. Đánh giá sản phẩm (Product Reviews)
router.get('/product-reviews', productController.listAllReviews);
router.get('/products/:id/reviews', productController.listProductReviews);
router.post('/products/:id/reviews', optionalAuth, productController.createProductReview);
router.put('/product-reviews/:reviewId', optionalAuth, productController.updateProductReview);
router.delete('/product-reviews/:reviewId', optionalAuth, productController.deleteProductReview);

module.exports = router;
