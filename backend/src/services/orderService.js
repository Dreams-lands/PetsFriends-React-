const orderModel = require('../models/orderModel');
const productModel = require('../models/productModel');
const httpError = require('../utils/httpError');

const STATUSES = ['pending', 'shipping', 'completed', 'cancelled'];
const DELIVERY = ['delivery', 'pickup'];

const newOrderId = () => {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const rnd = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `PH${yy}${mm}${dd}${rnd}`;
};

exports.getAll = (query) => {
  if (query.status && !STATUSES.includes(query.status)) throw httpError(400, 'Trạng thái không hợp lệ');
  return orderModel.findAll({ status: query.status, search: query.search });
};

exports.getById = async (id) => {
  const o = await orderModel.findById(id);
  if (!o) throw httpError(404, 'Không tìm thấy đơn hàng');
  return o;
};

exports.create = async (b) => {
  const customerName = (b.customerName || '').trim();
  const paymentMethod = (b.paymentMethod || '').trim();
  const deliveryMethod = b.deliveryMethod || 'pickup';
  if (!customerName) throw httpError(400, 'Tên khách hàng không được để trống');
  if (!paymentMethod) throw httpError(400, 'Thiếu phương thức thanh toán');
  if (!DELIVERY.includes(deliveryMethod)) throw httpError(400, 'Hình thức nhận hàng không hợp lệ');
  if (deliveryMethod === 'delivery' && !(b.shippingAddress || '').trim()) {
    throw httpError(400, 'Đơn giao hàng cần có địa chỉ');
  }
  if (!Array.isArray(b.items) || b.items.length === 0) throw httpError(400, 'Đơn hàng phải có ít nhất 1 sản phẩm');

  // Lấy giá, tên, ảnh từ database (không tin giá client gửi)
  const items = [];
  let total = 0;
  for (const it of b.items) {
    const qty = Number(it.quantity);
    if (!Number.isInteger(qty) || qty <= 0) throw httpError(400, 'Số lượng không hợp lệ');
    const p = await productModel.findById(it.productId);
    if (!p) throw httpError(400, `Không tìm thấy sản phẩm ${it.productId}`);
    if (p.stockCount < qty) throw httpError(400, `Không đủ tồn kho cho "${p.name}" (còn ${p.stockCount})`);
    items.push({ productId: p.id, name: p.name, image: p.image, price: p.priceNum, quantity: qty, variant: it.variant || null });
    total += p.priceNum * qty;
  }

  return orderModel.create({
    id: newOrderId(),
    totalAmount: total,
    shippingAddress: b.shippingAddress || null,
    paymentMethod,
    deliveryMethod,
    customerName,
    customerPhone: b.customerPhone || null,
    customerEmail: b.customerEmail || null,
    staffName: b.staffName || null,
    isGuest: b.isGuest === undefined ? true : !!b.isGuest,
  }, items);
};

exports.changeStatus = (id, status) => {
  if (!STATUSES.includes(status)) throw httpError(400, 'Trạng thái không hợp lệ');
  return orderModel.changeStatus(id, status);
};