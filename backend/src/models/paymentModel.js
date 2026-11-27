const { poolPromise } = require('../config/db');
const paymentService = require('../services/paymentService');

exports.get = async () => paymentService.getPaymentGateways({ includeSecrets: true });

exports.update = async (p) => paymentService.updatePaymentGateways(p);

exports.setOrderPayment = async (orderId, status) => {
  const pool = await poolPromise;
  const numericId = /^\d+$/.test(String(orderId)) ? Number(orderId) : -1;
  const [res] = await pool.query(
    'UPDATE Orders SET PaymentStatus = ? WHERE OrderCode = ? OR OrderId = ?',
    [status, orderId, numericId]
  );
  return res.affectedRows > 0;
};
