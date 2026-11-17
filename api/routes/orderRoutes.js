const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../../api/db');
const { mapOrderRow, normalizePaymentMethodCode } = require('../../api/utils/mappers');

async function attachItemsToOrders(pool, orderRows) {
  if (orderRows.length === 0) return [];
  const itemsRes = await pool.request().query('SELECT * FROM dbo.OrderItems');
  const itemsByOrderId = {};
  for (const item of itemsRes.recordset) {
    if (!itemsByOrderId[item.OrderId]) itemsByOrderId[item.OrderId] = [];
    itemsByOrderId[item.OrderId].push(item);
  }
  return orderRows.map((ord) => mapOrderRow(ord, itemsByOrderId[ord.OrderId] || []));
}

// 1. Lấy danh sách đơn hàng (AdminOrdersView & AccountPage)
router.get('/orders', async (req, res) => {
  const { userId, status, source, search } = req.query;

  try {
    const pool = await poolPromise;
    const request = pool.request();
    let query = 'SELECT * FROM dbo.Orders WHERE 1=1';

    if (userId) {
      query += ' AND UserId = @userId';
      request.input('userId', sql.Int, Number(userId));
    }
    if (status && status !== 'all') {
      query += ' AND OrderStatus = @status';
      request.input('status', sql.NVarChar(20), String(status));
    }
    if (source && source !== 'all') {
      query += ' AND OrderSource = @source';
      request.input('source', sql.NVarChar(20), String(source));
    }
    if (search && String(search).trim()) {
      query += ' AND (OrderCode LIKE @q OR CustomerName LIKE @q OR CustomerPhone LIKE @q)';
      request.input('q', sql.NVarChar(150), `%${String(search).trim()}%`);
    }

    query += ' ORDER BY CreatedAt DESC';
    const orderRes = await request.query(query);
    const fullOrders = await attachItemsToOrders(pool, orderRes.recordset);
    res.status(200).json(fullOrders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 2. Tra cứu đơn hàng cho Khách vãng lai (SĐT + Mã đơn hàng)
router.get('/orders/lookup', async (req, res) => {
  const cleanPhone = String(req.query.phone || '').replace(/\D/g, '');
  const cleanCode = String(req.query.orderCode || req.query.code || '')
    .trim()
    .replace(/^#/, '')
    .toUpperCase();

  if (!cleanPhone || !cleanCode) {
    return res.status(400).json({
      message: 'Vui lòng nhập đầy đủ số điện thoại và mã đơn hàng để tra cứu.',
    });
  }

  try {
    const pool = await poolPromise;
    const orderRes = await pool
      .request()
      .input('cleanPhone', sql.NVarChar(30), cleanPhone)
      .input('cleanCode', sql.NVarChar(20), cleanCode)
      .query(`
        SELECT TOP 1 *
        FROM dbo.Orders
        WHERE UPPER(OrderCode) = @cleanCode
          AND REPLACE(REPLACE(CustomerPhone, ' ', ''), '.', '') = @cleanPhone
      `);

    if (orderRes.recordset.length === 0) {
      return res.status(404).json({
        message: 'Không tìm thấy đơn hàng khớp với Số điện thoại và Mã đơn hàng này.',
      });
    }

    const [mapped] = await attachItemsToOrders(pool, orderRes.recordset);
    res.status(200).json(mapped);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 3. Chi tiết 1 đơn hàng (hỗ trợ cả OrderCode như PH261116 hoặc OrderId số)
router.get('/orders/:id', async (req, res) => {
  const idParam = String(req.params.id).trim().replace(/^#/, '');

  try {
    const pool = await poolPromise;
    const orderRes = await pool
      .request()
      .input('code', sql.NVarChar(20), idParam)
      .query(`
        SELECT TOP 1 *
        FROM dbo.Orders
        WHERE OrderCode = @code OR OrderId = TRY_CAST(@code AS INT)
      `);

    if (orderRes.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    const [mapped] = await attachItemsToOrders(pool, orderRes.recordset);
    res.status(200).json(mapped);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 4. Tạo đơn hàng mới (Online Checkout & Bán tại quầy POS)
router.post('/orders', async (req, res) => {
  const body = req.body;
  const items = Array.isArray(body.items) ? body.items : [];

  if (items.length === 0) {
    return res.status(400).json({ message: 'Giỏ hàng trống, không thể tạo đơn hàng.' });
  }

  const customerName = String(body.customerName || 'Khách vãng lai').trim();
  const customerPhone = String(body.customerPhone || '').trim();
  const shippingAddress = String(body.shippingAddress || 'Nhận tại cửa hàng Quận 1').trim();

  if (!customerPhone) {
    return res.status(400).json({ message: 'Số điện thoại liên hệ là bắt buộc.' });
  }

  const deliveryMethod = body.deliveryMethod === 'pickup' ? 'pickup' : 'delivery';
  const paymentCode = normalizePaymentMethodCode(body.paymentMethod);
  const orderSource = body.orderSource === 'pos' ? 'pos' : 'online';
  const initialStatus =
    orderSource === 'pos' || body.status === 'completed' ? 'completed' : 'pending';

  const computedTotal = items.reduce(
    (sum, it) => sum + Number(it.price ?? it.unitPrice ?? 0) * Number(it.quantity ?? 1),
    0
  );
  const totalAmount = Number(body.totalAmount ?? computedTotal);
  const requestedCode = String(body.id || body.orderCode || '')
    .trim()
    .replace(/^#/, '');
  const orderCode =
    requestedCode || `PH${Math.floor(100000 + Math.random() * 899999)}`;

  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const orderInsert = await new sql.Request(transaction)
      .input('orderCode', sql.NVarChar(20), orderCode)
      .input('userId', sql.Int, body.userId ? Number(body.userId) : null)
      .input('isGuest', sql.Bit, body.userId ? 0 : body.isGuest === false ? 0 : 1)
      .input('customerName', sql.NVarChar(120), customerName)
      .input('customerPhone', sql.NVarChar(20), customerPhone)
      .input('customerEmail', sql.NVarChar(150), body.customerEmail || null)
      .input('deliveryMethod', sql.NVarChar(20), deliveryMethod)
      .input('shippingAddress', sql.NVarChar(350), shippingAddress)
      .input('paymentMethod', sql.NVarChar(20), paymentCode)
      .input('orderStatus', sql.NVarChar(20), initialStatus)
      .input('orderSource', sql.NVarChar(20), orderSource)
      .input('totalAmount', sql.Decimal(18, 0), totalAmount)
      .input('staffName', sql.NVarChar(120), body.staffName || null)
      .query(`
        INSERT INTO dbo.Orders (
          OrderCode, UserId, IsGuest, CustomerName, CustomerPhone, CustomerEmail,
          DeliveryMethod, ShippingAddress, PaymentMethod, OrderStatus, OrderSource,
          TotalAmount, StaffName
        )
        OUTPUT INSERTED.*
        VALUES (
          @orderCode, @userId, @isGuest, @customerName, @customerPhone, @customerEmail,
          @deliveryMethod, @shippingAddress, @paymentMethod, @orderStatus, @orderSource,
          @totalAmount, @staffName
        )
      `);

    const createdOrderRow = orderInsert.recordset[0];
    const insertedItems = [];

    for (const item of items) {
      const rawProdId = String(item.productId || item.id || '').trim();
      const qty = Math.max(1, Number(item.quantity || 1));
      const unitPrice = Number(item.unitPrice ?? item.price ?? 0);
      const prodName = String(item.productName || item.name || 'Sản phẩm PetsFriend').trim();
      const prodImage = String(item.productImage || item.image || '/images/prod-ceramic-bowl.jpg').trim();
      const variantLabel = String(item.variantLabel || item.variant || item.desc || 'Tiêu chuẩn').trim();

      let validProductId = null;
      if (rawProdId) {
        const checkProd = await new sql.Request(transaction)
          .input('pid', sql.NVarChar(60), rawProdId)
          .query('SELECT ProductId FROM dbo.Products WHERE ProductId = @pid');
        if (checkProd.recordset.length > 0) {
          validProductId = rawProdId;
        }
      }

      const itemInsert = await new sql.Request(transaction)
        .input('orderId', sql.Int, createdOrderRow.OrderId)
        .input('productId', sql.NVarChar(60), validProductId)
        .input('productName', sql.NVarChar(200), prodName)
        .input('productImage', sql.NVarChar(500), prodImage)
        .input('variantLabel', sql.NVarChar(100), variantLabel)
        .input('unitPrice', sql.Decimal(18, 0), unitPrice)
        .input('quantity', sql.Int, qty)
        .query(`
          INSERT INTO dbo.OrderItems (
            OrderId, ProductId, ProductName, ProductImage, VariantLabel, UnitPrice, Quantity
          )
          OUTPUT INSERTED.*
          VALUES (
            @orderId, @productId, @productName, @productImage, @variantLabel, @unitPrice, @quantity
          )
        `);

      insertedItems.push(itemInsert.recordset[0]);

      if (validProductId) {
        await new sql.Request(transaction)
          .input('pid', sql.NVarChar(60), validProductId)
          .input('qty', sql.Int, qty)
          .query(`
            UPDATE dbo.Products
            SET StockCount = CASE WHEN StockCount >= @qty THEN StockCount - @qty ELSE 0 END
            WHERE ProductId = @pid
          `);
      }
    }

    await transaction.commit();
    res.status(201).json({
      message: 'Tạo đơn hàng thành công!',
      order: mapOrderRow(createdOrderRow, insertedItems),
    });
  } catch (err) {
    await transaction.rollback();
    res.status(500).json({ message: err.message });
  }
});

// 5. Cập nhật trạng thái đơn hàng (kèm tự động hoàn kho nếu chuyển sang Đã hủy)
router.patch('/orders/:id/status', async (req, res) => {
  const idParam = String(req.params.id).trim().replace(/^#/, '');
  const nextStatus = String(req.body.status || req.body.orderStatus || '').trim();
  const staffName = req.body.staffName ? String(req.body.staffName).trim() : null;

  if (!['pending', 'shipping', 'completed', 'cancelled'].includes(nextStatus)) {
    return res.status(400).json({ message: 'Trạng thái đơn hàng không hợp lệ.' });
  }

  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const existingRes = await new sql.Request(transaction)
      .input('code', sql.NVarChar(20), idParam)
      .query(`
        SELECT TOP 1 *
        FROM dbo.Orders
        WHERE OrderCode = @code OR OrderId = TRY_CAST(@code AS INT)
      `);

    if (existingRes.recordset.length === 0) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    const prevOrder = existingRes.recordset[0];

    const updatedRes = await new sql.Request(transaction)
      .input('orderId', sql.Int, prevOrder.OrderId)
      .input('nextStatus', sql.NVarChar(20), nextStatus)
      .input('staffName', sql.NVarChar(120), staffName)
      .query(`
        UPDATE dbo.Orders
        SET OrderStatus = @nextStatus,
            StaffName = COALESCE(@staffName, StaffName)
        OUTPUT INSERTED.*
        WHERE OrderId = @orderId
      `);

    const itemsRes = await new sql.Request(transaction)
      .input('orderId', sql.Int, prevOrder.OrderId)
      .query('SELECT * FROM dbo.OrderItems WHERE OrderId = @orderId');

    if (prevOrder.OrderStatus !== 'cancelled' && nextStatus === 'cancelled') {
      for (const it of itemsRes.recordset) {
        if (it.ProductId) {
          await new sql.Request(transaction)
            .input('pid', sql.NVarChar(60), it.ProductId)
            .input('qty', sql.Int, it.Quantity)
            .query('UPDATE dbo.Products SET StockCount = StockCount + @qty WHERE ProductId = @pid');
        }
      }
    }

    await transaction.commit();
    res.status(200).json(mapOrderRow(updatedRes.recordset[0], itemsRes.recordset));
  } catch (err) {
    await transaction.rollback();
    res.status(500).json({ message: err.message });
  }
});

// 6. Chi tiết toàn bộ OrderItems
router.get('/order-items', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM dbo.OrderItems ORDER BY OrderItemId DESC');
    res.status(200).json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 7. Thống kê tổng quan & doanh thu cho AdminOverviewView / AdminAnalyticsView
router.get('/analytics/overview', async (req, res) => {
  try {
    const pool = await poolPromise;
    const [orderStats, bookingStats, lowStockStats, monthlyTrend] = await Promise.all([
      pool.request().query(`
        SELECT
          COUNT(*) AS totalOrders,
          SUM(CASE WHEN OrderStatus = N'pending' THEN 1 ELSE 0 END) AS pendingOrders,
          SUM(CASE WHEN OrderStatus = N'completed' THEN 1 ELSE 0 END) AS completedOrders,
          SUM(CASE WHEN OrderStatus <> N'cancelled' AND PaymentMethod IN (N'vnpay', N'momo') THEN TotalAmount ELSE 0 END) AS transferRevenue,
          SUM(CASE WHEN OrderStatus <> N'cancelled' AND PaymentMethod = N'cod' THEN TotalAmount ELSE 0 END) AS cashRevenue,
          SUM(CASE WHEN OrderStatus = N'completed' THEN TotalAmount ELSE 0 END) AS collectedRevenue
        FROM dbo.Orders
      `),
      pool.request().query(`
        SELECT
          COUNT(*) AS totalBookings,
          SUM(CASE WHEN Status = N'upcoming' THEN 1 ELSE 0 END) AS upcomingBookings,
          SUM(CASE WHEN Status = N'completed' THEN Price ELSE 0 END) AS spaRevenue
        FROM dbo.ServiceBookings
      `),
      pool.request().query(`
        SELECT COUNT(*) AS lowStockCount
        FROM dbo.Products
        WHERE IsActive = 1 AND StockCount <= 15
      `),
      pool.request().query(`
        SELECT
          MONTH(CreatedAt) AS monthNum,
          COUNT(*) AS orders,
          SUM(CASE WHEN PaymentMethod IN (N'vnpay', N'momo') THEN TotalAmount ELSE 0 END) AS transfer,
          SUM(CASE WHEN PaymentMethod = N'cod' THEN TotalAmount ELSE 0 END) AS cash,
          SUM(TotalAmount) AS revenue
        FROM dbo.Orders
        WHERE OrderStatus <> N'cancelled' AND YEAR(CreatedAt) = YEAR(SYSUTCDATETIME())
        GROUP BY MONTH(CreatedAt)
        ORDER BY monthNum ASC
      `),
    ]);

    res.status(200).json({
      orders: orderStats.recordset[0],
      bookings: bookingStats.recordset[0],
      lowStockCount: lowStockStats.recordset[0].lowStockCount,
      monthlyTrend: monthlyTrend.recordset,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;