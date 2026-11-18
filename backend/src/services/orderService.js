const { sql, poolPromise } = require('../../../api/db');
const {
  mapOrderRow,
  mapProductRow,
  normalizePaymentMethodCode,
  normalizePhoneDigits,
} = require('../utils/mappers');
const { AppError } = require('../services/userService');

const VALID_ORDER_STATUSES = ['pending', 'shipping', 'completed', 'cancelled'];

function cleanPhone(raw) {
  if (typeof normalizePhoneDigits === 'function') {
    return normalizePhoneDigits(raw);
  }
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length >= 11) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

function sqlNormalizedPhone(columnName = 'CustomerPhone') {
  const stripped = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(${columnName}, ''), '+84', '0'), ' ', ''), '.', ''), '-', ''), '(', ''), ')', '')`;
  return `(CASE WHEN LEFT(${stripped}, 2) = '84' AND LEN(${stripped}) >= 11 THEN '0' + SUBSTRING(${stripped}, 3, 50) ELSE ${stripped} END)`;
}

function isValidIsoDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function isValidHhMm(str) {
  if (typeof str !== 'string' || !/^\d{2}:\d{2}$/.test(str)) return false;
  const [hh, mm] = str.split(':').map(Number);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

function aggregateQuantitiesByProductId(itemRows = []) {
  const map = new Map();
  for (const it of itemRows) {
    if (it.ProductId) {
      const pid = String(it.ProductId);
      const qty = Number(it.Quantity || 0);
      if (qty > 0) {
        map.set(pid, (map.get(pid) || 0) + qty);
      }
    }
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Đồng bộ trạng thái thanh toán khi đơn hàng đổi trạng thái (chạy trong cùng SQL Transaction,
 * TRƯỚC câu lệnh UPDATE OrderStatus để OUTPUT INSERTED.* trả về dữ liệu mới nhất):
 *  - Hủy đơn đã thu tiền         -> PaymentStatus = refunded, giao dịch success -> refunded
 *  - Giao thành công đơn COD     -> PaymentStatus = paid + ghi giao dịch thu tiền COD
 *  - Mở lại đơn đã hoàn tiền     -> PaymentStatus = unpaid (cần thu tiền lại)
 */
async function syncPaymentOnStatusChange(transaction, order, nextStatus, actorName = null) {
  const currentPs = order.PaymentStatus || 'unpaid';

  if (nextStatus === 'cancelled' && order.OrderStatus !== 'cancelled' && currentPs === 'paid') {
    await new sql.Request(transaction)
      .input('orderId', sql.Int, order.OrderId)
      .query(`
        UPDATE dbo.Orders SET PaymentStatus = N'refunded' WHERE OrderId = @orderId;
        UPDATE dbo.PaymentTransactions
        SET Status = N'refunded',
            Note = LEFT(CONCAT(ISNULL(Note, N''), N' | Hoàn tiền do hủy đơn hàng'), 400),
            UpdatedAt = SYSUTCDATETIME()
        WHERE OrderId = @orderId AND Status = N'success';
      `);
    return;
  }

  if (nextStatus === 'completed' && order.PaymentMethod === 'cod' && currentPs !== 'paid') {
    await new sql.Request(transaction)
      .input('orderId', sql.Int, order.OrderId)
      .input('txnRef', sql.NVarChar(60), `${order.OrderCode}-COD-${Date.now()}`)
      .input('amount', sql.Decimal(18, 0), Number(order.TotalAmount || 0))
      .input('createdBy', sql.NVarChar(120), actorName)
      .query(`
        UPDATE dbo.Orders
        SET PaymentStatus = N'paid', PaidAt = SYSUTCDATETIME()
        WHERE OrderId = @orderId;
        INSERT INTO dbo.PaymentTransactions (OrderId, TxnRef, Gateway, Amount, Status, ResponseCode, Note, CreatedBy)
        VALUES (@orderId, @txnRef, N'cod', @amount, N'success', N'00', N'Thu tiền COD khi giao hàng thành công', @createdBy);
      `);
    return;
  }

  if (order.OrderStatus === 'cancelled' && nextStatus !== 'cancelled' && currentPs === 'refunded') {
    await new sql.Request(transaction)
      .input('orderId', sql.Int, order.OrderId)
      .query(`
        UPDATE dbo.Orders SET PaymentStatus = N'unpaid', PaidAt = NULL WHERE OrderId = @orderId;
      `);
  }
}

async function attachItemsToOrders(pool, orderRows) {
  if (!Array.isArray(orderRows) || orderRows.length === 0) return [];

  const orderIds = [
    ...new Set(
      orderRows
        .map((ord) => Number(ord.OrderId))
        .filter((id) => Number.isInteger(id))
    ),
  ];

  if (orderIds.length === 0) {
    return orderRows.map((ord) => mapOrderRow(ord, []));
  }

  const itemsByOrderId = {};
  const chunkSize = 1000;

  for (let offset = 0; offset < orderIds.length; offset += chunkSize) {
    const chunk = orderIds.slice(offset, offset + chunkSize);
    const req = pool.request();
    const placeholders = chunk.map((id, idx) => {
      const paramName = `oid${idx}`;
      req.input(paramName, sql.Int, id);
      return `@${paramName}`;
    });

    const itemsRes = await req.query(`
      SELECT *
      FROM dbo.OrderItems
      WHERE OrderId IN (${placeholders.join(', ')})
      ORDER BY OrderItemId ASC
    `);

    for (const item of itemsRes.recordset) {
      if (!itemsByOrderId[item.OrderId]) itemsByOrderId[item.OrderId] = [];
      itemsByOrderId[item.OrderId].push(item);
    }
  }

  return orderRows.map((ord) =>
    mapOrderRow(ord, itemsByOrderId[ord.OrderId] || [])
  );
}

async function listOrders(filters = {}) {
  const {
    userId,
    status,
    source,
    orderSource,
    paymentMethod,
    staffName,
    fromDate,
    toDate,
    search,
  } = filters;

  const pool = await poolPromise;
  const request = pool.request();
  let query = 'SELECT * FROM dbo.Orders WHERE 1=1';

  if (userId !== undefined && userId !== null && String(userId).trim() !== '') {
    const parsedUserId = Number(userId);
    if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
      throw new AppError('Mã người dùng (userId) không hợp lệ.', 400);
    }
    query += ' AND UserId = @userId';
    request.input('userId', sql.Int, parsedUserId);
  }

  if (status && String(status).trim() && String(status).trim() !== 'all') {
    query += ' AND OrderStatus = @status';
    request.input('status', sql.NVarChar(20), String(status).trim());
  }

  const resolvedSource = source || orderSource;
  if (
    resolvedSource &&
    String(resolvedSource).trim() &&
    String(resolvedSource).trim() !== 'all'
  ) {
    query += ' AND OrderSource = @source';
    request.input('source', sql.NVarChar(20), String(resolvedSource).trim());
  }

  if (
    paymentMethod &&
    String(paymentMethod).trim() &&
    String(paymentMethod).trim() !== 'all'
  ) {
    const rawPm = String(paymentMethod).trim().toLowerCase();
    const pmCode = rawPm.includes('vnpay')
      ? 'vnpay'
      : rawPm.includes('momo')
        ? 'momo'
        : rawPm === 'cod' || rawPm.includes('cod') || rawPm.includes('tiền mặt')
          ? 'cod'
          : rawPm;
    query += ' AND PaymentMethod = @paymentMethod';
    request.input('paymentMethod', sql.NVarChar(20), pmCode);
  }

  if (
    staffName &&
    String(staffName).trim() &&
    String(staffName).trim() !== 'all'
  ) {
    query += ' AND StaffName = @staffName';
    request.input('staffName', sql.NVarChar(120), String(staffName).trim());
  }

  if (fromDate && String(fromDate).trim()) {
    const fromIso = String(fromDate).trim().slice(0, 10);
    if (!isValidIsoDate(fromIso)) {
      throw new AppError(
        'Ngày bắt đầu (fromDate) không hợp lệ. Vui lòng dùng định dạng YYYY-MM-DD.',
        400
      );
    }
    query += ' AND CAST(CreatedAt AS DATE) >= CAST(@fromDate AS DATE)';
    request.input('fromDate', sql.VarChar(10), fromIso);
  }

  if (toDate && String(toDate).trim()) {
    const toIso = String(toDate).trim().slice(0, 10);
    if (!isValidIsoDate(toIso)) {
      throw new AppError(
        'Ngày kết thúc (toDate) không hợp lệ. Vui lòng dùng định dạng YYYY-MM-DD.',
        400
      );
    }
    query += ' AND CAST(CreatedAt AS DATE) <= CAST(@toDate AS DATE)';
    request.input('toDate', sql.VarChar(10), toIso);
  }

  if (search && String(search).trim()) {
    const rawSearch = String(search).trim();
    const cleanCodeSearch = rawSearch.replace(/^#/, '');
    const phoneDigits = cleanPhone(rawSearch);

    request.input('qRaw', sql.NVarChar(150), `%${rawSearch}%`);
    request.input('qCode', sql.NVarChar(150), `%${cleanCodeSearch}%`);

    if (phoneDigits.length > 0) {
      request.input('qPhone', sql.NVarChar(50), `%${phoneDigits}%`);
      query += ` AND (OrderCode LIKE @qCode OR CustomerName LIKE @qRaw OR CustomerPhone LIKE @qRaw OR ${sqlNormalizedPhone('CustomerPhone')} LIKE @qPhone)`;
    } else {
      query +=
        ' AND (OrderCode LIKE @qCode OR CustomerName LIKE @qRaw OR CustomerPhone LIKE @qRaw)';
    }
  }

  query += ' ORDER BY CreatedAt DESC, OrderId DESC';
  const orderRes = await request.query(query);
  return attachItemsToOrders(pool, orderRes.recordset);
}

async function lookupGuestOrder({ phone, orderCode, code } = {}) {
  const cleanPhoneVal = cleanPhone(phone);
  const cleanCodeVal = String(orderCode || code || '')
    .trim()
    .replace(/^#/, '')
    .toUpperCase();

  if (!cleanPhoneVal || !cleanCodeVal) {
    throw new AppError(
      'Vui lòng nhập đầy đủ số điện thoại và mã đơn hàng để tra cứu.',
      400
    );
  }

  const pool = await poolPromise;
  const orderRes = await pool
    .request()
    .input('cleanPhone', sql.NVarChar(30), cleanPhoneVal)
    .input('cleanCode', sql.NVarChar(30), cleanCodeVal)
    .query(`
      SELECT TOP 1 *
      FROM dbo.Orders
      WHERE UPPER(OrderCode) = @cleanCode
        AND ${sqlNormalizedPhone('CustomerPhone')} = @cleanPhone
    `);

  if (orderRes.recordset.length === 0) {
    throw new AppError(
      'Không tìm thấy đơn hàng khớp với Số điện thoại và Mã đơn hàng này.',
      404
    );
  }

  const [mapped] = await attachItemsToOrders(pool, orderRes.recordset);
  return mapped;
}

async function getOrderById(idOrCode) {
  const idParam = String(idOrCode || '')
    .trim()
    .replace(/^#/, '');

  if (!idParam) {
    throw new AppError('Mã đơn hàng không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const orderRes = await pool
    .request()
    .input('code', sql.NVarChar(60), idParam)
    .query(`
      SELECT TOP 1 *
      FROM dbo.Orders
      WHERE UPPER(OrderCode) = UPPER(@code)
         OR OrderId = TRY_CAST(@code AS INT)
    `);

  if (orderRes.recordset.length === 0) {
    throw new AppError('Không tìm thấy đơn hàng.', 404);
  }

  const [mapped] = await attachItemsToOrders(pool, orderRes.recordset);
  return mapped;
}

async function getOrderItemsByOrderId(idOrCode) {
  const order = await getOrderById(idOrCode);
  return order.items;
}

async function createOrder(body = {}) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    throw new AppError('Giỏ hàng trống, không thể tạo đơn hàng.', 400);
  }

  const rawCustomerPhone = String(body.customerPhone || '').trim();
  const normalizedPhone = cleanPhone(rawCustomerPhone);
  if (normalizedPhone.length < 8) {
    throw new AppError(
      'Số điện thoại liên hệ không hợp lệ (tối thiểu 8 chữ số).',
      400
    );
  }
  const storedCustomerPhone =
    rawCustomerPhone.length <= 20
      ? rawCustomerPhone
      : normalizedPhone.slice(0, 20);

  const deliveryMethod = body.deliveryMethod === 'pickup' ? 'pickup' : 'delivery';
  let shippingAddress = String(body.shippingAddress ?? '').trim();
  if (deliveryMethod === 'delivery' && !shippingAddress) {
    throw new AppError(
      'Vui lòng nhập địa chỉ giao hàng đối với đơn giao tận nơi.',
      400
    );
  }
  if (deliveryMethod === 'pickup' && !shippingAddress) {
    shippingAddress = 'Nhận tại cửa hàng Quận 1';
  }

  const customerName =
    String(body.customerName || 'Khách vãng lai').trim() || 'Khách vãng lai';
  const customerEmail = body.customerEmail
    ? String(body.customerEmail).trim()
    : null;
  const paymentCode = normalizePaymentMethodCode(body.paymentMethod);
  const orderSource = body.orderSource === 'pos' ? 'pos' : 'online';
  const requestedStatus = String(body.status || body.orderStatus || '').trim();
  const initialStatus = ['pending', 'shipping', 'completed'].includes(
    requestedStatus
  )
    ? requestedStatus
    : orderSource === 'pos'
      ? 'completed'
      : 'pending';
  const staffName = body.staffName ? String(body.staffName).trim() : null;

  const requestedCode = String(body.id || body.orderCode || '')
    .trim()
    .replace(/^#/, '');
  if (requestedCode.length > 20) {
    throw new AppError('Mã đơn hàng không được vượt quá 20 ký tự.', 400);
  }

  // Validate item quantities upfront before opening SQL transaction
  for (const item of items) {
    const qty = Number(item?.quantity ?? 1);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new AppError(
        'Số lượng sản phẩm trong đơn hàng phải là số nguyên dương.',
        400
      );
    }
  }

  const pool = await poolPromise;

  // Online checkout: chặn phương thức thanh toán đang bị Admin tắt trong PaymentGatewayConfigs
  if (orderSource === 'online') {
    const gwRes = await pool
      .request()
      .input('gw', sql.NVarChar(20), paymentCode)
      .query('SELECT TOP 1 DisplayName, IsEnabled FROM dbo.PaymentGatewayConfigs WHERE Gateway = @gw');
    const gwRow = gwRes.recordset[0];
    if (gwRow && !gwRow.IsEnabled) {
      throw new AppError(
        `Phương thức thanh toán "${gwRow.DisplayName}" hiện đang tạm ngưng. Vui lòng chọn phương thức khác.`,
        400
      );
    }
  }

  // POS tại quầy: thu tiền ngay -> đã thanh toán. Online: chờ thu tiền (COD) hoặc chờ cổng VNPay/MoMo.
  const initialPaymentStatus = orderSource === 'pos' ? 'paid' : 'unpaid';
  let resolvedUserId = null;
  if (
    body.userId !== undefined &&
    body.userId !== null &&
    String(body.userId).trim() !== ''
  ) {
    const candidateUid = Number(body.userId);
    if (Number.isInteger(candidateUid) && candidateUid > 0) {
      const userCheck = await pool
        .request()
        .input('uid', sql.Int, candidateUid)
        .query('SELECT TOP 1 UserId FROM dbo.Users WHERE UserId = @uid');
      if (userCheck.recordset.length > 0) {
        resolvedUserId = userCheck.recordset[0].UserId;
      }
    }
  } else if (!body.userId && body.isGuest === false) {
    const memberRes = await pool
      .request()
      .input('cleanPhone', sql.NVarChar(30), normalizedPhone)
      .query(`
        SELECT TOP 1 UserId
        FROM dbo.Users
        WHERE ${sqlNormalizedPhone('Phone')} = @cleanPhone
        ORDER BY CASE WHEN Role = N'customer' THEN 0 ELSE 1 END, UserId DESC
      `);
    if (memberRes.recordset.length > 0) {
      resolvedUserId = memberRes.recordset[0].UserId;
    }
  }

  const isGuestBit = resolvedUserId ? 0 : body.isGuest === false ? 0 : 1;

  const transaction = new sql.Transaction(pool);
  let txBegun = false;

  try {
    await transaction.begin();
    txBegun = true;

    // 1. Ensure OrderCode uniqueness inside transaction
    let orderCode = requestedCode;
    if (orderCode) {
      const dupCheck = await new sql.Request(transaction)
        .input('reqCode', sql.NVarChar(20), orderCode)
        .query(`
          SELECT TOP 1 OrderId
          FROM dbo.Orders WITH (UPDLOCK, HOLDLOCK)
          WHERE UPPER(OrderCode) = UPPER(@reqCode)
        `);
      if (dupCheck.recordset.length > 0) {
        throw new AppError('Mã đơn hàng đã tồn tại.', 409);
      }
    } else {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidate = `PH${Math.floor(100000 + Math.random() * 900000)}`;
        const dupCheck = await new sql.Request(transaction)
          .input('genCode', sql.NVarChar(20), candidate)
          .query(`
            SELECT TOP 1 OrderId
            FROM dbo.Orders WITH (UPDLOCK, HOLDLOCK)
            WHERE UPPER(OrderCode) = UPPER(@genCode)
          `);
        if (dupCheck.recordset.length === 0) {
          orderCode = candidate;
          break;
        }
      }
      if (!orderCode) {
        throw new AppError('Không thể khởi tạo mã đơn hàng duy nhất.', 500);
      }
    }

    // 2. Lock referenced products in deterministic order & validate active + stock + server-side price
    const uniqueRawPids = [
      ...new Set(
        items
          .map((it) => String(it.productId || it.id || '').trim())
          .filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b));

    const productByLowerId = new Map();
    for (const rawPid of uniqueRawPids) {
      const prodRes = await new sql.Request(transaction)
        .input('pid', sql.NVarChar(60), rawPid)
        .query(`
          SELECT ProductId, Name, PrimaryImage, Price, StockCount, IsActive
          FROM dbo.Products WITH (UPDLOCK, HOLDLOCK)
          WHERE ProductId = @pid
        `);
      if (prodRes.recordset.length > 0) {
        const row = prodRes.recordset[0];
        productByLowerId.set(rawPid.toLowerCase(), row);
        productByLowerId.set(String(row.ProductId).toLowerCase(), row);
      }
    }

    const requiredByProductId = new Map();
    const validatedItems = [];

    for (const item of items) {
      const qty = Number(item.quantity ?? 1);
      const rawProdId = String(item.productId || item.id || '').trim();
      const prodRow = rawProdId
        ? productByLowerId.get(rawProdId.toLowerCase()) || null
        : null;

      if (prodRow) {
        if (!prodRow.IsActive) {
          throw new AppError(
            `Sản phẩm "${prodRow.Name}" hiện đã ngừng kinh doanh.`,
            400
          );
        }

        const canonicalPid = String(prodRow.ProductId);
        const nextRequiredQty = (requiredByProductId.get(canonicalPid) || 0) + qty;
        if (Number(prodRow.StockCount) < nextRequiredQty) {
          throw new AppError(
            `Sản phẩm "${prodRow.Name}" chỉ còn ${prodRow.StockCount} sản phẩm trong kho, không đủ số lượng yêu cầu (${nextRequiredQty}).`,
            400
          );
        }
        requiredByProductId.set(canonicalPid, nextRequiredQty);

        const unitPrice = Number(prodRow.Price);
        const prodName = String(
          item.productName || item.name || prodRow.Name || 'Sản phẩm PetsFriend'
        ).trim();
        const prodImage = String(
          item.productImage ||
            item.image ||
            prodRow.PrimaryImage ||
            '/images/prod-ceramic-bowl.jpg'
        ).trim();
        const variantLabel = String(
          item.variantLabel || item.variant || item.desc || 'Tiêu chuẩn'
        ).trim();

        validatedItems.push({
          validProductId: canonicalPid,
          productName: prodName,
          productImage: prodImage,
          variantLabel,
          unitPrice,
          qty,
        });
      } else {
        const unitPrice = Number(item.unitPrice ?? item.price ?? 0);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          throw new AppError('Đơn giá sản phẩm không hợp lệ.', 400);
        }

        const prodName = String(
          item.productName || item.name || 'Sản phẩm PetsFriend'
        ).trim();
        const prodImage = String(
          item.productImage || item.image || '/images/prod-ceramic-bowl.jpg'
        ).trim();
        const variantLabel = String(
          item.variantLabel || item.variant || item.desc || 'Tiêu chuẩn'
        ).trim();

        validatedItems.push({
          validProductId: null,
          productName: prodName,
          productImage: prodImage,
          variantLabel,
          unitPrice,
          qty,
        });
      }
    }

    // 3. Compute authoritative server-side totalAmount
    const totalAmount = validatedItems.reduce(
      (sum, it) => sum + it.unitPrice * it.qty,
      0
    );

    // 4. Insert Order
    const orderInsert = await new sql.Request(transaction)
      .input('orderCode', sql.NVarChar(20), orderCode)
      .input('userId', sql.Int, resolvedUserId)
      .input('isGuest', sql.Bit, isGuestBit)
      .input('customerName', sql.NVarChar(120), customerName)
      .input('customerPhone', sql.NVarChar(20), storedCustomerPhone)
      .input('customerEmail', sql.NVarChar(150), customerEmail)
      .input('deliveryMethod', sql.NVarChar(20), deliveryMethod)
      .input('shippingAddress', sql.NVarChar(350), shippingAddress)
      .input('paymentMethod', sql.NVarChar(20), paymentCode)
      .input('orderStatus', sql.NVarChar(20), initialStatus)
      .input('orderSource', sql.NVarChar(20), orderSource)
      .input('totalAmount', sql.Decimal(18, 0), totalAmount)
      .input('staffName', sql.NVarChar(120), staffName)
      .input('paymentStatus', sql.NVarChar(20), initialPaymentStatus)
      .query(`
        INSERT INTO dbo.Orders (
          OrderCode, UserId, IsGuest, CustomerName, CustomerPhone, CustomerEmail,
          DeliveryMethod, ShippingAddress, PaymentMethod, OrderStatus, OrderSource,
          TotalAmount, StaffName, PaymentStatus, PaidAt
        )
        OUTPUT INSERTED.*
        VALUES (
          @orderCode, @userId, @isGuest, @customerName, @customerPhone, @customerEmail,
          @deliveryMethod, @shippingAddress, @paymentMethod, @orderStatus, @orderSource,
          @totalAmount, @staffName, @paymentStatus,
          CASE WHEN @paymentStatus = N'paid' THEN SYSUTCDATETIME() ELSE NULL END
        )
      `);

    const createdOrderRow = orderInsert.recordset[0];
    const insertedItems = [];

    // 4.1 Đơn POS: ghi nhận giao dịch thu tiền tại quầy vào lịch sử thanh toán
    if (initialPaymentStatus === 'paid') {
      await new sql.Request(transaction)
        .input('orderId', sql.Int, createdOrderRow.OrderId)
        .input('txnRef', sql.NVarChar(60), `${orderCode}-POS`)
        .input('gateway', sql.NVarChar(20), paymentCode === 'cod' ? 'cash' : paymentCode)
        .input('amount', sql.Decimal(18, 0), totalAmount)
        .input('note', sql.NVarChar(400), paymentCode === 'cod' ? 'Thu tiền mặt tại quầy POS' : `Khách quét mã ${paymentCode.toUpperCase()} tại quầy POS`)
        .input('createdBy', sql.NVarChar(120), staffName)
        .query(`
          INSERT INTO dbo.PaymentTransactions (OrderId, TxnRef, Gateway, Amount, Status, ResponseCode, Note, CreatedBy)
          VALUES (@orderId, @txnRef, @gateway, @amount, N'success', N'00', @note, @createdBy)
        `);
    }

    // 5. Insert OrderItems
    for (const vItem of validatedItems) {
      const itemInsert = await new sql.Request(transaction)
        .input('orderId', sql.Int, createdOrderRow.OrderId)
        .input('productId', sql.NVarChar(60), vItem.validProductId)
        .input('productName', sql.NVarChar(200), vItem.productName)
        .input('productImage', sql.NVarChar(500), vItem.productImage)
        .input('variantLabel', sql.NVarChar(100), vItem.variantLabel)
        .input('unitPrice', sql.Decimal(18, 0), vItem.unitPrice)
        .input('quantity', sql.Int, vItem.qty)
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
    }

    // 6. Deduct StockCount per referenced ProductId
    for (const [pid, deductQty] of requiredByProductId.entries()) {
      await new sql.Request(transaction)
        .input('pid', sql.NVarChar(60), pid)
        .input('qty', sql.Int, deductQty)
        .query(`
          UPDATE dbo.Products
          SET StockCount = StockCount - @qty
          WHERE ProductId = @pid
        `);
    }

    await transaction.commit();
    txBegun = false;

    const needsOnlinePayment =
      orderSource === 'online' && (paymentCode === 'vnpay' || paymentCode === 'momo');

    return {
      message: 'Tạo đơn hàng thành công!',
      order: mapOrderRow(createdOrderRow, insertedItems),
      payment: {
        required: needsOnlinePayment,
        method: paymentCode,
        status: initialPaymentStatus,
        nextStep: needsOnlinePayment
          ? `POST /api/payments/${paymentCode}/create`
          : null,
      },
    };
  } catch (err) {
    if (txBegun) {
      try {
        await transaction.rollback();
      } catch (_) {
        // ignore rollback error
      }
    }
    throw err;
  }
}

async function updateOrderStatus(idOrCode, payload = {}) {
  const idParam = String(idOrCode || '')
    .trim()
    .replace(/^#/, '');
  const nextStatus = String(payload.status || payload.orderStatus || '').trim();
  const staffName = payload.staffName ? String(payload.staffName).trim() : null;

  if (!idParam) {
    throw new AppError('Mã đơn hàng không hợp lệ.', 400);
  }
  if (!VALID_ORDER_STATUSES.includes(nextStatus)) {
    throw new AppError('Trạng thái đơn hàng không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);
  let txBegun = false;

  try {
    await transaction.begin();
    txBegun = true;

    const existingRes = await new sql.Request(transaction)
      .input('code', sql.NVarChar(60), idParam)
      .query(`
        SELECT TOP 1 *
        FROM dbo.Orders WITH (UPDLOCK, HOLDLOCK)
        WHERE UPPER(OrderCode) = UPPER(@code)
           OR OrderId = TRY_CAST(@code AS INT)
      `);

    if (existingRes.recordset.length === 0) {
      throw new AppError('Không tìm thấy đơn hàng.', 404);
    }

    const prevOrder = existingRes.recordset[0];
    const itemsRes = await new sql.Request(transaction)
      .input('orderId', sql.Int, prevOrder.OrderId)
      .query(`
        SELECT *
        FROM dbo.OrderItems
        WHERE OrderId = @orderId
        ORDER BY OrderItemId ASC
      `);

    const aggregatedItems = aggregateQuantitiesByProductId(itemsRes.recordset);

    if (prevOrder.OrderStatus !== 'cancelled' && nextStatus === 'cancelled') {
      for (const [pid, qty] of aggregatedItems) {
        await new sql.Request(transaction)
          .input('pid', sql.NVarChar(60), pid)
          .input('qty', sql.Int, qty)
          .query(`
            UPDATE dbo.Products
            SET StockCount = StockCount + @qty
            WHERE ProductId = @pid
          `);
      }
    } else if (
      prevOrder.OrderStatus === 'cancelled' &&
      nextStatus !== 'cancelled'
    ) {
      for (const [pid, requiredQty] of aggregatedItems) {
        const prodRes = await new sql.Request(transaction)
          .input('pid', sql.NVarChar(60), pid)
          .query(`
            SELECT ProductId, Name, StockCount
            FROM dbo.Products WITH (UPDLOCK, HOLDLOCK)
            WHERE ProductId = @pid
          `);

        const prodRow = prodRes.recordset[0];
        if (!prodRow || Number(prodRow.StockCount) < requiredQty) {
          throw new AppError(
            'Không đủ tồn kho để mở lại đơn hàng đã hủy.',
            400
          );
        }
      }

      for (const [pid, requiredQty] of aggregatedItems) {
        await new sql.Request(transaction)
          .input('pid', sql.NVarChar(60), pid)
          .input('qty', sql.Int, requiredQty)
          .query(`
            UPDATE dbo.Products
            SET StockCount = StockCount - @qty
            WHERE ProductId = @pid
          `);
      }
    }

    await syncPaymentOnStatusChange(transaction, prevOrder, nextStatus, staffName);

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

    await transaction.commit();
    txBegun = false;

    return mapOrderRow(updatedRes.recordset[0], itemsRes.recordset);
  } catch (err) {
    if (txBegun) {
      try {
        await transaction.rollback();
      } catch (_) {
        // ignore rollback error
      }
    }
    throw err;
  }
}

async function cancelOrder(idOrCode, { requester = null, phone = '' } = {}) {
  const idParam = String(idOrCode || '')
    .trim()
    .replace(/^#/, '');
  if (!idParam) {
    throw new AppError('Mã đơn hàng không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);
  let txBegun = false;

  try {
    await transaction.begin();
    txBegun = true;

    const existingRes = await new sql.Request(transaction)
      .input('code', sql.NVarChar(60), idParam)
      .query(`
        SELECT TOP 1 *
        FROM dbo.Orders WITH (UPDLOCK, HOLDLOCK)
        WHERE UPPER(OrderCode) = UPPER(@code)
           OR OrderId = TRY_CAST(@code AS INT)
      `);

    if (existingRes.recordset.length === 0) {
      throw new AppError('Không tìm thấy đơn hàng.', 404);
    }

    const order = existingRes.recordset[0];
    const itemsRes = await new sql.Request(transaction)
      .input('orderId', sql.Int, order.OrderId)
      .query(`
        SELECT *
        FROM dbo.OrderItems
        WHERE OrderId = @orderId
        ORDER BY OrderItemId ASC
      `);

    if (order.OrderStatus === 'cancelled') {
      await transaction.commit();
      txBegun = false;
      return {
        message: 'Đơn hàng đã ở trạng thái hủy.',
        order: mapOrderRow(order, itemsRes.recordset),
      };
    }

    const isStaffOrAdmin = Boolean(
      requester && (requester.role === 'admin' || requester.role === 'staff')
    );

    if (!isStaffOrAdmin) {
      if (order.OrderStatus !== 'pending') {
        throw new AppError(
          'Chỉ có thể hủy đơn hàng đang ở trạng thái chờ xác nhận.',
          400
        );
      }

      const isOwnerByUser = Boolean(
        requester &&
          requester.userId != null &&
          order.UserId != null &&
          Number(order.UserId) === Number(requester.userId)
      );
      const providedPhone = cleanPhone(phone);
      const orderPhone = cleanPhone(order.CustomerPhone);
      const isOwnerByPhone = Boolean(
        providedPhone && orderPhone && providedPhone === orderPhone
      );

      if (!isOwnerByUser && !isOwnerByPhone) {
        throw new AppError('Bạn không có quyền hủy đơn hàng này.', 403);
      }
    }

    const aggregatedItems = aggregateQuantitiesByProductId(itemsRes.recordset);
    for (const [pid, qty] of aggregatedItems) {
      await new sql.Request(transaction)
        .input('pid', sql.NVarChar(60), pid)
        .input('qty', sql.Int, qty)
        .query(`
          UPDATE dbo.Products
          SET StockCount = StockCount + @qty
          WHERE ProductId = @pid
        `);
    }

    await syncPaymentOnStatusChange(
      transaction,
      order,
      'cancelled',
      requester && requester.username ? requester.username : null
    );

    const updatedRes = await new sql.Request(transaction)
      .input('orderId', sql.Int, order.OrderId)
      .query(`
        UPDATE dbo.Orders
        SET OrderStatus = N'cancelled'
        OUTPUT INSERTED.*
        WHERE OrderId = @orderId
      `);

    await transaction.commit();
    txBegun = false;

    return {
      message: 'Đã hủy đơn hàng thành công.',
      order: mapOrderRow(updatedRes.recordset[0], itemsRes.recordset),
    };
  } catch (err) {
    if (txBegun) {
      try {
        await transaction.rollback();
      } catch (_) {
        // ignore rollback error
      }
    }
    throw err;
  }
}

async function deleteOrder(idOrCode) {
  const idParam = String(idOrCode || '')
    .trim()
    .replace(/^#/, '');
  if (!idParam) {
    throw new AppError('Mã đơn hàng không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);
  let txBegun = false;

  try {
    await transaction.begin();
    txBegun = true;

    const existingRes = await new sql.Request(transaction)
      .input('code', sql.NVarChar(60), idParam)
      .query(`
        SELECT TOP 1 *
        FROM dbo.Orders WITH (UPDLOCK, HOLDLOCK)
        WHERE UPPER(OrderCode) = UPPER(@code)
           OR OrderId = TRY_CAST(@code AS INT)
      `);

    if (existingRes.recordset.length === 0) {
      throw new AppError('Không tìm thấy đơn hàng.', 404);
    }

    const order = existingRes.recordset[0];

    if (order.OrderStatus !== 'cancelled') {
      const itemsRes = await new sql.Request(transaction)
        .input('orderId', sql.Int, order.OrderId)
        .query('SELECT ProductId, Quantity FROM dbo.OrderItems WHERE OrderId = @orderId');

      const aggregatedItems = aggregateQuantitiesByProductId(itemsRes.recordset);
      for (const [pid, qty] of aggregatedItems) {
        await new sql.Request(transaction)
          .input('pid', sql.NVarChar(60), pid)
          .input('qty', sql.Int, qty)
          .query(`
            UPDATE dbo.Products
            SET StockCount = StockCount + @qty
            WHERE ProductId = @pid
          `);
      }
    }

    await new sql.Request(transaction)
      .input('orderId', sql.Int, order.OrderId)
      .query('DELETE FROM dbo.Orders WHERE OrderId = @orderId');

    await transaction.commit();
    txBegun = false;

    return { message: 'Đã xóa đơn hàng.' };
  } catch (err) {
    if (txBegun) {
      try {
        await transaction.rollback();
      } catch (_) {
        // ignore rollback error
      }
    }
    throw err;
  }
}

async function listOrderItems({ orderId } = {}) {
  const pool = await poolPromise;

  if (orderId !== undefined && orderId !== null && String(orderId).trim() !== '') {
    const cleanOid = String(orderId).trim().replace(/^#/, '');
    const res = await pool
      .request()
      .input('oid', sql.NVarChar(60), cleanOid)
      .query(`
        SELECT oi.*
        FROM dbo.OrderItems oi
        INNER JOIN dbo.Orders o ON o.OrderId = oi.OrderId
        WHERE o.OrderId = TRY_CAST(@oid AS INT)
           OR UPPER(o.OrderCode) = UPPER(@oid)
        ORDER BY oi.OrderItemId DESC
      `);
    return res.recordset;
  }

  const res = await pool
    .request()
    .query('SELECT * FROM dbo.OrderItems ORDER BY OrderItemId DESC');
  return res.recordset;
}

async function getAnalyticsOverview() {
  const pool = await poolPromise;

  const [
    orderStatsRes,
    bookingStatsRes,
    lowStockRowsRes,
    monthlyTrendRes,
    topProductsRes,
  ] = await Promise.all([
    pool.request().query(`
      SELECT
        COUNT(*) AS totalOrders,
        ISNULL(SUM(CASE WHEN OrderStatus = N'pending' THEN 1 ELSE 0 END), 0) AS pendingOrders,
        ISNULL(SUM(CASE WHEN OrderStatus = N'completed' THEN 1 ELSE 0 END), 0) AS completedOrders,
        ISNULL(SUM(CASE WHEN OrderStatus <> N'cancelled' AND PaymentMethod IN (N'vnpay', N'momo') THEN TotalAmount ELSE 0 END), 0) AS transferRevenue,
        ISNULL(SUM(CASE WHEN OrderStatus <> N'cancelled' AND PaymentMethod = N'cod' THEN TotalAmount ELSE 0 END), 0) AS cashRevenue,
        ISNULL(SUM(CASE WHEN OrderStatus = N'completed' THEN TotalAmount ELSE 0 END), 0) AS collectedRevenue
      FROM dbo.Orders
    `),
    pool.request().query(`
      SELECT
        COUNT(*) AS totalBookings,
        ISNULL(SUM(CASE WHEN Status = N'upcoming' THEN 1 ELSE 0 END), 0) AS upcomingBookings,
        ISNULL(SUM(CASE WHEN Status = N'completed' THEN Price ELSE 0 END), 0) AS spaRevenue
      FROM dbo.ServiceBookings
    `),
    pool.request().query(`
      SELECT *
      FROM dbo.Products
      WHERE IsActive = 1 AND StockCount <= 15
      ORDER BY StockCount ASC, CreatedAt DESC
    `),
    pool.request().query(`
      SELECT
        MONTH(CreatedAt) AS monthNum,
        COUNT(*) AS orders,
        ISNULL(SUM(CASE WHEN PaymentMethod IN (N'vnpay', N'momo') THEN TotalAmount ELSE 0 END), 0) AS transfer,
        ISNULL(SUM(CASE WHEN PaymentMethod = N'cod' THEN TotalAmount ELSE 0 END), 0) AS cash,
        ISNULL(SUM(TotalAmount), 0) AS revenue
      FROM dbo.Orders
      WHERE OrderStatus <> N'cancelled' AND YEAR(CreatedAt) = YEAR(SYSUTCDATETIME())
      GROUP BY MONTH(CreatedAt)
      ORDER BY monthNum ASC
    `),
    pool.request().query(`
      SELECT TOP 5
        COALESCE(oi.ProductId, oi.ProductName) AS productKey,
        MAX(oi.ProductId) AS productId,
        MAX(oi.ProductName) AS productName,
        MAX(oi.ProductImage) AS productImage,
        SUM(oi.Quantity) AS soldQuantity,
        SUM(oi.UnitPrice * oi.Quantity) AS totalRevenue
      FROM dbo.OrderItems oi
      INNER JOIN dbo.Orders o ON o.OrderId = oi.OrderId
      WHERE o.OrderStatus <> N'cancelled'
      GROUP BY COALESCE(oi.ProductId, oi.ProductName)
      ORDER BY soldQuantity DESC, totalRevenue DESC
    `),
  ]);

  const rawOrders = orderStatsRes.recordset[0] || {};
  const orders = {
    totalOrders: Number(rawOrders.totalOrders || 0),
    pendingOrders: Number(rawOrders.pendingOrders || 0),
    completedOrders: Number(rawOrders.completedOrders || 0),
    transferRevenue: Number(rawOrders.transferRevenue || 0),
    cashRevenue: Number(rawOrders.cashRevenue || 0),
    collectedRevenue: Number(rawOrders.collectedRevenue || 0),
  };

  const rawBookings = bookingStatsRes.recordset[0] || {};
  const bookings = {
    totalBookings: Number(rawBookings.totalBookings || 0),
    upcomingBookings: Number(rawBookings.upcomingBookings || 0),
    spaRevenue: Number(rawBookings.spaRevenue || 0),
  };

  const lowStockProducts = lowStockRowsRes.recordset.map((row) =>
    mapProductRow(row, [])
  );
  const lowStockCount = lowStockProducts.length;
  const totalCombinedRevenue =
    Number(orders.collectedRevenue || 0) + Number(bookings.spaRevenue || 0);

  const topProducts = topProductsRes.recordset.map((r) => ({
    id: r.productId || r.productKey,
    productId: r.productId || null,
    name: r.productName,
    productName: r.productName,
    image: r.productImage,
    productImage: r.productImage,
    soldQuantity: Number(r.soldQuantity || 0),
    revenue: Number(r.totalRevenue || 0),
  }));

  const monthlyTrend = monthlyTrendRes.recordset.map((m) => ({
    monthNum: Number(m.monthNum),
    orders: Number(m.orders || 0),
    transfer: Number(m.transfer || 0),
    cash: Number(m.cash || 0),
    revenue: Number(m.revenue || 0),
  }));

  return {
    orders,
    bookings,
    lowStockCount,
    lowStockProducts,
    totalCombinedRevenue,
    topProducts,
    monthlyTrend,
  };
}

async function getAnalyticsDaily(params = {}) {
  const dateStr = params.date
    ? String(params.date).trim()
    : new Date().toISOString().slice(0, 10);

  if (!isValidIsoDate(dateStr)) {
    throw new AppError(
      'Định dạng ngày (date) không hợp lệ. Vui lòng dùng YYYY-MM-DD.',
      400
    );
  }

  const lo = params.startTime ? String(params.startTime).trim() : '00:00';
  const hi = params.endTime ? String(params.endTime).trim() : '23:59';

  if (!isValidHhMm(lo) || !isValidHhMm(hi)) {
    throw new AppError(
      'Khung giờ (startTime / endTime) không hợp lệ. Vui lòng dùng HH:mm.',
      400
    );
  }

  const pool = await poolPromise;
  const [ordersRes, spaRes] = await Promise.all([
    pool
      .request()
      .input('date', sql.VarChar(10), dateStr)
      .input('lo', sql.VarChar(5), lo)
      .input('hi', sql.VarChar(5), hi)
      .query(`
        SELECT *
        FROM dbo.Orders
        WHERE CAST(CreatedAt AS DATE) = CAST(@date AS DATE)
          AND FORMAT(CreatedAt, 'HH:mm') BETWEEN @lo AND @hi
        ORDER BY CreatedAt DESC, OrderId DESC
      `),
    pool
      .request()
      .input('date', sql.VarChar(10), dateStr)
      .query(`
        SELECT
          COUNT(*) AS spaBookings,
          ISNULL(SUM(Price), 0) AS spaRevenue
        FROM dbo.ServiceBookings
        WHERE BookingDate = CAST(@date AS DATE)
          AND Status = N'completed'
      `),
  ]);

  const orderRows = ordersRes.recordset;
  const invoices = await attachItemsToOrders(pool, orderRows);

  const nonCancelled = orderRows.filter((r) => r.OrderStatus !== 'cancelled');
  const transfer = nonCancelled
    .filter((r) => r.PaymentMethod === 'vnpay' || r.PaymentMethod === 'momo')
    .reduce((sum, r) => sum + Number(r.TotalAmount || 0), 0);
  const cash = nonCancelled
    .filter((r) => r.PaymentMethod === 'cod')
    .reduce((sum, r) => sum + Number(r.TotalAmount || 0), 0);
  const total = transfer + cash;
  const orders = nonCancelled.length;

  const spaRow = spaRes.recordset[0] || {};
  const spaBookings = Number(spaRow.spaBookings || 0);
  const spaRevenue = Number(spaRow.spaRevenue || 0);

  const summary = {
    date: dateStr,
    startTime: lo,
    endTime: hi,
    transfer,
    cash,
    total,
    orders,
    spaBookings,
    spaRevenue,
  };

  const series = [
    { method: 'Chuyển khoản', amount: transfer },
    { method: 'Tiền mặt (COD)', amount: cash },
  ];

  return {
    ...summary,
    summary,
    series,
    invoices,
  };
}

async function getAnalyticsPeriod(params = {}) {
  const period = params.period ? String(params.period).trim() : 'past-months';
  if (!['past-months', 'past-years'].includes(period)) {
    throw new AppError(
      'Tham số period không hợp lệ (hỗ trợ past-months hoặc past-years).',
      400
    );
  }

  const year =
    params.year !== undefined && params.year !== null && String(params.year).trim() !== ''
      ? Number(params.year)
      : new Date().getUTCFullYear();

  if (!Number.isInteger(year) || year < 1970 || year > 2100) {
    throw new AppError('Năm thống kê (year) không hợp lệ.', 400);
  }

  const pool = await poolPromise;

  if (period === 'past-months') {
    const [orderMonthRes, spaMonthRes] = await Promise.all([
      pool
        .request()
        .input('year', sql.Int, year)
        .query(`
          SELECT
            MONTH(CreatedAt) AS monthNum,
            COUNT(*) AS orders,
            ISNULL(SUM(CASE WHEN PaymentMethod IN (N'vnpay', N'momo') THEN TotalAmount ELSE 0 END), 0) AS transfer,
            ISNULL(SUM(CASE WHEN PaymentMethod = N'cod' THEN TotalAmount ELSE 0 END), 0) AS cash,
            ISNULL(SUM(TotalAmount), 0) AS orderRevenue
          FROM dbo.Orders
          WHERE OrderStatus <> N'cancelled' AND YEAR(CreatedAt) = @year
          GROUP BY MONTH(CreatedAt)
        `),
      pool
        .request()
        .input('year', sql.Int, year)
        .query(`
          SELECT
            MONTH(BookingDate) AS monthNum,
            ISNULL(SUM(Price), 0) AS spaRevenue
          FROM dbo.ServiceBookings
          WHERE Status = N'completed' AND YEAR(BookingDate) = @year
          GROUP BY MONTH(BookingDate)
        `),
    ]);

    const ordByMonth = {};
    for (const r of orderMonthRes.recordset) {
      ordByMonth[Number(r.monthNum)] = r;
    }

    const spaByMonth = {};
    for (const r of spaMonthRes.recordset) {
      spaByMonth[Number(r.monthNum)] = r;
    }

    const trend = [];
    for (let m = 1; m <= 12; m += 1) {
      const mm = String(m).padStart(2, '0');
      const ordRow = ordByMonth[m] || {};
      const spaRow = spaByMonth[m] || {};

      const orders = Number(ordRow.orders || 0);
      const transfer = Number(ordRow.transfer || 0);
      const cash = Number(ordRow.cash || 0);
      const spaRevenue = Number(spaRow.spaRevenue || 0);
      const revenue = transfer + cash + spaRevenue;

      trend.push({
        period: `T${m}`,
        fullLabel: `Tháng ${mm}/${year}`,
        orders,
        transfer,
        cash,
        spaRevenue,
        revenue,
      });
    }

    const totalRevenue = trend.reduce((sum, item) => sum + item.revenue, 0);
    const totalOrders = trend.reduce((sum, item) => sum + item.orders, 0);
    const avgOrderValue =
      totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

    return {
      period: 'past-months',
      year,
      totalRevenue,
      totalOrders,
      avgOrderValue,
      trend,
    };
  }

  // period === 'past-years'
  const startYear = year - 2;
  const endYear = year;

  const [orderYearRes, spaYearRes] = await Promise.all([
    pool
      .request()
      .input('startYear', sql.Int, startYear)
      .input('endYear', sql.Int, endYear)
      .query(`
        SELECT
          YEAR(CreatedAt) AS yearNum,
          COUNT(*) AS orders,
          ISNULL(SUM(CASE WHEN PaymentMethod IN (N'vnpay', N'momo') THEN TotalAmount ELSE 0 END), 0) AS transfer,
          ISNULL(SUM(CASE WHEN PaymentMethod = N'cod' THEN TotalAmount ELSE 0 END), 0) AS cash,
          ISNULL(SUM(TotalAmount), 0) AS orderRevenue
        FROM dbo.Orders
        WHERE OrderStatus <> N'cancelled'
          AND YEAR(CreatedAt) BETWEEN @startYear AND @endYear
        GROUP BY YEAR(CreatedAt)
      `),
    pool
      .request()
      .input('startYear', sql.Int, startYear)
      .input('endYear', sql.Int, endYear)
      .query(`
        SELECT
          YEAR(BookingDate) AS yearNum,
          ISNULL(SUM(Price), 0) AS spaRevenue
        FROM dbo.ServiceBookings
        WHERE Status = N'completed'
          AND YEAR(BookingDate) BETWEEN @startYear AND @endYear
        GROUP BY YEAR(BookingDate)
      `),
  ]);

  const ordByYear = {};
  for (const r of orderYearRes.recordset) {
    ordByYear[Number(r.yearNum)] = r;
  }

  const spaByYear = {};
  for (const r of spaYearRes.recordset) {
    spaByYear[Number(r.yearNum)] = r;
  }

  const trend = [year - 2, year - 1, year].map((y) => {
    const ordRow = ordByYear[y] || {};
    const spaRow = spaByYear[y] || {};

    const orders = Number(ordRow.orders || 0);
    const transfer = Number(ordRow.transfer || 0);
    const cash = Number(ordRow.cash || 0);
    const spaRevenue = Number(spaRow.spaRevenue || 0);
    const revenue = transfer + cash + spaRevenue;

    return {
      period: String(y),
      fullLabel: `Năm ${y}`,
      orders,
      transfer,
      cash,
      spaRevenue,
      revenue,
    };
  });

  const totalRevenue = trend.reduce((sum, item) => sum + item.revenue, 0);
  const totalOrders = trend.reduce((sum, item) => sum + item.orders, 0);
  const avgOrderValue =
    totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  return {
    period: 'past-years',
    year,
    totalRevenue,
    totalOrders,
    avgOrderValue,
    trend,
  };
}

module.exports = {
  attachItemsToOrders,
  syncPaymentOnStatusChange,
  listOrders,
  lookupGuestOrder,
  getOrderById,
  getOrderItemsByOrderId,
  createOrder,
  updateOrderStatus,
  cancelOrder,
  deleteOrder,
  listOrderItems,
  getAnalyticsOverview,
  getAnalyticsDaily,
  getAnalyticsPeriod,
};
