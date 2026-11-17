const { sql, poolPromise } = require('../config/db');
const httpError = require('../utils/httpError');

const ORDER_COLS = `Id AS id, CreatedAt AS createdAt, Status AS status, TotalAmount AS totalAmount,
  ShippingAddress AS shippingAddress, PaymentMethod AS paymentMethod, DeliveryMethod AS deliveryMethod,
  CustomerName AS customerName, CustomerPhone AS customerPhone, CustomerEmail AS customerEmail,
  StaffName AS staffName, IsGuest AS isGuest, StockDeducted AS stockDeducted, PaymentStatus AS paymentStatus`;

const ITEM_COLS = `OrderId AS orderId, ProductId AS productId, Name AS name, Image AS image,
  Price AS price, Quantity AS quantity, Variant AS variant`;

const attach = (orders, items) => {
  const map = {};
  items.forEach((it) => { (map[it.orderId] = map[it.orderId] || []).push(it); });
  return orders.map((o) => ({ ...o, items: map[o.id] || [] }));
};

// Luồng trạng thái hợp lệ
const TRANSITIONS = {
  pending: ['shipping', 'completed', 'cancelled'],
  shipping: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

exports.findAll = async ({ status, search } = {}) => {
  const pool = await poolPromise;
  const req = pool.request();
  const where = [];
  if (status) { req.input('status', sql.NVarChar(20), status); where.push('Status = @status'); }
  if (search) {
    req.input('search', sql.NVarChar(200), `%${search}%`);
    where.push('(Id LIKE @search OR CustomerName LIKE @search OR CustomerPhone LIKE @search)');
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const o = await req.query(`SELECT ${ORDER_COLS} FROM Orders ${w} ORDER BY CreatedAt DESC`);
  const i = await req.query(`SELECT ${ITEM_COLS} FROM OrderItems WHERE OrderId IN (SELECT Id FROM Orders ${w}) ORDER BY Id`);
  return attach(o.recordset, i.recordset);
};

exports.findById = async (id) => {
  const pool = await poolPromise;
  const req = pool.request().input('id', sql.NVarChar(30), id);
  const o = await req.query(`SELECT ${ORDER_COLS} FROM Orders WHERE Id = @id`);
  if (!o.recordset[0]) return null;
  const i = await req.query(`SELECT ${ITEM_COLS} FROM OrderItems WHERE OrderId = @id ORDER BY Id`);
  return attach(o.recordset, i.recordset)[0];
};

exports.create = async (order, items) => {
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await new sql.Request(tx)
      .input('id', sql.NVarChar(30), order.id)
      .input('total', sql.Int, order.totalAmount)
      .input('addr', sql.NVarChar(500), order.shippingAddress)
      .input('pay', sql.NVarChar(100), order.paymentMethod)
      .input('delivery', sql.NVarChar(10), order.deliveryMethod)
      .input('cname', sql.NVarChar(100), order.customerName)
      .input('cphone', sql.NVarChar(30), order.customerPhone)
      .input('cemail', sql.NVarChar(150), order.customerEmail)
      .input('staff', sql.NVarChar(100), order.staffName)
      .input('guest', sql.Bit, order.isGuest)
      .query(`INSERT INTO Orders (Id, TotalAmount, ShippingAddress, PaymentMethod, DeliveryMethod,
                CustomerName, CustomerPhone, CustomerEmail, StaffName, IsGuest)
              VALUES (@id, @total, @addr, @pay, @delivery, @cname, @cphone, @cemail, @staff, @guest)`);

    for (const it of items) {
      await new sql.Request(tx)
        .input('oid', sql.NVarChar(30), order.id)
        .input('pid', sql.NVarChar(60), it.productId)
        .input('name', sql.NVarChar(200), it.name)
        .input('image', sql.NVarChar(500), it.image)
        .input('price', sql.Int, it.price)
        .input('qty', sql.Int, it.quantity)
        .input('variant', sql.NVarChar(100), it.variant)
        .query(`INSERT INTO OrderItems (OrderId, ProductId, Name, Image, Price, Quantity, Variant)
                VALUES (@oid, @pid, @name, @image, @price, @qty, @variant)`);
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  return exports.findById(order.id);
};

exports.changeStatus = async (id, newStatus) => {
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const cur = await new sql.Request(tx).input('id', sql.NVarChar(30), id)
      .query('SELECT Status, StockDeducted FROM Orders WITH (UPDLOCK) WHERE Id = @id');
    const row = cur.recordset[0];
    if (!row) throw httpError(404, 'Không tìm thấy đơn hàng');
    if (!TRANSITIONS[row.Status].includes(newStatus)) {
      throw httpError(400, `Không thể chuyển đơn từ "${row.Status}" sang "${newStatus}"`);
    }

    // Hoàn thành: trừ tồn kho (bỏ qua sản phẩm không có trong bảng Products)
    if (newStatus === 'completed' && !row.StockDeducted) {
      const items = await new sql.Request(tx).input('id', sql.NVarChar(30), id)
        .query('SELECT ProductId, Name, Quantity FROM OrderItems WHERE OrderId = @id AND ProductId IS NOT NULL');
      for (const it of items.recordset) {
        const r = await new sql.Request(tx)
          .input('pid', sql.NVarChar(60), it.ProductId)
          .input('qty', sql.Int, it.Quantity)
          .query('UPDATE Products SET StockCount = StockCount - @qty WHERE Id = @pid AND StockCount >= @qty');
        if (r.rowsAffected[0] === 0) {
          const ex = await new sql.Request(tx).input('pid', sql.NVarChar(60), it.ProductId)
            .query('SELECT 1 AS ok FROM Products WHERE Id = @pid');
          if (ex.recordset.length) throw httpError(400, `Không đủ tồn kho cho "${it.Name}"`);
        }
      }
    }

    await new sql.Request(tx)
      .input('id', sql.NVarChar(30), id)
      .input('status', sql.NVarChar(20), newStatus)
      .input('deducted', sql.Bit, newStatus === 'completed' ? 1 : row.StockDeducted)
      .query('UPDATE Orders SET Status = @status, StockDeducted = @deducted WHERE Id = @id');
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  return exports.findById(id);
};