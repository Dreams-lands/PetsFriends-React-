const crypto = require('crypto');
const { sql, poolPromise } = require('../../../api/db');
const {
  mapOrderRow,
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
// 1. Cấu hình cổng thanh toán (dbo.PaymentGatewayConfigs)
// ============================================================================
async function loadGatewayRows(pool) {
  const res = await pool
    .request()
    .query('SELECT * FROM dbo.PaymentGatewayConfigs');
  const byGateway = {};
  for (const row of res.recordset) byGateway[row.Gateway] = row;
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
    // Định dạng khớp 100% với PaymentGatewayConfig của Frontend (AdminSettingsView)
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

  // Hỗ trợ 2 định dạng: (a) phẳng giống Frontend, (b) { gateways: [{ gateway, isEnabled, ... }] }
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

  // Gộp với dữ liệu hiện tại & kiểm tra hợp lệ
  const merged = {};
  for (const gw of GATEWAYS) {
    const row = byGateway[gw] || {};
    const p = patches[gw];
    const environment = p.environment !== undefined ? String(p.environment).trim() : row.Environment || (gw === 'cod' ? 'production' : 'sandbox');
    if (!['sandbox', 'production'].includes(environment)) {
      throw new AppError(`Môi trường của cổng ${gw.toUpperCase()} chỉ nhận 'sandbox' hoặc 'production'.`, 400);
    }
    const pickSecret = (incoming, current) => {
      if (incoming === undefined || incoming === null || isMaskedValue(incoming)) return current || null;
      const v = String(incoming).trim();
      return v || null;
    };
    merged[gw] = {
      displayName:
        p.displayName !== undefined && String(p.displayName).trim()
          ? String(p.displayName).trim()
          : row.DisplayName || gw.toUpperCase(),
      isEnabled: p.isEnabled !== undefined ? Boolean(p.isEnabled) : row.IsEnabled === undefined ? true : Boolean(row.IsEnabled),
      environment,
      merchantCode:
        p.merchantCode !== undefined ? String(p.merchantCode || '').trim() || null : row.MerchantCode || null,
      accessKey: pickSecret(p.accessKey, row.AccessKey),
      secretKey: pickSecret(p.secretKey, row.SecretKey),
      note: p.note !== undefined ? String(p.note || '').trim() || null : row.Note || null,
    };
  }

  if (!GATEWAYS.some((gw) => merged[gw].isEnabled)) {
    throw new AppError('Cần bật ít nhất 1 phương thức thanh toán cho cửa hàng.', 400);
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const gw of GATEWAYS) {
      const m = merged[gw];
      await new sql.Request(transaction)
        .input('gw', sql.NVarChar(20), gw)
        .input('displayName', sql.NVarChar(100), m.displayName)
        .input('isEnabled', sql.Bit, m.isEnabled ? 1 : 0)
        .input('environment', sql.NVarChar(20), m.environment)
        .input('merchantCode', sql.NVarChar(100), m.merchantCode)
        .input('accessKey', sql.NVarChar(200), m.accessKey)
        .input('secretKey', sql.NVarChar(300), m.secretKey)
        .input('note', sql.NVarChar(400), m.note)
        .query(`
          MERGE dbo.PaymentGatewayConfigs AS t
          USING (SELECT @gw AS Gateway) AS s ON t.Gateway = s.Gateway
          WHEN MATCHED THEN UPDATE SET
            DisplayName = @displayName, IsEnabled = @isEnabled, Environment = @environment,
            MerchantCode = @merchantCode, AccessKey = @accessKey, SecretKey = @secretKey,
            Note = @note, UpdatedAt = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN INSERT
            (Gateway, DisplayName, IsEnabled, Environment, MerchantCode, AccessKey, SecretKey, Note)
            VALUES (@gw, @displayName, @isEnabled, @environment, @merchantCode, @accessKey, @secretKey, @note);
        `);
    }
    await transaction.commit();
  } catch (err) {
    try {
      await transaction.rollback();
    } catch (_) {
      // ignore
    }
    throw err;
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
async function loadOrderRow(requestOrPool, orderCode, lock = false) {
  const code = cleanOrderCode(orderCode);
  if (!code) throw new AppError('Mã đơn hàng không hợp lệ.', 400);
  const res = await requestOrPool
    .input('code', sql.NVarChar(60), code)
    .query(`
      SELECT TOP 1 *
      FROM dbo.Orders ${lock ? 'WITH (UPDLOCK, HOLDLOCK)' : ''}
      WHERE UPPER(OrderCode) = @code OR OrderId = TRY_CAST(@code AS INT)
    `);
  if (res.recordset.length === 0) {
    throw new AppError('Không tìm thấy đơn hàng.', 404);
  }
  return res.recordset[0];
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
  const res = await pool
    .request()
    .input('orderId', sql.Int, orderId)
    .query('SELECT * FROM dbo.Orders WHERE OrderId = @orderId');
  if (res.recordset.length === 0) return null;
  const [mapped] = await orderService.attachItemsToOrders(pool, res.recordset);
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
  const order = await loadOrderRow(pool.request(), orderCode);
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

  await pool
    .request()
    .input('orderId', sql.Int, order.OrderId)
    .input('txnRef', sql.NVarChar(60), txnRef)
    .input('amount', sql.Decimal(18, 0), amount)
    .input('bankCode', sql.NVarChar(30), vnpParams.vnp_BankCode || null)
    .input('payUrl', sql.NVarChar(2000), paymentUrl.slice(0, 2000))
    .input('createdBy', sql.NVarChar(120), requester && requester.username ? requester.username : null)
    .query(`
      INSERT INTO dbo.PaymentTransactions (OrderId, TxnRef, Gateway, Amount, Status, BankCode, PayUrl, Note, CreatedBy)
      VALUES (@orderId, @txnRef, N'vnpay', @amount, N'pending', @bankCode, @payUrl, N'Khởi tạo giao dịch VNPay', @createdBy)
    `);

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
 * Xử lý kết quả VNPay trả về (dùng chung cho Return URL & IPN). Idempotent:
 * giao dịch đã xử lý sẽ không bị cập nhật lại.
 * Trả về { RspCode, Message, success, orderCode, responseCode, order }
 */
async function processVnpayResult(query = {}) {
  const pool = await poolPromise;
  const cfg = await resolveVnpayConfig(pool);

  if (!cfg.hashSecret || !verifyVnpaySignature(query, cfg.hashSecret)) {
    return { RspCode: '97', Message: 'Invalid signature', success: false };
  }

  const txnRef = String(query.vnp_TxnRef || '');
  const responseCode = String(query.vnp_ResponseCode || '');
  const transactionStatus = query.vnp_TransactionStatus !== undefined ? String(query.vnp_TransactionStatus) : '00';
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
 * Chốt kết quả giao dịch cổng online (VNPay / MoMo) trong SQL Transaction.
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

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  let committed = false;
  try {
    const txRes = await new sql.Request(transaction)
      .input('txnRef', sql.NVarChar(60), txnRef)
      .input('gateway', sql.NVarChar(20), gateway)
      .query(`
        SELECT TOP 1 t.*, o.OrderCode, o.OrderStatus, o.PaymentStatus AS OrderPaymentStatus, o.TotalAmount
        FROM dbo.PaymentTransactions t WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN dbo.Orders o ON o.OrderId = t.OrderId
        WHERE t.TxnRef = @txnRef AND t.Gateway = @gateway
      `);

    if (txRes.recordset.length === 0) {
      await transaction.rollback();
      return { RspCode: '01', Message: 'Order not found', success: false };
    }

    const tx = txRes.recordset[0];

    if (Math.round(Number(tx.Amount)) !== Math.round(Number(paidAmount))) {
      await transaction.rollback();
      return {
        RspCode: '04',
        Message: 'Invalid amount',
        success: false,
        orderCode: tx.OrderCode,
      };
    }

    if (tx.Status !== 'pending') {
      await transaction.commit();
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
      await new sql.Request(transaction)
        .input('id', sql.Int, tx.TransactionId)
        .input('status', sql.NVarChar(20), orderCancelled ? 'refunded' : 'success')
        .input('bankCode', sql.NVarChar(30), bankCode ? String(bankCode).slice(0, 30) : null)
        .input('transNo', sql.NVarChar(60), gatewayTransNo ? String(gatewayTransNo).slice(0, 60) : null)
        .input('responseCode', sql.NVarChar(20), String(responseCode).slice(0, 20))
        .input('note', sql.NVarChar(400), orderCancelled ? 'Thanh toán thành công nhưng đơn đã hủy -> cần hoàn tiền' : 'Thanh toán thành công')
        .input('raw', sql.NVarChar(sql.MAX), rawJson)
        .query(`
          UPDATE dbo.PaymentTransactions
          SET Status = @status, BankCode = COALESCE(@bankCode, BankCode), GatewayTransNo = @transNo,
              ResponseCode = @responseCode, Note = @note, RawData = @raw, UpdatedAt = SYSUTCDATETIME()
          WHERE TransactionId = @id
        `);

      await new sql.Request(transaction)
        .input('orderId', sql.Int, tx.OrderId)
        .input('ps', sql.NVarChar(20), orderCancelled ? 'refunded' : 'paid')
        .query(`
          UPDATE dbo.Orders
          SET PaymentStatus = @ps, PaidAt = SYSUTCDATETIME()
          WHERE OrderId = @orderId
        `);

      // Các giao dịch pending khác của cùng đơn hàng (khách bấm thanh toán nhiều lần) -> failed
      await new sql.Request(transaction)
        .input('orderId', sql.Int, tx.OrderId)
        .input('id', sql.Int, tx.TransactionId)
        .query(`
          UPDATE dbo.PaymentTransactions
          SET Status = N'failed', Note = N'Bị thay thế bởi giao dịch thanh toán thành công khác', UpdatedAt = SYSUTCDATETIME()
          WHERE OrderId = @orderId AND Status = N'pending' AND TransactionId <> @id
        `);
    } else {
      await new sql.Request(transaction)
        .input('id', sql.Int, tx.TransactionId)
        .input('bankCode', sql.NVarChar(30), bankCode ? String(bankCode).slice(0, 30) : null)
        .input('transNo', sql.NVarChar(60), gatewayTransNo ? String(gatewayTransNo).slice(0, 60) : null)
        .input('responseCode', sql.NVarChar(20), String(responseCode).slice(0, 20))
        .input('note', sql.NVarChar(400), String(failureMessage || 'Giao dịch thất bại').slice(0, 400))
        .input('raw', sql.NVarChar(sql.MAX), rawJson)
        .query(`
          UPDATE dbo.PaymentTransactions
          SET Status = N'failed', BankCode = COALESCE(@bankCode, BankCode), GatewayTransNo = @transNo,
              ResponseCode = @responseCode, Note = @note, RawData = @raw, UpdatedAt = SYSUTCDATETIME()
          WHERE TransactionId = @id
        `);

      await new sql.Request(transaction)
        .input('orderId', sql.Int, tx.OrderId)
        .query(`
          UPDATE dbo.Orders
          SET PaymentStatus = N'failed'
          WHERE OrderId = @orderId AND PaymentStatus = N'unpaid'
        `);
    }

    await transaction.commit();
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
      try {
        await transaction.rollback();
      } catch (_) {
        // ignore
      }
    }
    throw err;
  }
}

// ============================================================================
// 5. MoMo: Tạo yêu cầu thanh toán (captureWallet), Redirect & IPN
// ============================================================================
async function createMomoPayment(orderCode, options = {}) {
  const { requester = null, phone = '', redirectUrl = '', sandboxFallback = false } = options;

  const pool = await poolPromise;
  const order = await loadOrderRow(pool.request(), orderCode);
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

  // Ghi nhận giao dịch pending trước khi gọi sang MoMo
  await pool
    .request()
    .input('orderId', sql.Int, order.OrderId)
    .input('txnRef', sql.NVarChar(60), txnRef)
    .input('amount', sql.Decimal(18, 0), amount)
    .input('createdBy', sql.NVarChar(120), requester && requester.username ? requester.username : null)
    .query(`
      INSERT INTO dbo.PaymentTransactions (OrderId, TxnRef, Gateway, Amount, Status, Note, CreatedBy)
      VALUES (@orderId, @txnRef, N'momo', @amount, N'pending', N'Khởi tạo giao dịch MoMo', @createdBy)
    `);

  const qrScanUrl = `${apiBaseUrl()}/api/payments/qr-scan/${encodeURIComponent(txnRef)}`;
  const expireAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const buildLocalSandboxResponse = async (fallbackReason) => {
    const fallbackQr = `momo://app?action=payWithApp&partnerCode=${encodeURIComponent(cfg.partnerCode)}&orderId=${encodeURIComponent(txnRef)}&amount=${amount}`;
    await pool
      .request()
      .input('txnRef', sql.NVarChar(60), txnRef)
      .input('payUrl', sql.NVarChar(2000), qrScanUrl.slice(0, 2000))
      .input('note', sql.NVarChar(400), `Khởi tạo QR MoMo Sandbox (${fallbackReason})`.slice(0, 400))
      .query(`
        UPDATE dbo.PaymentTransactions
        SET PayUrl = @payUrl, Note = @note, UpdatedAt = SYSUTCDATETIME()
        WHERE TxnRef = @txnRef
      `);
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
  } catch (err) {
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

  await pool
    .request()
    .input('txnRef', sql.NVarChar(60), txnRef)
    .input('payUrl', sql.NVarChar(2000), String(momoRes.payUrl).slice(0, 2000))
    .query(`
      UPDATE dbo.PaymentTransactions
      SET PayUrl = @payUrl, UpdatedAt = SYSUTCDATETIME()
      WHERE TxnRef = @txnRef
    `);

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
  await pool
    .request()
    .input('txnRef', sql.NVarChar(60), txnRef)
    .input('note', sql.NVarChar(400), String(note || '').slice(0, 400))
    .input('rc', sql.NVarChar(20), responseCode)
    .query(`
      UPDATE dbo.PaymentTransactions
      SET Status = N'failed', Note = @note, ResponseCode = COALESCE(@rc, ResponseCode), UpdatedAt = SYSUTCDATETIME()
      WHERE TxnRef = @txnRef AND Status = N'pending'
    `);
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
  const order = await loadOrderRow(pool.request(), orderCode);
  assertOrderAccess(order, { requester, phone });

  const txRes = await pool
    .request()
    .input('orderId', sql.Int, order.OrderId)
    .query(`
      SELECT * FROM dbo.PaymentTransactions
      WHERE OrderId = @orderId
      ORDER BY CreatedAt DESC, TransactionId DESC
    `);

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
    transactions: txRes.recordset.map(mapTransactionRow),
  };
}

async function confirmManualPayment(orderCode, { method = 'cash', note = '', actorName = null } = {}) {
  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  let committed = false;
  try {
    const order = await loadOrderRow(new sql.Request(transaction), orderCode, true);
    if (order.OrderStatus === 'cancelled') {
      throw new AppError('Không thể xác nhận thu tiền cho đơn hàng đã hủy.', 400);
    }
    if (order.PaymentStatus === 'paid') {
      throw new AppError('Đơn hàng này đã được thanh toán.', 409);
    }

    const gateway = ['cash', 'cod', 'vnpay', 'momo', 'manual'].includes(String(method))
      ? String(method)
      : 'manual';

    await new sql.Request(transaction)
      .input('orderId', sql.Int, order.OrderId)
      .input('txnRef', sql.NVarChar(60), `${order.OrderCode}-MAN-${Date.now()}`)
      .input('gateway', sql.NVarChar(20), gateway)
      .input('amount', sql.Decimal(18, 0), Number(order.TotalAmount || 0))
      .input('note', sql.NVarChar(400), String(note || 'Nhân viên xác nhận đã thu tiền').slice(0, 400))
      .input('createdBy', sql.NVarChar(120), actorName)
      .query(`
        UPDATE dbo.PaymentTransactions
        SET Status = N'failed', Note = N'Đóng giao dịch chờ do nhân viên xác nhận thu tiền thủ công', UpdatedAt = SYSUTCDATETIME()
        WHERE OrderId = @orderId AND Status = N'pending';

        INSERT INTO dbo.PaymentTransactions (OrderId, TxnRef, Gateway, Amount, Status, ResponseCode, Note, CreatedBy)
        VALUES (@orderId, @txnRef, @gateway, @amount, N'success', N'00', @note, @createdBy);

        UPDATE dbo.Orders
        SET PaymentStatus = N'paid', PaidAt = SYSUTCDATETIME()
        WHERE OrderId = @orderId;
      `);

    await transaction.commit();
    committed = true;
    return {
      message: 'Đã xác nhận thu tiền cho đơn hàng.',
      order: await getMappedOrder(pool, order.OrderId),
    };
  } catch (err) {
    if (!committed) {
      try {
        await transaction.rollback();
      } catch (_) {
        // ignore
      }
    }
    throw err;
  }
}

async function refundPayment(orderCode, { reason = '', actorName = null } = {}) {
  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  let committed = false;
  try {
    const order = await loadOrderRow(new sql.Request(transaction), orderCode, true);
    if (order.PaymentStatus !== 'paid') {
      throw new AppError('Chỉ có thể hoàn tiền cho đơn hàng đã thanh toán.', 400);
    }

    await new sql.Request(transaction)
      .input('orderId', sql.Int, order.OrderId)
      .input('note', sql.NVarChar(400), String(reason ? `Hoàn tiền: ${reason}` : 'Hoàn tiền cho khách hàng').slice(0, 400))
      .input('createdBy', sql.NVarChar(120), actorName)
      .query(`
        UPDATE dbo.PaymentTransactions
        SET Status = N'refunded',
            Note = LEFT(CONCAT(ISNULL(Note, N''), N' | ', @note), 400),
            UpdatedAt = SYSUTCDATETIME()
        WHERE OrderId = @orderId AND Status = N'success';

        UPDATE dbo.Orders SET PaymentStatus = N'refunded' WHERE OrderId = @orderId;
      `);

    await transaction.commit();
    committed = true;
    return {
      message: 'Đã ghi nhận hoàn tiền cho đơn hàng.',
      order: await getMappedOrder(pool, order.OrderId),
    };
  } catch (err) {
    if (!committed) {
      try {
        await transaction.rollback();
      } catch (_) {
        // ignore
      }
    }
    throw err;
  }
}

async function listTransactions(filters = {}) {
  const { gateway, status, orderCode, fromDate, toDate, search } = filters;
  const pool = await poolPromise;
  const request = pool.request();
  let query = `
    SELECT t.*, o.OrderCode, o.CustomerName
    FROM dbo.PaymentTransactions t
    INNER JOIN dbo.Orders o ON o.OrderId = t.OrderId
    WHERE 1 = 1
  `;

  if (gateway && gateway !== 'all') {
    query += ' AND t.Gateway = @gateway';
    request.input('gateway', sql.NVarChar(20), String(gateway).trim().toLowerCase());
  }
  if (status && status !== 'all') {
    if (!VALID_TX_STATUSES.includes(String(status))) {
      throw new AppError('Trạng thái giao dịch không hợp lệ.', 400);
    }
    query += ' AND t.Status = @status';
    request.input('status', sql.NVarChar(20), String(status));
  }
  if (orderCode) {
    query += ' AND UPPER(o.OrderCode) = @orderCode';
    request.input('orderCode', sql.NVarChar(60), cleanOrderCode(orderCode));
  }
  if (fromDate) {
    query += ' AND CAST(t.CreatedAt AS DATE) >= CAST(@fromDate AS DATE)';
    request.input('fromDate', sql.VarChar(10), String(fromDate).slice(0, 10));
  }
  if (toDate) {
    query += ' AND CAST(t.CreatedAt AS DATE) <= CAST(@toDate AS DATE)';
    request.input('toDate', sql.VarChar(10), String(toDate).slice(0, 10));
  }
  if (search && String(search).trim()) {
    query += ' AND (o.OrderCode LIKE @q OR t.TxnRef LIKE @q OR o.CustomerName LIKE @q OR t.GatewayTransNo LIKE @q)';
    request.input('q', sql.NVarChar(150), `%${String(search).trim().replace(/^#/, '')}%`);
  }

  query += ' ORDER BY t.CreatedAt DESC, t.TransactionId DESC';
  const res = await request.query(query);
  return res.recordset.map(mapTransactionRow);
}

async function getPaymentSummary({ fromDate, toDate } = {}) {
  const pool = await poolPromise;
  const request = pool.request();
  let where = 'WHERE 1 = 1';
  if (fromDate) {
    where += ' AND CAST(CreatedAt AS DATE) >= CAST(@fromDate AS DATE)';
    request.input('fromDate', sql.VarChar(10), String(fromDate).slice(0, 10));
  }
  if (toDate) {
    where += ' AND CAST(CreatedAt AS DATE) <= CAST(@toDate AS DATE)';
    request.input('toDate', sql.VarChar(10), String(toDate).slice(0, 10));
  }

  const res = await request.query(`
    SELECT
      COUNT(*) AS totalOrders,
      SUM(CASE WHEN PaymentStatus = N'paid' THEN 1 ELSE 0 END) AS paidOrders,
      SUM(CASE WHEN PaymentStatus = N'unpaid' AND OrderStatus <> N'cancelled' THEN 1 ELSE 0 END) AS unpaidOrders,
      SUM(CASE WHEN PaymentStatus = N'failed' AND OrderStatus <> N'cancelled' THEN 1 ELSE 0 END) AS failedOrders,
      SUM(CASE WHEN PaymentStatus = N'refunded' THEN 1 ELSE 0 END) AS refundedOrders,
      SUM(CASE WHEN PaymentStatus = N'paid' THEN TotalAmount ELSE 0 END) AS collectedAmount,
      SUM(CASE WHEN PaymentStatus IN (N'unpaid', N'failed') AND OrderStatus <> N'cancelled' THEN TotalAmount ELSE 0 END) AS outstandingAmount,
      SUM(CASE WHEN PaymentStatus = N'refunded' THEN TotalAmount ELSE 0 END) AS refundedAmount,
      SUM(CASE WHEN PaymentStatus = N'paid' AND PaymentMethod = N'vnpay' THEN TotalAmount ELSE 0 END) AS paidVnpay,
      SUM(CASE WHEN PaymentStatus = N'paid' AND PaymentMethod = N'momo' THEN TotalAmount ELSE 0 END) AS paidMomo,
      SUM(CASE WHEN PaymentStatus = N'paid' AND PaymentMethod = N'cod' THEN TotalAmount ELSE 0 END) AS paidCod
    FROM dbo.Orders
    ${where}
  `);

  const r = res.recordset[0] || {};
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
 * Tự động hủy các đơn online chọn VNPay / MoMo nhưng quá hạn chưa thanh toán
 * (giải phóng tồn kho đang bị giữ chỗ). Dùng lại orderService.updateOrderStatus để hoàn kho.
 */
async function expireUnpaidOnlineOrders({ minutes = 30, actorName = null } = {}) {
  const mins = Number(minutes);
  if (!Number.isInteger(mins) || mins < 5 || mins > 10080) {
    throw new AppError('Thời gian hết hạn (minutes) phải là số nguyên từ 5 đến 10080 phút.', 400);
  }

  const pool = await poolPromise;
  const res = await pool
    .request()
    .input('mins', sql.Int, mins)
    .query(`
      SELECT OrderCode
      FROM dbo.Orders
      WHERE OrderSource = N'online'
        AND OrderStatus = N'pending'
        AND PaymentMethod IN (N'vnpay', N'momo')
        AND PaymentStatus IN (N'unpaid', N'failed')
        AND CreatedAt < DATEADD(MINUTE, -@mins, SYSUTCDATETIME())
    `);

  const expired = [];
  for (const row of res.recordset) {
    try {
      await orderService.updateOrderStatus(row.OrderCode, {
        status: 'cancelled',
        staffName: actorName || 'Hệ thống (hết hạn thanh toán)',
      });
      await pool
        .request()
        .input('code', sql.NVarChar(20), row.OrderCode)
        .query(`
          UPDATE t SET t.Status = N'failed', t.Note = N'Hết hạn thanh toán - đơn hàng tự động hủy', t.UpdatedAt = SYSUTCDATETIME()
          FROM dbo.PaymentTransactions t
          INNER JOIN dbo.Orders o ON o.OrderId = t.OrderId
          WHERE o.OrderCode = @code AND t.Status = N'pending'
        `);
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
  const res = await pool
    .request()
    .input('txnRef', sql.NVarChar(60), cleaned)
    .query(`
      SELECT TOP 1 t.*, o.OrderCode, o.CustomerName, o.CustomerPhone, o.PaymentStatus AS OrderPaymentStatus
      FROM dbo.PaymentTransactions t
      INNER JOIN dbo.Orders o ON o.OrderId = t.OrderId
      WHERE t.TxnRef = @txnRef
    `);
  if (res.recordset.length === 0) {
    throw new AppError('Không tìm thấy giao dịch thanh toán.', 404);
  }
  const row = res.recordset[0];
  return {
    ...mapTransactionRow(row),
    orderCode: row.OrderCode,
    customerPhone: row.CustomerPhone,
    orderPaymentStatus: row.OrderPaymentStatus,
  };
}

/**
 * Xác nhận giả lập quét mã QR trên môi trường Sandbox (phục vụ demo/kiểm thử VNPay & MoMo).
 * Chỉ cho phép khi cổng tương ứng đang ở chế độ 'sandbox' và người gọi chứng minh quyền sở hữu đơn.
 */
async function sandboxCompletePayment(orderCode, { requester = null, phone = '', outcome = 'success' } = {}) {
  const pool = await poolPromise;
  const order = await loadOrderRow(pool.request(), orderCode);
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

  const pendingRes = await pool
    .request()
    .input('orderId', sql.Int, order.OrderId)
    .input('gateway', sql.NVarChar(20), gateway)
    .query(`
      SELECT TOP 1 TxnRef
      FROM dbo.PaymentTransactions
      WHERE OrderId = @orderId AND Gateway = @gateway AND Status = N'pending'
      ORDER BY CreatedAt DESC, TransactionId DESC
    `);

  let txnRef = pendingRes.recordset[0] ? pendingRes.recordset[0].TxnRef : null;
  const amount = Number(order.TotalAmount);

  if (!txnRef) {
    txnRef = `${order.OrderCode}${Date.now().toString().slice(-8)}`;
    await pool
      .request()
      .input('orderId', sql.Int, order.OrderId)
      .input('txnRef', sql.NVarChar(60), txnRef)
      .input('gateway', sql.NVarChar(20), gateway)
      .input('amount', sql.Decimal(18, 0), amount)
      .input('createdBy', sql.NVarChar(120), requester && requester.username ? requester.username : null)
      .query(`
        INSERT INTO dbo.PaymentTransactions (OrderId, TxnRef, Gateway, Amount, Status, Note, CreatedBy)
        VALUES (@orderId, @txnRef, @gateway, @amount, N'pending', N'Khởi tạo giao dịch QR Sandbox', @createdBy)
      `);
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
