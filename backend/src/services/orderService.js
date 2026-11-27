const { poolPromise } = require('../../../api/db');
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
  const stripped = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(${columnName}, ''), '+84', '0'), ' ', ''), '.', ''), '-', ''), '(', ''), ')', '')`;
  return `(CASE WHEN LEFT(${stripped}, 2) = '84' AND CHAR_LENGTH(${stripped}) >= 11 THEN CONCAT('0', SUBSTRING(${stripped}, 3, 50)) ELSE ${stripped} END)`;
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
 * Đồng bộ trạng thái thanh toán khi đơn hàng đổi trạng thái (chạy trong cùng MySQL Transaction):
 *  - Hủy đơn đã thu tiền         -> PaymentStatus = refunded, giao dịch success -> refunded
 *  - Giao thành công đơn COD     -> PaymentStatus = paid + ghi giao dịch thu tiền COD
 *  - Mở lại đơn đã hoàn tiền     -> PaymentStatus = unpaid (cần thu tiền lại)
 */
async function syncPaymentOnStatusChange(conn, order, nextStatus, actorName = null) {
  const currentPs = order.PaymentStatus || 'unpaid';

  if (nextStatus === 'cancelled' && order.OrderStatus !== 'cancelled' && currentPs === 'paid') {
    await conn.query(
      "UPDATE Orders SET PaymentStatus = 'refunded' WHERE OrderId = ?",
      [order.OrderId]
    );
    await conn.query(
      `
        UPDATE PaymentTransactions
        SET Status = 'refunded',
            Note = LEFT(CONCAT(IFNULL(Note, ''), ' | Hoàn tiền do hủy đơn hàng'), 400),
            UpdatedAt = UTC_TIMESTAMP()
        WHERE OrderId = ? AND Status = 'success'
      `,
      [order.OrderId]
    );
    return;
  }

  if (nextStatus === 'completed' && order.PaymentMethod === 'cod' && currentPs !== 'paid') {
    await conn.query(
      `
        UPDATE Orders
        SET PaymentStatus = 'paid', PaidAt = UTC_TIMESTAMP()
        WHERE OrderId = ?
      `,
      [order.OrderId]
    );
    await conn.query(
      `
        INSERT INTO PaymentTransactions (OrderId, TxnRef, Gateway, Amount, Status, ResponseCode, Note, CreatedBy)
        VALUES (?, ?, 'cod', ?, 'success', '00', 'Thu tiền COD khi giao hàng thành công', ?)
      `,
      [
        order.OrderId,
        `${order.OrderCode}-COD-${Date.now()}`,
        Number(order.TotalAmount || 0),
        actorName ? String(actorName).slice(0, 120) : null,
      ]
    );
    return;
  }

  if (order.OrderStatus === 'cancelled' && nextStatus !== 'cancelled' && currentPs === 'refunded') {
    await conn.query(
      "UPDATE Orders SET PaymentStatus = 'unpaid', PaidAt = NULL WHERE OrderId = ?",
      [order.OrderId]
    );
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
    const placeholders = chunk.map(() => '?').join(', ');

    // eslint-disable-next-line no-await-in-loop
    const [itemRows] = await pool.query(
      `
        SELECT *
        FROM OrderItems
        WHERE OrderId IN (${placeholders})
        ORDER BY OrderItemId ASC
      `,
      chunk
    );

    for (const item of itemRows) {
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
  let query = 'SELECT * FROM Orders WHERE 1=1';
  const params = [];

  if (userId !== undefined && userId !== null && String(userId).trim() !== '') {
    const parsedUserId = Number(userId);
    if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
      throw new AppError('Mã người dùng (userId) không hợp lệ.', 400);
    }
    query += ' AND UserId = ?';
    params.push(parsedUserId);
  }

  if (status && String(status).trim() && String(status).trim() !== 'all') {
    query += ' AND OrderStatus = ?';
    params.push(String(status).trim());
  }

  const resolvedSource = source || orderSource;
  if (
    resolvedSource &&
    String(resolvedSource).trim() &&
    String(resolvedSource).trim() !== 'all'
  ) {
    query += ' AND OrderSource = ?';
    params.push(String(resolvedSource).trim());
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
    query += ' AND PaymentMethod = ?';
    params.push(pmCode);
  }

  if (
    staffName &&
    String(staffName).trim() &&
    String(staffName).trim() !== 'all'
  ) {
    query += ' AND StaffName = ?';
    params.push(String(staffName).trim());
  }

  if (fromDate && String(fromDate).trim()) {
    const fromIso = String(fromDate).trim().slice(0, 10);
    if (!isValidIsoDate(fromIso)) {
      throw new AppError(
        'Ngày bắt đầu (fromDate) không hợp lệ. Vui lòng dùng định dạng YYYY-MM-DD.',
        400
      );
    }
    query += ' AND DATE(CreatedAt) >= CAST(? AS DATE)';
    params.push(fromIso);
  }

  if (toDate && String(toDate).trim()) {
    const toIso = String(toDate).trim().slice(0, 10);
    if (!isValidIsoDate(toIso)) {
      throw new AppError(
        'Ngày kết thúc (toDate) không hợp lệ. Vui lòng dùng định dạng YYYY-MM-DD.',
        400
      );
    }
    query += ' AND DATE(CreatedAt) <= CAST(? AS DATE)';
    params.push(toIso);
  }

  if (search && String(search).trim()) {
    const rawSearch = String(search).trim();
    const cleanCodeSearch = rawSearch.replace(/^#/, '');
    const phoneDigits = cleanPhone(rawSearch);

    const qRaw = `%${rawSearch}%`;
    const qCode = `%${cleanCodeSearch}%`;

    if (phoneDigits.length > 0) {
      query += ` AND (OrderCode LIKE ? OR CustomerName LIKE ? OR CustomerPhone LIKE ? OR ${sqlNormalizedPhone('CustomerPhone')} LIKE ?)`;
      params.push(qCode, qRaw, qRaw, `%${phoneDigits}%`);
    } else {
      query +=
        ' AND (OrderCode LIKE ? OR CustomerName LIKE ? OR CustomerPhone LIKE ?)';
      params.push(qCode, qRaw, qRaw);
    }
  }

  query += ' ORDER BY CreatedAt DESC, OrderId DESC';
  const [orderRows] = await pool.query(query, params);
  return attachItemsToOrders(pool, orderRows);
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
  const [orderRows] = await pool.query(
    `
      SELECT *
      FROM Orders
      WHERE UPPER(OrderCode) = ?
        AND ${sqlNormalizedPhone('CustomerPhone')} = ?
      LIMIT 1
    `,
    [cleanCodeVal, cleanPhoneVal]
  );

  if (orderRows.length === 0) {
    throw new AppError(
      'Không tìm thấy đơn hàng khớp với Số điện thoại và Mã đơn hàng này.',
      404
    );
  }

  const [mapped] = await attachItemsToOrders(pool, orderRows);
  return mapped;
}

async function getOrderById(idOrCode) {
  const idParam = String(idOrCode || '')
    .trim()
    .replace(/^#/, '');

  if (!idParam) {
    throw new AppError('Mã đơn hàng không hợp lệ.', 400);
  }

  const numericId = /^\d+$/.test(idParam) ? Number(idParam) : -1;
  const pool = await poolPromise;
  const [orderRows] = await pool.query(
    `
      SELECT *
      FROM Orders
      WHERE UPPER(OrderCode) = UPPER(?)
         OR OrderId = ?
      LIMIT 1
    `,
    [idParam, numericId]
  );

  if (orderRows.length === 0) {
    throw new AppError('Không tìm thấy đơn hàng.', 404);
  }

  const [mapped] = await attachItemsToOrders(pool, orderRows);
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

  // Validate item quantities upfront before opening transaction
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
    const [gwRows] = await pool.query(
      'SELECT DisplayName, IsEnabled FROM PaymentGatewayConfigs WHERE Gateway = ? LIMIT 1',
      [paymentCode]
    );
    const gwRow = gwRows[0];
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
      const [userCheck] = await pool.query(
        'SELECT UserId FROM Users WHERE UserId = ? LIMIT 1',
        [candidateUid]
      );
      if (userCheck.length > 0) {
        resolvedUserId = userCheck[0].UserId;
      }
    }
  } else if (!body.userId && body.isGuest === false) {
    const [memberRows] = await pool.query(
      `
        SELECT UserId
        FROM Users
        WHERE ${sqlNormalizedPhone('Phone')} = ?
        ORDER BY CASE WHEN Role = 'customer' THEN 0 ELSE 1 END, UserId DESC
        LIMIT 1
      `,
      [normalizedPhone]
    );
    if (memberRows.length > 0) {
      resolvedUserId = memberRows[0].UserId;
    }
  }

  const isGuestBit = resolvedUserId ? 0 : body.isGuest === false ? 0 : 1;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Ensure OrderCode uniqueness inside transaction
    let orderCode = requestedCode;
    if (orderCode) {
      const [dupCheck] = await conn.query(
        `
          SELECT OrderId
          FROM Orders
          WHERE UPPER(OrderCode) = UPPER(?)
          LIMIT 1
          FOR UPDATE
        `,
        [orderCode]
      );
      if (dupCheck.length > 0) {
        throw new AppError('Mã đơn hàng đã tồn tại.', 409);
      }
    } else {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidate = `PH${Math.floor(100000 + Math.random() * 900000)}`;
        // eslint-disable-next-line no-await-in-loop
        const [dupCheck] = await conn.query(
          `
            SELECT OrderId
            FROM Orders
            WHERE UPPER(OrderCode) = UPPER(?)
            LIMIT 1
            FOR UPDATE
          `,
          [candidate]
        );
        if (dupCheck.length === 0) {
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
      // eslint-disable-next-line no-await-in-loop
      const [prodRows] = await conn.query(
        `
          SELECT ProductId, Name, PrimaryImage, Price, StockCount, IsActive
          FROM Products
          WHERE ProductId = ?
          FOR UPDATE
        `,
        [rawPid]
      );
      if (prodRows.length > 0) {
        const row = prodRows[0];
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
    const [orderInsert] = await conn.query(
      `
        INSERT INTO Orders (
          OrderCode, UserId, IsGuest, CustomerName, CustomerPhone, CustomerEmail,
          DeliveryMethod, ShippingAddress, PaymentMethod, OrderStatus, OrderSource,
          TotalAmount, StaffName, PaymentStatus, PaidAt
        )
        VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          CASE WHEN ? = 'paid' THEN UTC_TIMESTAMP() ELSE NULL END
        )
      `,
      [
        orderCode,
        resolvedUserId,
        isGuestBit,
        customerName.slice(0, 120),
        storedCustomerPhone,
        customerEmail ? customerEmail.slice(0, 150) : null,
        deliveryMethod,
        shippingAddress.slice(0, 350),
        paymentCode,
        initialStatus,
        orderSource,
        totalAmount,
        staffName ? staffName.slice(0, 120) : null,
        initialPaymentStatus,
        initialPaymentStatus,
      ]
    );

    const [createdOrderRows] = await conn.query(
      'SELECT * FROM Orders WHERE OrderId = ?',
      [orderInsert.insertId]
    );
    const createdOrderRow = createdOrderRows[0];
    const insertedItems = [];

    // 4.1 Đơn POS: ghi nhận giao dịch thu tiền tại quầy vào lịch sử thanh toán
    if (initialPaymentStatus === 'paid') {
      await conn.query(
        `
          INSERT INTO PaymentTransactions (OrderId, TxnRef, Gateway, Amount, Status, ResponseCode, Note, CreatedBy)
          VALUES (?, ?, ?, ?, 'success', '00', ?, ?)
        `,
        [
          createdOrderRow.OrderId,
          `${orderCode}-POS`,
          paymentCode === 'cod' ? 'cash' : paymentCode,
          totalAmount,
          paymentCode === 'cod'
            ? 'Thu tiền mặt tại quầy POS'
            : `Khách quét mã ${paymentCode.toUpperCase()} tại quầy POS`,
          staffName ? staffName.slice(0, 120) : null,
        ]
      );
    }

    // 5. Insert OrderItems
    for (const vItem of validatedItems) {
      // eslint-disable-next-line no-await-in-loop
      const [itemInsert] = await conn.query(
        `
          INSERT INTO OrderItems (
            OrderId, ProductId, ProductName, ProductImage, VariantLabel, UnitPrice, Quantity
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          createdOrderRow.OrderId,
          vItem.validProductId,
          vItem.productName.slice(0, 200),
          vItem.productImage.slice(0, 500),
          vItem.variantLabel ? vItem.variantLabel.slice(0, 100) : null,
          vItem.unitPrice,
          vItem.qty,
        ]
      );

      // eslint-disable-next-line no-await-in-loop
      const [itemRows] = await conn.query(
        'SELECT * FROM OrderItems WHERE OrderItemId = ?',
        [itemInsert.insertId]
      );
      insertedItems.push(itemRows[0]);
    }

    // 6. Deduct StockCount per referenced ProductId
    for (const [pid, deductQty] of requiredByProductId.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await conn.query(
        'UPDATE Products SET StockCount = StockCount - ? WHERE ProductId = ?',
        [deductQty, pid]
      );
    }

    await conn.commit();

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
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
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

  const numericId = /^\d+$/.test(idParam) ? Number(idParam) : -1;
  const pool = await poolPromise;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [existingRows] = await conn.query(
      `
        SELECT *
        FROM Orders
        WHERE UPPER(OrderCode) = UPPER(?)
           OR OrderId = ?
        LIMIT 1
        FOR UPDATE
      `,
      [idParam, numericId]
    );

    if (existingRows.length === 0) {
      throw new AppError('Không tìm thấy đơn hàng.', 404);
    }

    const prevOrder = existingRows[0];
    const [itemRows] = await conn.query(
      `
        SELECT *
        FROM OrderItems
        WHERE OrderId = ?
        ORDER BY OrderItemId ASC
      `,
      [prevOrder.OrderId]
    );

    const aggregatedItems = aggregateQuantitiesByProductId(itemRows);

    if (prevOrder.OrderStatus !== 'cancelled' && nextStatus === 'cancelled') {
      for (const [pid, qty] of aggregatedItems) {
        // eslint-disable-next-line no-await-in-loop
        await conn.query(
          'UPDATE Products SET StockCount = StockCount + ? WHERE ProductId = ?',
          [qty, pid]
        );
      }
    } else if (
      prevOrder.OrderStatus === 'cancelled' &&
      nextStatus !== 'cancelled'
    ) {
      for (const [pid, requiredQty] of aggregatedItems) {
        // eslint-disable-next-line no-await-in-loop
        const [prodRows] = await conn.query(
          `
            SELECT ProductId, Name, StockCount
            FROM Products
            WHERE ProductId = ?
            FOR UPDATE
          `,
          [pid]
        );

        const prodRow = prodRows[0];
        if (!prodRow || Number(prodRow.StockCount) < requiredQty) {
          throw new AppError(
            'Không đủ tồn kho để mở lại đơn hàng đã hủy.',
            400
          );
        }
      }

      for (const [pid, requiredQty] of aggregatedItems) {
        // eslint-disable-next-line no-await-in-loop
        await conn.query(
          'UPDATE Products SET StockCount = StockCount - ? WHERE ProductId = ?',
          [requiredQty, pid]
        );
      }
    }

    await syncPaymentOnStatusChange(conn, prevOrder, nextStatus, staffName);

    await conn.query(
      `
        UPDATE Orders
        SET OrderStatus = ?,
            StaffName = COALESCE(?, StaffName)
        WHERE OrderId = ?
      `,
      [nextStatus, staffName ? staffName.slice(0, 120) : null, prevOrder.OrderId]
    );

    const [updatedRows] = await conn.query(
      'SELECT * FROM Orders WHERE OrderId = ?',
      [prevOrder.OrderId]
    );

    await conn.commit();

    return mapOrderRow(updatedRows[0], itemRows);
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function cancelOrder(idOrCode, { requester = null, phone = '' } = {}) {
  const idParam = String(idOrCode || '')
    .trim()
    .replace(/^#/, '');
  if (!idParam) {
    throw new AppError('Mã đơn hàng không hợp lệ.', 400);
  }

  const numericId = /^\d+$/.test(idParam) ? Number(idParam) : -1;
  const pool = await poolPromise;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [existingRows] = await conn.query(
      `
        SELECT *
        FROM Orders
        WHERE UPPER(OrderCode) = UPPER(?)
           OR OrderId = ?
        LIMIT 1
        FOR UPDATE
      `,
      [idParam, numericId]
    );

    if (existingRows.length === 0) {
      throw new AppError('Không tìm thấy đơn hàng.', 404);
    }

    const order = existingRows[0];
    const [itemRows] = await conn.query(
      `
        SELECT *
        FROM OrderItems
        WHERE OrderId = ?
        ORDER BY OrderItemId ASC
      `,
      [order.OrderId]
    );

    if (order.OrderStatus === 'cancelled') {
      await conn.commit();
      return {
        message: 'Đơn hàng đã ở trạng thái hủy.',
        order: mapOrderRow(order, itemRows),
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

    const aggregatedItems = aggregateQuantitiesByProductId(itemRows);
    for (const [pid, qty] of aggregatedItems) {
      // eslint-disable-next-line no-await-in-loop
      await conn.query(
        'UPDATE Products SET StockCount = StockCount + ? WHERE ProductId = ?',
        [qty, pid]
      );
    }

    await syncPaymentOnStatusChange(
      conn,
      order,
      'cancelled',
      requester && requester.username ? requester.username : null
    );

    await conn.query(
      "UPDATE Orders SET OrderStatus = 'cancelled' WHERE OrderId = ?",
      [order.OrderId]
    );

    const [updatedRows] = await conn.query(
      'SELECT * FROM Orders WHERE OrderId = ?',
      [order.OrderId]
    );

    await conn.commit();

    return {
      message: 'Đã hủy đơn hàng thành công.',
      order: mapOrderRow(updatedRows[0], itemRows),
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteOrder(idOrCode) {
  const idParam = String(idOrCode || '')
    .trim()
    .replace(/^#/, '');
  if (!idParam) {
    throw new AppError('Mã đơn hàng không hợp lệ.', 400);
  }

  const numericId = /^\d+$/.test(idParam) ? Number(idParam) : -1;
  const pool = await poolPromise;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [existingRows] = await conn.query(
      `
        SELECT *
        FROM Orders
        WHERE UPPER(OrderCode) = UPPER(?)
           OR OrderId = ?
        LIMIT 1
        FOR UPDATE
      `,
      [idParam, numericId]
    );

    if (existingRows.length === 0) {
      throw new AppError('Không tìm thấy đơn hàng.', 404);
    }

    const order = existingRows[0];

    if (order.OrderStatus !== 'cancelled') {
      const [itemRows] = await conn.query(
        'SELECT ProductId, Quantity FROM OrderItems WHERE OrderId = ?',
        [order.OrderId]
      );

      const aggregatedItems = aggregateQuantitiesByProductId(itemRows);
      for (const [pid, qty] of aggregatedItems) {
        // eslint-disable-next-line no-await-in-loop
        await conn.query(
          'UPDATE Products SET StockCount = StockCount + ? WHERE ProductId = ?',
          [qty, pid]
        );
      }
    }

    await conn.query('DELETE FROM Orders WHERE OrderId = ?', [order.OrderId]);

    await conn.commit();

    return { message: 'Đã xóa đơn hàng.' };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function listOrderItems({ orderId } = {}) {
  const pool = await poolPromise;

  if (orderId !== undefined && orderId !== null && String(orderId).trim() !== '') {
    const cleanOid = String(orderId).trim().replace(/^#/, '');
    const numericId = /^\d+$/.test(cleanOid) ? Number(cleanOid) : -1;
    const [rows] = await pool.query(
      `
        SELECT oi.*
        FROM OrderItems oi
        INNER JOIN Orders o ON o.OrderId = oi.OrderId
        WHERE o.OrderId = ?
           OR UPPER(o.OrderCode) = UPPER(?)
        ORDER BY oi.OrderItemId DESC
      `,
      [numericId, cleanOid]
    );
    return rows;
  }

  const [rows] = await pool.query(
    'SELECT * FROM OrderItems ORDER BY OrderItemId DESC'
  );
  return rows;
}

async function getAnalyticsOverview() {
  const pool = await poolPromise;

  const [
    [orderStatsRows],
    [bookingStatsRows],
    [lowStockRows],
    [monthlyTrendRows],
    [topProductsRows],
  ] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) AS totalOrders,
        IFNULL(SUM(CASE WHEN OrderStatus = 'pending' THEN 1 ELSE 0 END), 0) AS pendingOrders,
        IFNULL(SUM(CASE WHEN OrderStatus = 'completed' THEN 1 ELSE 0 END), 0) AS completedOrders,
        IFNULL(SUM(CASE WHEN OrderStatus <> 'cancelled' AND PaymentMethod IN ('vnpay', 'momo') THEN TotalAmount ELSE 0 END), 0) AS transferRevenue,
        IFNULL(SUM(CASE WHEN OrderStatus <> 'cancelled' AND PaymentMethod = 'cod' THEN TotalAmount ELSE 0 END), 0) AS cashRevenue,
        IFNULL(SUM(CASE WHEN OrderStatus = 'completed' THEN TotalAmount ELSE 0 END), 0) AS collectedRevenue
      FROM Orders
    `),
    pool.query(`
      SELECT
        COUNT(*) AS totalBookings,
        IFNULL(SUM(CASE WHEN Status = 'upcoming' THEN 1 ELSE 0 END), 0) AS upcomingBookings,
        IFNULL(SUM(CASE WHEN Status = 'completed' THEN Price ELSE 0 END), 0) AS spaRevenue
      FROM ServiceBookings
    `),
    pool.query(`
      SELECT *
      FROM Products
      WHERE IsActive = 1 AND StockCount <= 15
      ORDER BY StockCount ASC, CreatedAt DESC
    `),
    pool.query(`
      SELECT
        MONTH(CreatedAt) AS monthNum,
        COUNT(*) AS orders,
        IFNULL(SUM(CASE WHEN PaymentMethod IN ('vnpay', 'momo') THEN TotalAmount ELSE 0 END), 0) AS transfer,
        IFNULL(SUM(CASE WHEN PaymentMethod = 'cod' THEN TotalAmount ELSE 0 END), 0) AS cash,
        IFNULL(SUM(TotalAmount), 0) AS revenue
      FROM Orders
      WHERE OrderStatus <> 'cancelled' AND YEAR(CreatedAt) = YEAR(UTC_TIMESTAMP())
      GROUP BY MONTH(CreatedAt)
      ORDER BY monthNum ASC
    `),
    pool.query(`
      SELECT
        COALESCE(oi.ProductId, oi.ProductName) AS productKey,
        MAX(oi.ProductId) AS productId,
        MAX(oi.ProductName) AS productName,
        MAX(oi.ProductImage) AS productImage,
        SUM(oi.Quantity) AS soldQuantity,
        SUM(oi.UnitPrice * oi.Quantity) AS totalRevenue
      FROM OrderItems oi
      INNER JOIN Orders o ON o.OrderId = oi.OrderId
      WHERE o.OrderStatus <> 'cancelled'
      GROUP BY COALESCE(oi.ProductId, oi.ProductName)
      ORDER BY soldQuantity DESC, totalRevenue DESC
      LIMIT 5
    `),
  ]);

  const rawOrders = orderStatsRows[0] || {};
  const orders = {
    totalOrders: Number(rawOrders.totalOrders || 0),
    pendingOrders: Number(rawOrders.pendingOrders || 0),
    completedOrders: Number(rawOrders.completedOrders || 0),
    transferRevenue: Number(rawOrders.transferRevenue || 0),
    cashRevenue: Number(rawOrders.cashRevenue || 0),
    collectedRevenue: Number(rawOrders.collectedRevenue || 0),
  };

  const rawBookings = bookingStatsRows[0] || {};
  const bookings = {
    totalBookings: Number(rawBookings.totalBookings || 0),
    upcomingBookings: Number(rawBookings.upcomingBookings || 0),
    spaRevenue: Number(rawBookings.spaRevenue || 0),
  };

  const lowStockProducts = lowStockRows.map((row) => mapProductRow(row, []));
  const lowStockCount = lowStockProducts.length;
  const totalCombinedRevenue =
    Number(orders.collectedRevenue || 0) + Number(bookings.spaRevenue || 0);

  const topProducts = topProductsRows.map((r) => ({
    id: r.productId || r.productKey,
    productId: r.productId || null,
    name: r.productName,
    productName: r.productName,
    image: r.productImage,
    productImage: r.productImage,
    soldQuantity: Number(r.soldQuantity || 0),
    revenue: Number(r.totalRevenue || 0),
  }));

  const monthlyTrend = monthlyTrendRows.map((m) => ({
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
  const [[orderRows], [spaRows]] = await Promise.all([
    pool.query(
      `
        SELECT *
        FROM Orders
        WHERE DATE(CreatedAt) = CAST(? AS DATE)
          AND DATE_FORMAT(CreatedAt, '%H:%i') BETWEEN ? AND ?
        ORDER BY CreatedAt DESC, OrderId DESC
      `,
      [dateStr, lo, hi]
    ),
    pool.query(
      `
        SELECT
          COUNT(*) AS spaBookings,
          IFNULL(SUM(Price), 0) AS spaRevenue
        FROM ServiceBookings
        WHERE BookingDate = CAST(? AS DATE)
          AND Status = 'completed'
      `,
      [dateStr]
    ),
  ]);

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

  const spaRow = spaRows[0] || {};
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
    const [[orderMonthRows], [spaMonthRows]] = await Promise.all([
      pool.query(
        `
          SELECT
            MONTH(CreatedAt) AS monthNum,
            COUNT(*) AS orders,
            IFNULL(SUM(CASE WHEN PaymentMethod IN ('vnpay', 'momo') THEN TotalAmount ELSE 0 END), 0) AS transfer,
            IFNULL(SUM(CASE WHEN PaymentMethod = 'cod' THEN TotalAmount ELSE 0 END), 0) AS cash,
            IFNULL(SUM(TotalAmount), 0) AS orderRevenue
          FROM Orders
          WHERE OrderStatus <> 'cancelled' AND YEAR(CreatedAt) = ?
          GROUP BY MONTH(CreatedAt)
        `,
        [year]
      ),
      pool.query(
        `
          SELECT
            MONTH(BookingDate) AS monthNum,
            IFNULL(SUM(Price), 0) AS spaRevenue
          FROM ServiceBookings
          WHERE Status = 'completed' AND YEAR(BookingDate) = ?
          GROUP BY MONTH(BookingDate)
        `,
        [year]
      ),
    ]);

    const ordByMonth = {};
    for (const r of orderMonthRows) {
      ordByMonth[Number(r.monthNum)] = r;
    }

    const spaByMonth = {};
    for (const r of spaMonthRows) {
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

  const [[orderYearRows], [spaYearRows]] = await Promise.all([
    pool.query(
      `
        SELECT
          YEAR(CreatedAt) AS yearNum,
          COUNT(*) AS orders,
          IFNULL(SUM(CASE WHEN PaymentMethod IN ('vnpay', 'momo') THEN TotalAmount ELSE 0 END), 0) AS transfer,
          IFNULL(SUM(CASE WHEN PaymentMethod = 'cod' THEN TotalAmount ELSE 0 END), 0) AS cash,
          IFNULL(SUM(TotalAmount), 0) AS orderRevenue
        FROM Orders
        WHERE OrderStatus <> 'cancelled'
          AND YEAR(CreatedAt) BETWEEN ? AND ?
        GROUP BY YEAR(CreatedAt)
      `,
      [startYear, endYear]
    ),
    pool.query(
      `
        SELECT
          YEAR(BookingDate) AS yearNum,
          IFNULL(SUM(Price), 0) AS spaRevenue
        FROM ServiceBookings
        WHERE Status = 'completed'
          AND YEAR(BookingDate) BETWEEN ? AND ?
        GROUP BY YEAR(BookingDate)
      `,
      [startYear, endYear]
    ),
  ]);

  const ordByYear = {};
  for (const r of orderYearRows) {
    ordByYear[Number(r.yearNum)] = r;
  }

  const spaByYear = {};
  for (const r of spaYearRows) {
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
