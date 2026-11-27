const { poolPromise } = require('../config/db');
const httpError = require('../utils/httpError');

const ORDER_COLS = `OrderCode AS id, OrderId AS orderId, CreatedAt AS createdAt, OrderStatus AS status, TotalAmount AS totalAmount,
  ShippingAddress AS shippingAddress, PaymentMethod AS paymentMethod, DeliveryMethod AS deliveryMethod,
  CustomerName AS customerName, CustomerPhone AS customerPhone, CustomerEmail AS customerEmail,
  StaffName AS staffName, IsGuest AS isGuest, PaymentStatus AS paymentStatus`;

const ITEM_COLS = `OrderId AS orderId, ProductId AS productId, ProductName AS name, ProductImage AS image,
  UnitPrice AS price, Quantity AS quantity, VariantLabel AS variant`;

const attach = (orders, items) => {
  const map = {};
  items.forEach((it) => {
    (map[it.orderId] = map[it.orderId] || []).push(it);
  });
  return orders.map((o) => ({ ...o, items: map[o.orderId] || [] }));
};

const TRANSITIONS = {
  pending: ['shipping', 'completed', 'cancelled'],
  shipping: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

exports.findAll = async ({ status, search } = {}) => {
  const pool = await poolPromise;
  const where = [];
  const params = [];
  if (status) {
    where.push('OrderStatus = ?');
    params.push(status);
  }
  if (search) {
    const q = `%${search}%`;
    where.push('(OrderCode LIKE ? OR CustomerName LIKE ? OR CustomerPhone LIKE ?)');
    params.push(q, q, q);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [orders] = await pool.query(
    `SELECT ${ORDER_COLS} FROM Orders ${w} ORDER BY CreatedAt DESC`,
    params
  );
  if (!orders.length) return [];
  const orderIds = orders.map((o) => o.orderId);
  const [items] = await pool.query(
    `SELECT ${ITEM_COLS} FROM OrderItems WHERE OrderId IN (${orderIds.map(() => '?').join(', ')}) ORDER BY OrderItemId`,
    orderIds
  );
  return attach(orders, items);
};

exports.findById = async (id) => {
  const pool = await poolPromise;
  const numericId = /^\d+$/.test(String(id)) ? Number(id) : -1;
  const [orders] = await pool.query(
    `SELECT ${ORDER_COLS} FROM Orders WHERE OrderCode = ? OR OrderId = ? LIMIT 1`,
    [id, numericId]
  );
  if (!orders[0]) return null;
  const [items] = await pool.query(
    `SELECT ${ITEM_COLS} FROM OrderItems WHERE OrderId = ? ORDER BY OrderItemId`,
    [orders[0].orderId]
  );
  return attach(orders, items)[0];
};

exports.create = async (order, items) => {
  const pool = await poolPromise;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ins] = await conn.query(
      `INSERT INTO Orders (OrderCode, TotalAmount, ShippingAddress, PaymentMethod, DeliveryMethod,
         CustomerName, CustomerPhone, CustomerEmail, StaffName, IsGuest)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order.id,
        order.totalAmount,
        order.shippingAddress,
        order.paymentMethod,
        order.deliveryMethod,
        order.customerName,
        order.customerPhone,
        order.customerEmail || null,
        order.staffName || null,
        order.isGuest ? 1 : 0,
      ]
    );

    for (const it of items) {
      // eslint-disable-next-line no-await-in-loop
      await conn.query(
        `INSERT INTO OrderItems (OrderId, ProductId, ProductName, ProductImage, UnitPrice, Quantity, VariantLabel)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          ins.insertId,
          it.productId || null,
          it.name,
          it.image,
          it.price,
          it.quantity,
          it.variant || null,
        ]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
  return exports.findById(order.id);
};

exports.changeStatus = async (id, newStatus) => {
  const pool = await poolPromise;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const numericId = /^\d+$/.test(String(id)) ? Number(id) : -1;
    const [curRows] = await conn.query(
      'SELECT OrderId, OrderStatus FROM Orders WHERE OrderCode = ? OR OrderId = ? LIMIT 1 FOR UPDATE',
      [id, numericId]
    );
    const row = curRows[0];
    if (!row) throw httpError(404, 'Không tìm thấy đơn hàng');
    if (!TRANSITIONS[row.OrderStatus].includes(newStatus)) {
      throw httpError(
        400,
        `Không thể chuyển đơn từ "${row.OrderStatus}" sang "${newStatus}"`
      );
    }

    await conn.query('UPDATE Orders SET OrderStatus = ? WHERE OrderId = ?', [
      newStatus,
      row.OrderId,
    ]);
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
  return exports.findById(id);
};
