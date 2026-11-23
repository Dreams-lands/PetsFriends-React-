const paymentModel = require('../models/paymentModel');
const orderModel = require('../models/orderModel');
const httpError = require('../utils/httpError');

const ENVS = ['sandbox', 'production'];
const PAY_STATUSES = ['unpaid', 'paid', 'refunded'];
const MASK = '********';

// Không bao giờ trả khóa bí mật ra ngoài
const mask = (s) => ({
  ...s,
  vnpayHashSecret: s.vnpayHashSecret ? MASK : '',
  momoAccessKey: s.momoAccessKey ? MASK : '',
  momoSecretKey: s.momoSecretKey ? MASK : '',
});

const bool = (v) => (v === undefined ? null : !!v);
const str = (v) => (v === undefined || v === null ? null : String(v).trim());
// Bỏ qua nếu client gửi lại chuỗi đã che (********)
const secret = (v) => (v === undefined || v === null || v === MASK ? null : String(v).trim());

exports.getSettings = async () => mask(await paymentModel.get());

exports.updateSettings = async (b) => {
  if (b.vnpayEnvironment && !ENVS.includes(b.vnpayEnvironment)) throw httpError(400, 'Môi trường VNPay không hợp lệ');
  if (b.momoEnvironment && !ENVS.includes(b.momoEnvironment)) throw httpError(400, 'Môi trường MoMo không hợp lệ');

  const next = await paymentModel.update({
    codEnabled: bool(b.codEnabled), codNote: str(b.codNote),
    vnpayEnabled: bool(b.vnpayEnabled), vnpayTmnCode: str(b.vnpayTmnCode),
    vnpayEnvironment: b.vnpayEnvironment || null, vnpayHashSecret: secret(b.vnpayHashSecret),
    momoEnabled: bool(b.momoEnabled), momoPartnerCode: str(b.momoPartnerCode),
    momoEnvironment: b.momoEnvironment || null,
    momoAccessKey: secret(b.momoAccessKey), momoSecretKey: secret(b.momoSecretKey),
  });
  if (!next.codEnabled && !next.vnpayEnabled && !next.momoEnabled) {
    // hoàn tác: phải còn ít nhất 1 phương thức
    await paymentModel.update({ codEnabled: true });
    throw httpError(400, 'Phải bật ít nhất một phương thức thanh toán');
  }
  return mask(next);
};

exports.setOrderPayment = async (orderId, status) => {
  if (!PAY_STATUSES.includes(status)) throw httpError(400, 'Trạng thái thanh toán không hợp lệ');
  const order = await orderModel.findById(orderId);
  if (!order) throw httpError(404, 'Không tìm thấy đơn hàng');
  if (order.status === 'cancelled' && status === 'paid') throw httpError(400, 'Đơn đã hủy không thể đánh dấu đã thanh toán');
  await paymentModel.setOrderPayment(orderId, status);
  return orderModel.findById(orderId);
};