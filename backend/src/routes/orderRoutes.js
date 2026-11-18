const express = require('express');
const router = express.Router();
const { optionalAuth, requireRole } = require('../middlewares/authMiddleware');
const orderController = require('../controllers/orderController');

// 1. Orders & POS Endpoints (note: /orders/lookup MUST precede /orders/:id)
router.get('/orders', optionalAuth, orderController.listOrders);
router.get('/orders/lookup', orderController.lookupGuestOrder);
router.get('/orders/:id/items', orderController.getOrderItemsByOrderId);
router.get('/orders/:id', orderController.getOrderById);
router.post('/orders', optionalAuth, orderController.createOrder);
router.patch(
  '/orders/:id/status',
  optionalAuth,
  requireRole('admin', 'staff'),
  orderController.updateOrderStatus
);
router.post('/orders/:id/cancel', optionalAuth, orderController.cancelOrder);
router.delete(
  '/orders/:id',
  optionalAuth,
  requireRole('admin'),
  orderController.deleteOrder
);

// 2. Order Items Admin/Staff Endpoint
router.get(
  '/order-items',
  optionalAuth,
  requireRole('admin', 'staff'),
  orderController.listOrderItems
);

// 3. Analytics Endpoints
router.get(
  '/analytics/overview',
  optionalAuth,
  requireRole('admin', 'staff'),
  orderController.getAnalyticsOverview
);
router.get(
  '/analytics/daily',
  optionalAuth,
  requireRole('admin', 'staff'),
  orderController.getAnalyticsDaily
);
router.get(
  '/analytics/period',
  optionalAuth,
  requireRole('admin', 'staff'),
  orderController.getAnalyticsPeriod
);

module.exports = router;
