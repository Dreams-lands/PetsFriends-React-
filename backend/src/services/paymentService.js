const crypto = require('crypto');
const { poolPromise } = require('../../../api/db');
const {
  normalizePhoneDigits,
  formatPaymentStatusLabel,
} = require('../utils/mappers');
const { AppError } = require('./userService');
const orderService = require('./orderService');

// ============================================================================
// Hằng số & cấu hình cổng thanh toán
// ============================================================================
const GATEWAYS = ['cod', 'vnpay', 'momo'];
const VALID_PAYMENT_STATUSES = ['unpaid', 'paid', 'failed', 'refunded'];
const VALID_TX_STATUSES = ['pending', 'success', 'failed', 'refunded'];

const VNPAY_SANDBOX_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
const VNPAY_PRODUCTION_URL = 'https://pay.vnpay.vn/vpcpay.html';
const MOMO_SANDBOX_URL = 'https://test-payment.momo.vn/v2/gateway/api/create';
const MOMO_PRODUCTION_URL = 'https://payment.momo.vn/v2/gateway/api/create';

const VNPAY_RESPONSE_MESSAGES = {
  '00': 'Giao dịch thành công.',
  '07': 'Trừ tiền thành công nhưng giao dịch bị nghi ngờ (liên quan tới lừa đảo, giao dịch bất thường).',
  '09': 'Thẻ/Tài khoản chưa đăng ký dịch vụ InternetBanking.',
  '10': 'Xác thực thông tin thẻ/tài khoản không đúng quá 3 lần.',
  '11': 'Đã hết hạn chờ thanh toán.',
  '12': 'Thẻ/Tài khoản bị khóa.',
  '13': 'Nhập sai mật khẩu xác thực giao dịch (OTP).',
  '24': 'Khách hàng đã hủy giao dịch.',
  '51': 'Tài khoản không đủ số dư để thực hiện giao dịch.',
  '65': 'Tài khoản đã vượt quá hạn mức giao dịch trong ngày.',
  '75': 'Ngân hàng thanh toán đang bảo trì.',
  '79': 'Nhập sai mật khẩu thanh toán quá số lần quy định.',
  '99': 'Lỗi không xác định từ cổng thanh toán.',
};

function apiBaseUrl() {
  return (
    process.env.API_PUBLIC_URL ||
    `http://localhost:${process.env.PORT || 5000}`
  ).replace(/\/+$/, '');
}

function maskSecret(value) {
  if (!value) return '';
  const str = String(value);
  return `•••• •••• ${str.slice(-4)}`;
}

function isMaskedValue(value) {
  return typeof value === 'string' && value.includes('•');
}

function cleanPhone(raw) {
  return normalizePhoneDigits(raw);
}

function cleanOrderCode(raw) {
  return String(raw || '')
    .trim()
    .replace(/^#/, '')
    .toUpperCase();
}

function normalizeClientIp(req) {
  const forwarded = req && req.headers ? req.headers['x-forwarded-for'] : '';
  let ip =
    (forwarded && String(forwarded).split(',')[0].trim()) ||
    (req && req.socket && req.socket.remoteAddress) ||
    '127.0.0.1';
  ip = String(ip).replace(/^::ffff:/, '');
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

/** Định dạng thời gian yyyyMMddHHmmss theo múi giờ Việt Nam (GMT+7) cho VNPay */
function formatVnpDate(date) {
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return shifted.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function removeVietnameseTones(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function mapTransactionRow(row) {
  return {
    transactionId: row.TransactionId,
    orderId: row.OrderId,
    orderCode: row.OrderCode || undefined,
    customerName: row.CustomerName || undefined,
    txnRef: row.TxnRef,
    gateway: row.Gateway,
    amount: Number(row.Amount || 0),
    status: row.Status,
    bankCode: row.BankCode || null,
    gatewayTransNo: row.GatewayTransNo || null,
    responseCode: row.ResponseCode || null,
    payUrl: row.PayUrl || null,
    note: row.Note || null,
    createdBy: row.CreatedBy || null,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,
  };
}

// ============================================================================
// 1. Cấu hình cổng thanh toán (PaymentGatewayConfigs)
// ============================================================================
async function loadGatewayRows(pool) {
  const [rows] = await pool.query('SELECT * FROM PaymentGatewayConfigs');
  const byGateway = {};
  for (const row of rows) byGateway[row.Gateway] = row;
  return byGateway;
}

function buildGatewayResponse(byGateway, includeSecrets = false) {
  const cod = byGateway.cod || {};
  const vnpay = byGateway.vnpay || {};
  const momo = byGateway.momo || {};
  const secret = (v) => (includeSecrets ? v || '' : maskSecret(v));

  const gateways = GATEWAYS.map((gw) => {
    const row = byGateway[gw] || {};
    return {
      gateway: gw,
      displayName: row.DisplayName || gw.toUpperCase(),
      isEnabled: row.IsEnabled === undefined ? true : Boolean(row.IsEnabled),
      environment: row.Environment || (gw === 'cod' ? 'production' : 'sandbox'),
      merchantCode: row.MerchantCode || '',
      accessKey: secret(row.AccessKey),
      secretKey: secret(row.SecretKey),
      note: row.Note || '',
      updatedAt: row.UpdatedAt || null,
    };
  });

  return {
    codEnabled: cod.IsEnabled === undefined ? true : Boolean(cod.IsEnabled),
    codNote: cod.Note || '',
    vnpayEnabled: vnpay.IsEnabled === undefined ? true : Boolean(vnpay.IsEnabled),
    vnpayTmnCode: vnpay.MerchantCode || '',
    vnpayEnvironment: vnpay.Environment || 'sandbox',
    vnpayHashSecret: secret(vnpay.SecretKey),
    momoEnabled: momo.IsEnabled === undefined ? true : Boolean(momo.IsEnabled),
    momoPartnerCode: momo.MerchantCode || '',
    momoEnvironment: momo.Environment || 'sandbox',
    momoAccessKey: secret(momo.AccessKey),
    momoSecretKey: secret(momo.SecretKey),
    enabledMethods: gateways.filter((g) => g.isEnabled).map((g) => g.gateway),
    gateways,
  };
}

async function getPaymentGateways({ includeSecrets = false } = {}) {
  const pool = await poolPromise;
  const byGateway = await loadGatewayRows(pool);
  return buildGatewayResponse(byGateway, includeSecrets);
}

async function updatePaymentGateways(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Dữ liệu cấu hình cổng thanh toán không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const byGateway = await loadGatewayRows(pool);

  const patches = { cod: {}, vnpay: {}, momo: {} };
  if (Array.isArray(payload.gateways)) {
    for (const g of payload.gateways) {
      const key = String(g && g.gateway ? g.gateway : '').toLowerCase();
      if (!GATEWAYS.includes(key)) continue;
      patches[key] = {
        isEnabled: g.isEnabled,
        environment: g.environment,
        merchantCode: g.merchantCode,
        accessKey: g.accessKey,
        secretKey: g.secretKey,
        note: g.note,
        displayName: g.displayName,
      };
    }
  }
  const flat = payload;
  if (flat.codEnabled !== undefined) patches.cod.isEnabled = flat.codEnabled;
  if (flat.codNote !== undefined) patches.cod.note = flat.codNote;
  if (flat.vnpayEnabled !== undefined) patches.vnpay.isEnabled = flat.vnpayEnabled;
  if (flat.vnpayTmnCode !== undefined) patches.vnpay.merchantCode = flat.vnpayTmnCode;
  if (flat.vnpayEnvironment !== undefined) patches.vnpay.environment = flat.vnpayEnvironment;
  if (flat.vnpayHashSecret !== undefined) patches.vnpay.secretKey = flat.vnpayHashSecret;
  if (flat.momoEnabled !== undefined) patches.momo.isEnabled = flat.momoEnabled;
  if (flat.momoPartnerCode !== undefined) patches.momo.merchantCode = flat.momoPartnerCode;
  if (flat.momoEnvironment !== undefined) patches.momo.environment = flat.momoEnvironment;
  if (flat.momoAccessKey !== undefined) patches.momo.accessKey = flat.momoAccessKey;
  if (flat.momoSecretKey !== undefined) patches.momo.secretKey = flat.momoSecretKey;

  const merged = {};
  for (const gw of GATEWAYS) {
    const row = byGateway[gw] || {};
    const p = patches[gw];
    const environment =
      p.environment !== undefined
        ? String(p.environment).trim()
        : row.Environment || (gw === 'cod' ? 'production' : 'sandbox');
    if (!['sandbox', 'production'].includes(environment)) {
      throw new AppError(
        `Môi trường của cổng ${gw.toUpperCase()} chỉ nhận 'sandbox' hoặc 'production'.`,
        400
      );
    }
    const pickSecret = (incoming, current) => {
      if (incoming === undefined || incoming === null || isMaskedValue(incoming)) {
        return current || null;
      }
      const v = String(incoming).trim();
      return v || null;
    };
    merged[gw] = {
      displayName:
        p.displayName !== undefined && String(p.displayName).trim()
          ? String(p.displayName).trim()
          : row.DisplayName || gw.toUpperCase(),
      isEnabled:
        p.isEnabled !== undefined
          ? Boolean(p.isEnabled)
          : row.IsEnabled === undefined
            ? true
            : Boolean(row.IsEnabled),
      environment,
      merchantCode:
        p.merchantCode !== undefined
          ? String(p.merchantCode || '').trim() || null
          : row.MerchantCode || null,
      accessKey: pickSecret(p.accessKey, row.AccessKey),
      secretKey: pickSecret(p.secretKey, row.SecretKey),
      note:
        p.note !== undefined
          ? String(p.note || '').trim() || null
          : row.Note || null,
    };
  }

  if (!GATEWAYS.some((gw) => merged[gw].isEnabled)) {
    throw new AppError('Cần bật ít nhất 1 phương thức thanh toán cho cửa hàng.', 400);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const gw of GATEWAYS) {
      const m = merged[gw];
      // eslint-disable-next-line no-await-in-loop
      await conn.query(
        `
          INSERT INTO PaymentGatewayConfigs
            (Gateway, DisplayName, IsEnabled, Environment, MerchantCode, AccessKey, SecretKey, Note, UpdatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())
          ON DUPLICATE KEY UPDATE
            DisplayName = VALUES(DisplayName),
            IsEnabled = VALUES(IsEnabled),
            Environment = VALUES(Environment),
            MerchantCode = VALUES(MerchantCode),
            AccessKey = VALUES(AccessKey),
            SecretKey = VALUES(SecretKey),
            Note = VALUES(Note),
            UpdatedAt = UTC_TIMESTAMP()
        `,
        [
          gw,
          m.displayName.slice(0, 100),
          m.isEnabled ? 1 : 0,
          m.environment,
          m.merchantCode ? m.merchantCode.slice(0, 100) : null,
          m.accessKey ? m.accessKey.slice(0, 200) : null,
          m.secretKey ? m.secretKey.slice(0, 300) : null,
          m.note ? m.note.slice(0, 400) : null,
        ]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }

  return getPaymentGateways({ includeSecrets: false });
}

async function resolveVnpayConfig(pool) {
  const byGateway = await loadGatewayRows(pool);
  const row = byGateway.vnpay || {};
  const environment = row.Environment || 'sandbox';
  return {
    isEnabled: row.IsEnabled === undefined ? true : Boolean(row.IsEnabled),
    environment,
    tmnCode: process.env.VNPAY_TMN_CODE || row.MerchantCode || '',
    hashSecret: process.env.VNPAY_HASH_SECRET || row.SecretKey || '',
    payUrl:
      process.env.VNPAY_URL ||
      (environment === 'production' ? VNPAY_PRODUCTION_URL : VNPAY_SANDBOX_URL),
    returnUrl:
      process.env.VNPAY_RETURN_URL || `${apiBaseUrl()}/api/payments/vnpay/return`,
  };
}

async function resolveMomoConfig(pool) {
  const byGateway = await loadGatewayRows(pool);
  const row = byGateway.momo || {};
  const environment = row.Environment || 'sandbox';
  return {
    isEnabled: row.IsEnabled === undefined ? true : Boolean(row.IsEnabled),
    environment,
    partnerCode: process.env.MOMO_PARTNER_CODE || row.MerchantCode || '',
    accessKey: process.env.MOMO_ACCESS_KEY || row.AccessKey || '',
    secretKey: process.env.MOMO_SECRET_KEY || row.SecretKey || '',
    endpoint:
      process.env.MOMO_ENDPOINT ||
      (environment === 'production' ? MOMO_PRODUCTION_URL : MOMO_SANDBOX_URL),
    redirectUrl:
      process.env.MOMO_REDIRECT_URL || `${apiBaseUrl()}/api/payments/momo/return`,
    ipnUrl: process.env.MOMO_IPN_URL || `${apiBaseUrl()}/api/payments/momo/ipn`,
  };
}

// ============================================================================
// 2. Chữ ký bảo mật VNPay (HMAC-SHA512) & MoMo (HMAC-SHA256)
// ============================================================================
function buildVnpaySignData(params) {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map(
      (k) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k])).replace(/%20/g, '+')}`
    )
    .join('&');
}

function signVnpay(params, hashSecret) {
  const signData = buildVnpaySignData(params);
  const secureHash = crypto
    .createHmac('sha512', hashSecret)
    .update(Buffer.from(signData, 'utf-8'))
    .digest('hex');
  return { signData, secureHash };
}

function verifyVnpaySignature(query, hashSecret) {
  const params = { ...query };
  const received = String(params.vnp_SecureHash || '');
  delete params.vnp_SecureHash;
  delete params.vnp_SecureHashType;
  const vnpParams = {};
  for (const k of Object.keys(params)) {
    if (k.startsWith('vnp_')) vnpParams[k] = params[k];
  }
  const { secureHash } = signVnpay(vnpParams, hashSecret);
  return Boolean(received) && secureHash.toLowerCase() === received.toLowerCase();
}

function signMomo(rawSignature, secretKey) {
  return crypto.createHmac('sha256', secretKey).update(rawSignature).digest('hex');
}

function buildMomoResultRawSignature(accessKey, data) {
  return (
    `accessKey=${accessKey}` +
    `&amount=${data.amount ?? ''}` +
    `&extraData=${data.extraData ?? ''}` +
    `&message=${data.message ?? ''}` +
    `&orderId=${data.orderId ?? ''}` +
    `&orderInfo=${data.orderInfo ?? ''}` +
    `&orderType=${data.orderType ?? ''}` +
    `&partnerCode=${data.partnerCode ?? ''}` +
    `&payType=${data.payType ?? ''}` +
    `&requestId=${data.requestId ?? ''}` +
    `&responseTime=${data.responseTime ?? ''}` +
    `&resultCode=${data.resultCode ?? ''}` +
    `&transId=${data.transId ?? ''}`
  );
}

// ============================================================================
// 3. Truy vấn đơn hàng & kiểm tra quyền sở hữu
// ============================================================================
async function loadOrderRow(connOrPool, orderCode, lock = false) {
  const code = cleanOrderCode(orderCode);
  if (!code) throw new AppError('Mã đơn hàng không hợp lệ.', 400);
  const numericId = /^\d+$/.test(code) ? Number(code) : -1;
  const [rows] = await connOrPool.query(
    `
      SELECT *
      FROM Orders
      WHERE UPPER(OrderCode) = ? OR OrderId = ?
      LIMIT 1
      ${lock ? 'FOR UPDATE' : ''}
    `,
    [code, numericId]
  );
  if (rows.length === 0) {
    throw new AppError('Không tìm thấy đơn hàng.', 404);
  }
  return rows[0];
}

function assertOrderAccess(order, { requester = null, phone = '' } = {}) {
  const isStaffOrAdmin = Boolean(
    requester && (requester.role === 'admin' || requester.role === 'staff')
  );
  if (isStaffOrAdmin) return;

  const isOwnerByUser = Boolean(
    requester &&
      requester.userId != null &&
      order.UserId != null &&
      Number(requester.userId) === Number(order.UserId)
  );
  const provided = cleanPhone(phone);
  const isOwnerByPhone = Boolean(
    provided && provided === cleanPhone(order.CustomerPhone)
  );
  if (!isOwnerByUser && !isOwnerByPhone) {
    throw new AppError(
      'Bạn không có quyền thao tác thanh toán trên đơn hàng này (cần đăng nhập đúng tài khoản hoặc cung cấp đúng SĐT đặt hàng).',
      403
    );
  }
}

function assertOrderPayable(order, expectedGateway) {
  if (order.OrderStatus === 'cancelled') {
    throw new AppError('Đơn hàng đã bị hủy, không thể thanh toán.', 400);
  }
  if (order.PaymentStatus === 'paid') {
    throw new AppError('Đơn hàng này đã được thanh toán.', 409);
  }
  if (order.PaymentStatus === 'refunded') {
    throw new AppError('Đơn hàng đã được hoàn tiền, không thể thanh toán lại.', 400);
  }
  if (expectedGateway && order.PaymentMethod !== expectedGateway) {
    throw new AppError(
      `Đơn hàng đã chọn phương thức "${String(order.PaymentMethod).toUpperCase()}", không thể thanh toán qua ${expectedGateway.toUpperCase()}.`,
      400
    );
  }
  if (Number(order.TotalAmount || 0) <= 0) {
    throw new AppError('Tổng tiền đơn hàng không hợp lệ để thanh toán trực tuyến.', 400);
  }
}

async function getMappedOrder(pool, orderId) {
  const [rows] = await pool.query('SELECT * FROM Orders WHERE OrderId = ?', [
    orderId,
  ]);
  if (rows.length === 0) return null;
  const [mapped] = await orderService.attachItemsToOrders(pool, rows);
  return mapped;
}

// ============================================================================
// 4. VNPay: Tạo URL thanh toán, xử lý Return URL & IPN
// ============================================================================
async function createVnpayPayment(orderCode, options = {}) {
  const {
    requester = null,
    phone = '',
    bankCode = '',
    locale = 'vn',
    ipAddr = '127.0.0.1',
    returnUrl = '',
  } = options;

  const pool = await poolPromise;
  const order = await loadOrderRow(pool, orderCode);
  assertOrderAccess(order, { requester, phone });
  assertOrderPayable(order, 'vnpay');

  const cfg = await resolveVnpayConfig(pool);
  if (!cfg.isEnabled) {
    throw new AppError('Cổng thanh toán VNPay hiện đang tạm ngưng.', 400);
  }
  if (!cfg.tmnCode || !cfg.hashSecret) {
    throw new AppError(
      'Chưa cấu hình vnp_TmnCode / vnp_HashSecret cho cổng VNPay. Vui lòng cập nhật tại PUT /api/payment-gateways.',
      500
    );
  }

  const now = new Date();
  const expireAt = new Date(now.getTime() + 15 * 60 * 1000);
  const txnRef = `${order.OrderCode}${Date.now().toString().slice(-8)}`;
  const amount = Number(order.TotalAmount);

  const vnpParams = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: cfg.tmnCode,
    vnp_Locale: locale === 'en' ? 'en' : 'vn',
    vnp_CurrCode: 'VND',
    vnp_TxnRef: txnRef,
    vnp_OrderInfo: removeVietnameseTones(`Thanh toan don hang ${order.OrderCode} PetsFriend`),
    vnp_OrderType: 'other',
    vnp_Amount: String(Math.round(amount * 100)),
    vnp_ReturnUrl: returnUrl || cfg.returnUrl,
    vnp_IpAddr: ipAddr,
    vnp_CreateDate: formatVnpDate(now),
    vnp_ExpireDate: formatVnpDate(expireAt),
  };
  if (bankCode && /^[A-Za-z0-9_]+$/.test(String(bankCode))) {
    vnpParams.vnp_BankCode = String(bankCode).toUpperCase();
  }

  const { signData, secureHash } = signVnpay(vnpParams, cfg.hashSecret);
  const paymentUrl = `${cfg.payUrl}?${signData}&vnp_SecureHash=${secureHash}`;

  await pool.query(
    `
      INSERT INTO PaymentTransactions (OrderId, TxnRef, Gateway, Amount, Status, BankCode, PayUrl, Note, CreatedBy)
      VALUES (?, ?, 'vnpay', ?, 'pending', ?, ?, 'Khởi tạo giao dịch VNPay', ?)
    `,
    [
      order.OrderId,
      txnRef,
      amount,
      vnpParams.vnp_BankCode || null,
      paymentUrl.slice(0, 2000),
      requester && requester.username ? String(requester.username).slice(0, 120) : null,
    ]
  );

  return {
    message: 'Đã tạo liên kết thanh toán VNPay.',
    gateway: 'vnpay',
    environment: cfg.environment,
    orderCode: order.OrderCode,
    txnRef,
    amount,
    expireAt: expireAt.toISOString(),
    paymentUrl,
    qrScanUrl: `${apiBaseUrl()}/api/payments/qr-scan/${encodeURIComponent(txnRef)}`,
  };
}

/**
 * Xử lý kết quả VNPay trả về (dùng chung cho Return URL & IPN).
 */
async function processVnpayResult(query = {}) {
  const pool = await poolPromise;
  const cfg = await resolveVnpayConfig(pool);

  if (!cfg.hashSecret || !verifyVnpaySignature(query, cfg.hashSecret)) {
    return { RspCode: '97', Message: 'Invalid signature', success: false };
  }

  const txnRef = String(query.vnp_TxnRef || '');
  const responseCode = String(query.vnp_ResponseCode || '');
  const transactionStatus =
    query.vnp_TransactionStatus !== undefined ? String(query.vnp_TransactionStatus) : '00';
  const paidAmount = Number(query.vnp_Amount || 0) / 100;
  const isSuccess = responseCode === '00' && transactionStatus === '00';

  return finalizeGatewayTransaction(pool, {
    txnRef,
    gateway: 'vnpay',
    paidAmount,
    isSuccess,
    responseCode,
    bankCode: query.vnp_BankCode || null,
    gatewayTransNo: query.vnp_TransactionNo || null,
    rawData: query,
    failureMessage: VNPAY_RESPONSE_MESSAGES[responseCode] || 'Giao dịch VNPay không thành công.',
  });
}

/**
 * Chốt kết quả giao dịch cổng online (VNPay / MoMo) trong MySQL Transaction.
 * Mã phản hồi theo chuẩn IPN VNPay: 00 OK, 01 không tìm thấy, 02 đã xác nhận, 04 sai số tiền.
 */
async function finalizeGatewayTransaction(pool, data) {
  const {
    txnRef,
    gateway,
    paidAmount,
    isSuccess,
    responseCode,
    bankCode,
    gatewayTransNo,
    rawData,
    failureMessage,
  } = data;

  const conn = await pool.getConnection();
  let committed = false;
  try {
    await conn.beginTransaction();

    const [txRows] = await conn.query(
      `
        SELECT t.*, o.OrderCode, o.OrderStatus, o.PaymentStatus AS OrderPaymentStatus, o.TotalAmount
        FROM PaymentTransactions t
        INNER JOIN Orders o ON o.OrderId = t.OrderId
        WHERE t.TxnRef = ? AND t.Gateway = ?
        LIMIT 1
        FOR UPDATE
      `,
      [txnRef, gateway]
    );

    if (txRows.length === 0) {
      await conn.rollback();
      committed = true;
      return { RspCode: '01', Message: 'Order not found', success: false };
    }

    const tx = txRows[0];

    if (Math.round(Number(tx.Amount)) !== Math.round(Number(paidAmount))) {
      await conn.rollback();
      committed = true;
      return {
        RspCode: '04',
        Message: 'Invalid amount',
        success: false,
        orderCode: tx.OrderCode,
      };
    }

    if (tx.Status !== 'pending') {
      await conn.commit();
      committed = true;
      return {
        RspCode: '02',
        Message: 'Order already confirmed',
        success: tx.Status === 'success',
        alreadyProcessed: true,
        orderCode: tx.OrderCode,
        responseCode: tx.ResponseCode,
        order: await getMappedOrder(pool, tx.OrderId),
      };
    }

    const rawJson = JSON.stringify(rawData || {}).slice(0, 8000);

    if (isSuccess) {
      const orderCancelled = tx.OrderStatus === 'cancelled';
      await conn.query(
        `
          UPDATE PaymentTransactions
          SET Status = ?,
              BankCode = COALESCE(?, BankCode),
              GatewayTransNo = ?,
              ResponseCode = ?,
              Note = ?,
              RawData = ?,
              UpdatedAt = UTC_TIMESTAMP()
          WHERE TransactionId = ?
        `,
        [
          orderCancelled ? 'refunded' : 'success',
          bankCode ? String(bankCode).slice(0, 30) : null,
          gatewayTransNo ? String(gatewayTransNo).slice(0, 60) : null,
          String(responseCode).slice(0, 20),
          orderCancelled
            ? 'Thanh toán thành công nhưng đơn đã hủy -> cần hoàn tiền'
            : 'Thanh toán thành công',
          rawJson,
          tx.TransactionId,
        ]
      );

      await conn.query(
        `
          UPDATE Orders
          SET PaymentStatus = ?, PaidAt = UTC_TIMESTAMP()
          WHERE OrderId = ?
        `,
        [orderCancelled ? 'refunded' : 'paid', tx.OrderId]
      );

      await conn.query(
        `
          UPDATE PaymentTransactions
          SET Status = 'failed',
              Note = 'Bị thay thế bởi giao dịch thanh toán thành công khác',
              UpdatedAt = UTC_TIMESTAMP()
          WHERE OrderId = ? AND Status = 'pending' AND TransactionId <> ?
        `,
        [tx.OrderId, tx.TransactionId]
      );
    } else {
      await conn.query(
        `
          UPDATE PaymentTransactions
          SET Status = 'failed',
              BankCode = COALESCE(?, BankCode),
              GatewayTransNo = ?,
              ResponseCode = ?,
              Note = ?,
              RawData = ?,
              UpdatedAt = UTC_TIMESTAMP()
          WHERE TransactionId = ?
        `,
        [
          bankCode ? String(bankCode).slice(0, 30) : null,
          gatewayTransNo ? String(gatewayTransNo).slice(0, 60) : null,
          String(responseCode).slice(0, 20),
          String(failureMessage || 'Giao dịch thất bại').slice(0, 400),
          rawJson,
          tx.TransactionId,
        ]
      );

      await conn.query(
        `
          UPDATE Orders
          SET PaymentStatus = 'failed'
          WHERE OrderId = ? AND PaymentStatus = 'unpaid'
        `,
        [tx.OrderId]
      );
    }

    await conn.commit();
    committed = true;

    return {
      RspCode: '00',
      Message: 'Confirm Success',
      success: isSuccess,
      orderCode: tx.OrderCode,
      responseCode,
      message: isSuccess ? 'Thanh toán đơn hàng thành công.' : failureMessage,
      order: await getMappedOrder(pool, tx.OrderId),
    };
  } catch (err) {
    if (!committed) {
      await conn.rollback().catch(() => {});
    }
    throw err;
  } finally {
    conn.release();
  }
}

// ============================================================================
// 5. MoMo: Tạo yêu cầu thanh toán (captureWallet), Redirect & IPN
// ============================================================================
async function createMomoPayment(orderCode, options = {}) {
  const { requester = null, phone = '', redirectUrl = '', sandboxFallback = false } = options;

  const pool = await poolPromise;
  const order = await loadOrderRow(pool, orderCode);
  assertOrderAccess(order, { requester, phone });
  assertOrderPayable(order, 'momo');

  const amount = Math.round(Number(order.TotalAmount));
  if (amount < 1000 || amount > 50000000) {
    throw new AppError('Số tiền thanh toán MoMo phải từ 1.000₫ đến 50.000.000₫.', 400);
  }

  const cfg = await resolveMomoConfig(pool);
  if (!cfg.isEnabled) {
    throw new AppError('Cổng thanh toán MoMo hiện đang tạm ngưng.', 400);
  }
  if (!cfg.partnerCode || !cfg.accessKey || !cfg.secretKey) {
    throw new AppError(
      'Chưa cấu hình partnerCode / accessKey / secretKey cho cổng MoMo. Vui lòng cập nhật tại PUT /api/payment-gateways.',
      500
    );
  }

  const txnRef = `${order.OrderCode}${Date.now().toString().slice(-8)}`;
  const requestId = `${txnRef}R`;
  const orderInfo = `Thanh toan don hang ${order.OrderCode} PetsFriend`;
  const requestType = 'captureWallet';
  const extraData = '';
  const finalRedirect = redirectUrl || cfg.redirectUrl;

  const rawSignature =
    `accessKey=${cfg.accessKey}` +
    `&amount=${amount}` +
    `&extraData=${extraData}` +
    `&ipnUrl=${cfg.ipnUrl}` +
    `&orderId=${txnRef}` +
    `&orderInfo=${orderInfo}` +
    `&partnerCode=${cfg.partnerCode}` +
    `&redirectUrl=${finalRedirect}` +
    `&requestId=${requestId}` +
    `&requestType=${requestType}`;
  const signature = signMomo(rawSignature, cfg.secretKey);

  const body = {
    partnerCode: cfg.partnerCode,
    partnerName: 'PetsFriend',
    storeId: 'PetsFriendStore',
    requestId,
    amount,
    orderId: txnRef,
    orderInfo,
    redirectUrl: finalRedirect,
    ipnUrl: cfg.ipnUrl,
    lang: 'vi',
    requestType,
    autoCapture: true,
    extraData,
    signature,
  };

  await pool.query(
    `
      INSERT INTO PaymentTransactions (OrderId, TxnRef, Gateway, Amount, Status, Note, CreatedBy)
      VALUES (?, ?, 'momo', ?, 'pending', 'Khởi tạo giao dịch MoMo', ?)
    `,
    [
      order.OrderId,
      txnRef,
      amount,
      requester && requester.username ? String(requester.username).slice(0, 120) : null,
    ]
  );

  const qrScanUrl = `${apiBaseUrl()}/api/payments/qr-scan/${encodeURIComponent(txnRef)}`;
  const expireAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const buildLocalSandboxResponse = async (fallbackReason) => {
    const fallbackQr = `momo://app?action=payWithApp&partnerCode=${encodeURIComponent(cfg.partnerCode)}&orderId=${encodeURIComponent(txnRef)}&amount=${amount}`;
    await pool.query(
      `
        UPDATE PaymentTransactions
        SET PayUrl = ?, Note = ?, UpdatedAt = UTC_TIMESTAMP()
        WHERE TxnRef = ?
      `,
      [
        qrScanUrl.slice(0, 2000),
        `Khởi tạo QR MoMo Sandbox (${fallbackReason})`.slice(0, 400),
        txnRef,
      ]
    );
    return {
      message: 'Đã tạo mã QR thanh toán MoMo (Sandbox).',
      gateway: 'momo',
      environment: cfg.environment,
      sandboxFallback: true,
      orderCode: order.OrderCode,
      txnRef,
      amount,
      expireAt,
      paymentUrl: qrScanUrl,
      qrScanUrl,
      qrCodeUrl: fallbackQr,
      deeplink: fallbackQr,
    };
  };

  let momoRes;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    momoRes = await resp.json();
  } catch (_) {
    if (sandboxFallback && cfg.environment === 'sandbox') {
      return buildLocalSandboxResponse('chế độ offline');
    }
    await markTransactionFailed(pool, txnRef, 'Không kết nối được tới cổng MoMo');
    throw new AppError(
      'Không kết nối được tới cổng thanh toán MoMo. Vui lòng thử lại sau hoặc chọn phương thức khác.',
      502
    );
  }

  if (!momoRes || Number(momoRes.resultCode) !== 0 || !momoRes.payUrl) {
    if (sandboxFallback && cfg.environment === 'sandbox') {
      return buildLocalSandboxResponse('mô phỏng tại chỗ');
    }
    const msg = (momoRes && momoRes.message) || 'MoMo từ chối tạo giao dịch.';
    await markTransactionFailed(pool, txnRef, msg, momoRes ? String(momoRes.resultCode) : null);
    throw new AppError(`Cổng MoMo báo lỗi: ${msg}`, 502);
  }

  await pool.query(
    `
      UPDATE PaymentTransactions
      SET PayUrl = ?, UpdatedAt = UTC_TIMESTAMP()
      WHERE TxnRef = ?
    `,
    [String(momoRes.payUrl).slice(0, 2000), txnRef]
  );

  return {
    message: 'Đã tạo yêu cầu thanh toán MoMo.',
    gateway: 'momo',
    environment: cfg.environment,
    orderCode: order.OrderCode,
    txnRef,
    amount,
    expireAt,
    paymentUrl: momoRes.payUrl,
    qrScanUrl,
    qrCodeUrl: momoRes.qrCodeUrl || null,
    deeplink: momoRes.deeplink || null,
  };
}

async function markTransactionFailed(pool, txnRef, note, responseCode = null) {
  await pool.query(
    `
      UPDATE PaymentTransactions
      SET Status = 'failed',
          Note = ?,
          ResponseCode = COALESCE(?, ResponseCode),
          UpdatedAt = UTC_TIMESTAMP()
      WHERE TxnRef = ? AND Status = 'pending'
    `,
    [
      String(note || '').slice(0, 400),
      responseCode ? String(responseCode).slice(0, 20) : null,
      txnRef,
    ]
  );
}

async function processMomoResult(data = {}) {
  const pool = await poolPromise;
  const cfg = await resolveMomoConfig(pool);
  const rawSignature = buildMomoResultRawSignature(cfg.accessKey, data);
  const expected = cfg.secretKey ? signMomo(rawSignature, cfg.secretKey) : '';

  if (!expected || String(data.signature || '').toLowerCase() !== expected.toLowerCase()) {
    return { RspCode: '97', Message: 'Invalid signature', success: false };
  }

  const resultCode = String(data.resultCode ?? '');
  return finalizeGatewayTransaction(pool, {
    txnRef: String(data.orderId || ''),
    gateway: 'momo',
    paidAmount: Number(data.amount || 0),
    isSuccess: resultCode === '0',
    responseCode: resultCode,
    bankCode: data.payType || null,
    gatewayTransNo: data.transId ? String(data.transId) : null,
    rawData: data,
    failureMessage: data.message || 'Giao dịch MoMo không thành công.',
  });
}

// ============================================================================
// 6. Nghiệp vụ nội bộ: Xác nhận thu tiền thủ công, Hoàn tiền, Tra cứu, Thống kê, Hết hạn
// ============================================================================
async function getOrderPayment(orderCode, { requester = null, phone = '' } = {}) {
  const pool = await poolPromise;
  const order = await loadOrderRow(pool, orderCode);
  assertOrderAccess(order, { requester, phone });

  const [txRows] = await pool.query(
    `
      SELECT * FROM PaymentTransactions
      WHERE OrderId = ?
      ORDER BY CreatedAt DESC, TransactionId DESC
    `,
    [order.OrderId]
  );

  const ps = order.PaymentStatus || 'unpaid';
  return {
    orderCode: order.OrderCode,
    orderStatus: order.OrderStatus,
    paymentMethod: order.PaymentMethod,
    paymentStatus: ps,
    paymentStatusLabel: formatPaymentStatusLabel(ps),
    totalAmount: Number(order.TotalAmount || 0),
    paidAt: order.PaidAt || null,
    canPayOnline:
      order.OrderStatus !== 'cancelled' &&
      ['unpaid', 'failed'].includes(ps) &&
      ['vnpay', 'momo'].includes(order.PaymentMethod),
    transactions: txRows.map(mapTransactionRow),
  };
}

async function confirmManualPayment(orderCode, { method = 'cash', note = '', actorName = null } = {}) {
  const pool = await poolPromise;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const order = await loadOrderRow(conn, orderCode, true);
    if (order.OrderStatus === 'cancelled') {
      throw new AppError('Không thể xác nhận thu tiền cho đơn hàng đã hủy.', 400);
    }
    if (order.PaymentStatus === 'paid') {
      throw new AppError('Đơn hàng này đã được thanh toán.', 409);
    }

    const gateway = ['cash', 'cod', 'vnpay', 'momo', 'manual'].includes(String(method))
      ? String(method)
      : 'manual';

    await conn.query(
      `
        UPDATE PaymentTransactions
        SET Status = 'failed',
            Note = 'Đóng giao dịch chờ do nhân viên xác nhận thu tiền thủ công',
            UpdatedAt = UTC_TIMESTAMP()
        WHERE OrderId = ? AND Status = 'pending'
      `,
      [order.OrderId]
    );

    await conn.query(
      `
        INSERT INTO PaymentTransactions (OrderId, TxnRef, Gateway, Amount, Status, ResponseCode, Note, CreatedBy)
        VALUES (?, ?, ?, ?, 'success', '00', ?, ?)
      `,
      [
        order.OrderId,
        `${order.OrderCode}-MAN-${Date.now()}`,
        gateway,
        Number(order.TotalAmount || 0),
        String(note || 'Nhân viên xác nhận đã thu tiền').slice(0, 400),
        actorName ? String(actorName).slice(0, 120) : null,
      ]
    );

    await conn.query(
      `
        UPDATE Orders
        SET PaymentStatus = 'paid', PaidAt = UTC_TIMESTAMP()
        WHERE OrderId = ?
      `,
      [order.OrderId]
    );

    await conn.commit();
    return {
      message: 'Đã xác nhận thu tiền cho đơn hàng.',
      order: await getMappedOrder(pool, order.OrderId),
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function refundPayment(orderCode, { reason = '', actorName = null } = {}) {
  const pool = await poolPromise;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const order = await loadOrderRow(conn, orderCode, true);
    if (order.PaymentStatus !== 'paid') {
      throw new AppError('Chỉ có thể hoàn tiền cho đơn hàng đã thanh toán.', 400);
    }

    const refundNote = String(
      reason ? `Hoàn tiền: ${reason}` : 'Hoàn tiền cho khách hàng'
    ).slice(0, 400);

    await conn.query(
      `
        UPDATE PaymentTransactions
        SET Status = 'refunded',
            Note = LEFT(CONCAT(IFNULL(Note, ''), ' | ', ?), 400),
            CreatedBy = COALESCE(?, CreatedBy),
            UpdatedAt = UTC_TIMESTAMP()
        WHERE OrderId = ? AND Status = 'success'
      `,
      [
        refundNote,
        actorName ? String(actorName).slice(0, 120) : null,
        order.OrderId,
      ]
    );

    await conn.query(
      "UPDATE Orders SET PaymentStatus = 'refunded' WHERE OrderId = ?",
      [order.OrderId]
    );

    await conn.commit();
    return {
      message: 'Đã ghi nhận hoàn tiền cho đơn hàng.',
      order: await getMappedOrder(pool, order.OrderId),
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function listTransactions(filters = {}) {
  const { gateway, status, orderCode, fromDate, toDate, search } = filters;
  const pool = await poolPromise;
  let query = `
    SELECT t.*, o.OrderCode, o.CustomerName
    FROM PaymentTransactions t
    INNER JOIN Orders o ON o.OrderId = t.OrderId
    WHERE 1 = 1
  `;
  const params = [];

  if (gateway && gateway !== 'all') {
    query += ' AND t.Gateway = ?';
    params.push(String(gateway).trim().toLowerCase());
  }
  if (status && status !== 'all') {
    if (!VALID_TX_STATUSES.includes(String(status))) {
      throw new AppError('Trạng thái giao dịch không hợp lệ.', 400);
    }
    query += ' AND t.Status = ?';
    params.push(String(status));
  }
  if (orderCode) {
    query += ' AND UPPER(o.OrderCode) = ?';
    params.push(cleanOrderCode(orderCode));
  }
  if (fromDate) {
    query += ' AND DATE(t.CreatedAt) >= CAST(? AS DATE)';
    params.push(String(fromDate).slice(0, 10));
  }
  if (toDate) {
    query += ' AND DATE(t.CreatedAt) <= CAST(? AS DATE)';
    params.push(String(toDate).slice(0, 10));
  }
  if (search && String(search).trim()) {
    const q = `%${String(search).trim().replace(/^#/, '')}%`;
    query += ' AND (o.OrderCode LIKE ? OR t.TxnRef LIKE ? OR o.CustomerName LIKE ? OR t.GatewayTransNo LIKE ?)';
    params.push(q, q, q, q);
  }

  query += ' ORDER BY t.CreatedAt DESC, t.TransactionId DESC';
  const [rows] = await pool.query(query, params);
  return rows.map(mapTransactionRow);
}

async function getPaymentSummary({ fromDate, toDate } = {}) {
  const pool = await poolPromise;
  let where = 'WHERE 1 = 1';
  const params = [];
  if (fromDate) {
    where += ' AND DATE(CreatedAt) >= CAST(? AS DATE)';
    params.push(String(fromDate).slice(0, 10));
  }
  if (toDate) {
    where += ' AND DATE(CreatedAt) <= CAST(? AS DATE)';
    params.push(String(toDate).slice(0, 10));
  }

  const [rows] = await pool.query(
    `
      SELECT
        COUNT(*) AS totalOrders,
        SUM(CASE WHEN PaymentStatus = 'paid' THEN 1 ELSE 0 END) AS paidOrders,
        SUM(CASE WHEN PaymentStatus = 'unpaid' AND OrderStatus <> 'cancelled' THEN 1 ELSE 0 END) AS unpaidOrders,
        SUM(CASE WHEN PaymentStatus = 'failed' AND OrderStatus <> 'cancelled' THEN 1 ELSE 0 END) AS failedOrders,
        SUM(CASE WHEN PaymentStatus = 'refunded' THEN 1 ELSE 0 END) AS refundedOrders,
        SUM(CASE WHEN PaymentStatus = 'paid' THEN TotalAmount ELSE 0 END) AS collectedAmount,
        SUM(CASE WHEN PaymentStatus IN ('unpaid', 'failed') AND OrderStatus <> 'cancelled' THEN TotalAmount ELSE 0 END) AS outstandingAmount,
        SUM(CASE WHEN PaymentStatus = 'refunded' THEN TotalAmount ELSE 0 END) AS refundedAmount,
        SUM(CASE WHEN PaymentStatus = 'paid' AND PaymentMethod = 'vnpay' THEN TotalAmount ELSE 0 END) AS paidVnpay,
        SUM(CASE WHEN PaymentStatus = 'paid' AND PaymentMethod = 'momo' THEN TotalAmount ELSE 0 END) AS paidMomo,
        SUM(CASE WHEN PaymentStatus = 'paid' AND PaymentMethod = 'cod' THEN TotalAmount ELSE 0 END) AS paidCod
      FROM Orders
      ${where}
    `,
    params
  );

  const r = rows[0] || {};
  const n = (v) => Number(v || 0);
  return {
    totalOrders: n(r.totalOrders),
    paidOrders: n(r.paidOrders),
    unpaidOrders: n(r.unpaidOrders),
    failedOrders: n(r.failedOrders),
    refundedOrders: n(r.refundedOrders),
    collectedAmount: n(r.collectedAmount),
    outstandingAmount: n(r.outstandingAmount),
    refundedAmount: n(r.refundedAmount),
    byMethod: {
      vnpay: n(r.paidVnpay),
      momo: n(r.paidMomo),
      cod: n(r.paidCod),
    },
  };
}

/**
 * Tự động hủy các đơn online chọn VNPay / MoMo nhưng quá hạn chưa thanh toán.
 */
async function expireUnpaidOnlineOrders({ minutes = 30, actorName = null } = {}) {
  const mins = Number(minutes);
  if (!Number.isInteger(mins) || mins < 5 || mins > 10080) {
    throw new AppError('Thời gian hết hạn (minutes) phải là số nguyên từ 5 đến 10080 phút.', 400);
  }

  const pool = await poolPromise;
  const [rows] = await pool.query(
    `
      SELECT OrderCode
      FROM Orders
      WHERE OrderSource = 'online'
        AND OrderStatus = 'pending'
        AND PaymentMethod IN ('vnpay', 'momo')
        AND PaymentStatus IN ('unpaid', 'failed')
        AND CreatedAt < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
    `,
    [mins]
  );

  const expired = [];
  for (const row of rows) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await orderService.updateOrderStatus(row.OrderCode, {
        status: 'cancelled',
        staffName: actorName || 'Hệ thống (hết hạn thanh toán)',
      });
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `
          UPDATE PaymentTransactions t
          INNER JOIN Orders o ON o.OrderId = t.OrderId
          SET t.Status = 'failed',
              t.Note = 'Hết hạn thanh toán - đơn hàng tự động hủy',
              t.UpdatedAt = UTC_TIMESTAMP()
          WHERE o.OrderCode = ? AND t.Status = 'pending'
        `,
        [row.OrderCode]
      );
      expired.push(row.OrderCode);
    } catch (_) {
      // bỏ qua đơn lỗi, xử lý tiếp các đơn khác
    }
  }

  return {
    message: `Đã tự động hủy ${expired.length} đơn hàng quá hạn thanh toán.`,
    minutes: mins,
    expiredCount: expired.length,
    orderCodes: expired,
  };
}

async function getTransactionByRef(txnRef) {
  const cleaned = String(txnRef || '').trim();
  if (!cleaned) throw new AppError('Mã giao dịch không hợp lệ.', 400);
  const pool = await poolPromise;
  const [rows] = await pool.query(
    `
      SELECT t.*, o.OrderCode, o.CustomerName, o.CustomerPhone, o.PaymentStatus AS OrderPaymentStatus
      FROM PaymentTransactions t
      INNER JOIN Orders o ON o.OrderId = t.OrderId
      WHERE t.TxnRef = ?
      LIMIT 1
    `,
    [cleaned]
  );
  if (rows.length === 0) {
    throw new AppError('Không tìm thấy giao dịch thanh toán.', 404);
  }
  const row = rows[0];
  return {
    ...mapTransactionRow(row),
    orderCode: row.OrderCode,
    customerPhone: row.CustomerPhone,
    orderPaymentStatus: row.OrderPaymentStatus,
  };
}

/**
 * Xác nhận giả lập quét mã QR trên môi trường Sandbox (phục vụ demo/kiểm thử VNPay & MoMo).
 */
async function sandboxCompletePayment(orderCode, { requester = null, phone = '', outcome = 'success' } = {}) {
  const pool = await poolPromise;
  const order = await loadOrderRow(pool, orderCode);
  assertOrderAccess(order, { requester, phone });

  const gateway = String(order.PaymentMethod || '').toLowerCase();
  if (!['vnpay', 'momo'].includes(gateway)) {
    throw new AppError('Đơn hàng không sử dụng phương thức thanh toán QR trực tuyến (VNPay / MoMo).', 400);
  }

  assertOrderPayable(order, gateway);

  const byGateway = await loadGatewayRows(pool);
  const gwRow = byGateway[gateway] || {};
  const environment = gwRow.Environment || 'sandbox';
  if (environment !== 'sandbox') {
    throw new AppError('Chỉ hỗ trợ xác nhận giả lập quét mã QR khi cổng đang ở môi trường Sandbox.', 403);
  }

  const [pendingRows] = await pool.query(
    `
      SELECT TxnRef
      FROM PaymentTransactions
      WHERE OrderId = ? AND Gateway = ? AND Status = 'pending'
      ORDER BY CreatedAt DESC, TransactionId DESC
      LIMIT 1
    `,
    [order.OrderId, gateway]
  );

  let txnRef = pendingRows[0] ? pendingRows[0].TxnRef : null;
  const amount = Number(order.TotalAmount);

  if (!txnRef) {
    txnRef = `${order.OrderCode}${Date.now().toString().slice(-8)}`;
    await pool.query(
      `
        INSERT INTO PaymentTransactions (OrderId, TxnRef, Gateway, Amount, Status, Note, CreatedBy)
        VALUES (?, ?, ?, ?, 'pending', 'Khởi tạo giao dịch QR Sandbox', ?)
      `,
      [
        order.OrderId,
        txnRef,
        gateway,
        amount,
        requester && requester.username ? String(requester.username).slice(0, 120) : null,
      ]
    );
  }

  const normalizedOutcome = String(outcome || 'success').toLowerCase();
  const isSuccess = normalizedOutcome !== 'failed' && normalizedOutcome !== 'cancelled';

  const finalized = await finalizeGatewayTransaction(pool, {
    txnRef,
    gateway,
    paidAmount: amount,
    isSuccess,
    responseCode: isSuccess ? '00' : '24',
    bankCode: gateway === 'vnpay' ? 'VNPAYQR' : 'MOMOQR',
    gatewayTransNo: isSuccess ? `SBX${Date.now().toString().slice(-8)}` : null,
    rawData: { sandboxSimulated: true, gateway, outcome: normalizedOutcome },
    failureMessage: 'Khách hàng đã hủy giao dịch thanh toán QR.',
  });

  return {
    ...finalized,
    gateway,
    txnRef,
  };
}

module.exports = {
  VALID_PAYMENT_STATUSES,
  normalizeClientIp,
  formatVnpDate,
  buildVnpaySignData,
  signVnpay,
  verifyVnpaySignature,
  signMomo,
  buildMomoResultRawSignature,
  getPaymentGateways,
  updatePaymentGateways,
  createVnpayPayment,
  processVnpayResult,
  createMomoPayment,
  processMomoResult,
  getOrderPayment,
  confirmManualPayment,
  refundPayment,
  listTransactions,
  getPaymentSummary,
  expireUnpaidOnlineOrders,
  getTransactionByRef,
  sandboxCompletePayment,
};
