const express = require('express');
const router = express.Router();
const { optionalAuth, requireRole } = require('../middlewares/authMiddleware');
const paymentController = require('../controllers/paymentController');

// 1. Cấu hình cổng thanh toán (COD / VNPay / MoMo)
router.get('/payment-gateways', optionalAuth, paymentController.getPaymentGateways);
router.put(
  '/payment-gateways',
  optionalAuth,
  requireRole('admin'),
  paymentController.updatePaymentGateways
);

// 2. VNPay (tạo URL thanh toán, Return URL cho trình duyệt, IPN server-to-server)
router.post('/payments/vnpay/create', optionalAuth, paymentController.createVnpayPayment);
router.get('/payments/vnpay/return', paymentController.vnpayReturn);
router.get('/payments/vnpay/ipn', paymentController.vnpayIpn);

// 3. MoMo (tạo yêu cầu thanh toán, Redirect URL, IPN)
router.post('/payments/momo/create', optionalAuth, paymentController.createMomoPayment);
router.get('/payments/momo/return', paymentController.momoReturn);
router.post('/payments/momo/ipn', paymentController.momoIpn);

// 4. Quét mã QR trực tiếp & hoàn tất giả lập Sandbox
router.get('/payments/qr-scan/:txnRef', paymentController.qrScanRedirect);

// 5. Báo cáo & lịch sử giao dịch (Admin / Staff) — đặt trước /payments/orders/:orderCode
router.get(
  '/payments/summary',
  optionalAuth,
  requireRole('admin', 'staff'),
  paymentController.getPaymentSummary
);
router.get(
  '/payments/transactions',
  optionalAuth,
  requireRole('admin', 'staff'),
  paymentController.listTransactions
);
router.post(
  '/payments/expire-unpaid',
  optionalAuth,
  requireRole('admin', 'staff'),
  paymentController.expireUnpaidOrders
);

// 6. Thanh toán theo từng đơn hàng
router.get('/payments/orders/:orderCode', optionalAuth, paymentController.getOrderPayment);
router.post(
  '/payments/orders/:orderCode/sandbox-complete',
  optionalAuth,
  paymentController.sandboxCompletePayment
);
router.post(
  '/payments/orders/:orderCode/confirm',
  optionalAuth,
  requireRole('admin', 'staff'),
  paymentController.confirmManualPayment
);
router.post(
  '/payments/orders/:orderCode/refund',
  optionalAuth,
  requireRole('admin'),
  paymentController.refundPayment
);

module.exports = router;
