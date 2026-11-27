const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');

const PORT = '5064';
const BASE_URL = `http://localhost:${PORT}`;
const apiDir = path.resolve(__dirname, '../../api');

const TEST_PRODUCT_ID = 'prod-pay-e2e-01';
const TEST_PRODUCT_PRICE = 150000;
const TEST_PRODUCT_STOCK = 20;
const TEST_PHONE_RAW = '0988-111-222';
const TEST_PHONE_DIGITS = '0988111222';
const TEST_CUSTOMER_EMAIL = 'e2e.payment.customer@pethub.vn';
const TEST_CUSTOMER_PHONE = '0933222111';

let pool;
let serverProc;
let adminToken = '';
let customerToken = '';
let gatewaySnapshot = [];
let vnpaySecret = '';
let momoAccessKey = '';
let momoSecretKey = '';

async function api(endpoint, { method = 'GET', token = '', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${endpoint}`, { method, headers, body: payload, redirect: 'manual' });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : null;
  return { status: res.status, data };
}

async function waitForHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverProc && serverProc.exitCode !== null) {
      throw new Error(`API server exited prematurely with code ${serverProc.exitCode}`);
    }
    try {
      const r = await fetch(`${BASE_URL}/api/health`);
      if (r.status === 200) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Timed out waiting for API health');
}

function vnpSign(params, secret) {
  const signData = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k])).replace(/%20/g, '+')}`)
    .join('&');
  return crypto.createHmac('sha512', secret).update(Buffer.from(signData, 'utf-8')).digest('hex');
}

/** Giả lập VNPay gọi về Return URL / IPN với chữ ký hợp lệ */
function buildVnpayCallbackQuery(paymentUrl, overrides = {}) {
  const url = new URL(paymentUrl);
  const params = {};
  for (const [k, v] of url.searchParams.entries()) {
    if (k !== 'vnp_SecureHash') params[k] = v;
  }
  const callback = {
    vnp_TmnCode: params.vnp_TmnCode,
    vnp_Amount: params.vnp_Amount,
    vnp_BankCode: 'NCB',
    vnp_BankTranNo: 'VNP14000001',
    vnp_CardType: 'ATM',
    vnp_OrderInfo: params.vnp_OrderInfo,
    vnp_PayDate: params.vnp_CreateDate,
    vnp_ResponseCode: '00',
    vnp_TransactionNo: '14000001',
    vnp_TransactionStatus: '00',
    vnp_TxnRef: params.vnp_TxnRef,
    ...overrides,
  };
  callback.vnp_SecureHash = vnpSign(callback, vnpaySecret);
  return new URLSearchParams(callback).toString();
}

function momoResultSignature(data) {
  const raw =
    `accessKey=${momoAccessKey}&amount=${data.amount}&extraData=${data.extraData}` +
    `&message=${data.message}&orderId=${data.orderId}&orderInfo=${data.orderInfo}` +
    `&orderType=${data.orderType}&partnerCode=${data.partnerCode}&payType=${data.payType}` +
    `&requestId=${data.requestId}&responseTime=${data.responseTime}&resultCode=${data.resultCode}` +
    `&transId=${data.transId}`;
  return crypto.createHmac('sha256', momoSecretKey).update(raw).digest('hex');
}

async function createOnlineOrder(paymentMethod, quantity = 1, extra = {}) {
  const res = await api('/api/orders', {
    method: 'POST',
    body: {
      customerName: 'Khách Test Thanh Toán',
      customerPhone: TEST_PHONE_RAW,
      deliveryMethod: 'delivery',
      shippingAddress: '1 Đường Test, Quận 1, TP.HCM',
      paymentMethod,
      orderSource: 'online',
      items: [{ productId: TEST_PRODUCT_ID, name: 'SP test', price: 1, quantity }],
      ...extra,
    },
  });
  return res;
}

async function getStock() {
  const [rows] = await pool.query(
    'SELECT StockCount FROM Products WHERE ProductId = ?',
    [TEST_PRODUCT_ID]
  );
  return rows[0] ? Number(rows[0].StockCount) : null;
}

async function cleanup() {
  if (!pool) return;
  await pool.query('DELETE FROM Orders WHERE CustomerPhone IN (?, ?)', [
    TEST_PHONE_RAW,
    TEST_PHONE_DIGITS,
  ]);
  await pool.query('DELETE FROM Products WHERE ProductId = ?', [TEST_PRODUCT_ID]);
  await pool.query('DELETE FROM Users WHERE Email = ?', [TEST_CUSTOMER_EMAIL]);
}

async function restoreGateways() {
  if (!pool || gatewaySnapshot.length === 0) return;
  for (const g of gatewaySnapshot) {
    // eslint-disable-next-line no-await-in-loop
    await pool.query(
      `
        UPDATE PaymentGatewayConfigs
        SET IsEnabled = ?, Environment = ?, MerchantCode = ?, AccessKey = ?, SecretKey = ?, Note = ?
        WHERE Gateway = ?
      `,
      [
        g.IsEnabled ? 1 : 0,
        g.Environment,
        g.MerchantCode,
        g.AccessKey,
        g.SecretKey,
        g.Note,
        g.Gateway,
      ]
    );
  }
}

describe('PetsFriend Payment Module Integration Suite (PORT 5064)', () => {
  before(async () => {
    const prevCwd = process.cwd();
    process.chdir(apiDir);
    const dbMod = require('../../api/db');
    pool = await dbMod.poolPromise;
    process.chdir(prevCwd);

    await cleanup();

    const [snap] = await pool.query('SELECT * FROM PaymentGatewayConfigs');
    gatewaySnapshot = snap;
    assert.equal(gatewaySnapshot.length, 3, 'Seed PaymentGatewayConfigs must contain cod, vnpay, momo');
    // Bật đủ 3 cổng cho phiên test
    await pool.query('UPDATE PaymentGatewayConfigs SET IsEnabled = 1');

    await pool.query(
      `
        INSERT INTO Products (ProductId, Brand, Name, CategoryCode, PetType, Price, PrimaryImage, StockCount)
        VALUES (?, 'TEST', 'Sản phẩm kiểm thử thanh toán', 'food', 'both', ?, '/images/prod-ceramic-bowl.jpg', ?)
      `,
      [TEST_PRODUCT_ID, TEST_PRODUCT_PRICE, TEST_PRODUCT_STOCK]
    );

    let stderr = '';
    serverProc = spawn(process.execPath, ['server.js'], {
      cwd: apiDir,
      env: { ...process.env, PORT, FRONTEND_URL: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    try {
      await waitForHealth();
    } catch (err) {
      throw new Error(`${err.message}\n${stderr}`);
    }

    const adminRes = await api('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'admin@pethub.vn', password: 'Admin@123' },
    });
    assert.equal(adminRes.status, 200);
    adminToken = adminRes.data.token;

    const custRes = await api('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'E2E Payment Customer',
        email: TEST_CUSTOMER_EMAIL,
        phone: TEST_CUSTOMER_PHONE,
        password: 'Customer@123',
      },
    });
    assert.equal(custRes.status, 201);
    customerToken = custRes.data.token;

    const cfg = await api('/api/payment-gateways?includeSecrets=true', { token: adminToken });
    assert.equal(cfg.status, 200);
    vnpaySecret = process.env.VNPAY_HASH_SECRET || cfg.data.vnpayHashSecret;
    momoAccessKey = process.env.MOMO_ACCESS_KEY || cfg.data.momoAccessKey;
    momoSecretKey = process.env.MOMO_SECRET_KEY || cfg.data.momoSecretKey;
    assert.ok(vnpaySecret && !vnpaySecret.includes('•'), 'Admin must receive real VNPay secret');
  });

  after(async () => {
    try {
      await cleanup();
      await restoreGateways();
    } finally {
      if (serverProc && serverProc.exitCode === null) {
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            try {
              serverProc.kill('SIGKILL');
            } catch {}
            resolve();
          }, 3000);
          serverProc.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
          serverProc.kill();
        });
      }
      if (pool) await pool.close().catch(() => {});
    }
  });

  describe('1. Cấu hình cổng thanh toán (PaymentGatewayConfigs)', () => {
    it('GET /api/payment-gateways công khai trả về cổng đang bật & che khóa bí mật', async () => {
      const r = await api('/api/payment-gateways');
      assert.equal(r.status, 200);
      assert.deepEqual([...r.data.enabledMethods].sort(), ['cod', 'momo', 'vnpay']);
      assert.ok(r.data.vnpayHashSecret.includes('•'), 'Public response must mask VNPay secret');
      assert.ok(r.data.momoSecretKey.includes('•'), 'Public response must mask MoMo secret');
      assert.equal(r.data.gateways.length, 3);
    });

    it('Customer không được sửa cấu hình (403), Admin tắt MoMo thì đơn online MoMo bị chặn (400)', async () => {
      const denied = await api('/api/payment-gateways', {
        method: 'PUT',
        token: customerToken,
        body: { momoEnabled: false },
      });
      assert.equal(denied.status, 403);

      const off = await api('/api/payment-gateways', {
        method: 'PUT',
        token: adminToken,
        body: { momoEnabled: false, momoSecretKey: '•••• •••• masked' },
      });
      assert.equal(off.status, 200);
      assert.equal(off.data.momoEnabled, false);

      // Gửi giá trị đã che (••••) không được ghi đè khóa thật
      const still = await api('/api/payment-gateways?includeSecrets=true', { token: adminToken });
      assert.equal(still.data.momoSecretKey, momoSecretKey);

      const blocked = await createOnlineOrder('momo');
      assert.equal(blocked.status, 400);
      assert.match(blocked.data.message, /tạm ngưng/i);

      const on = await api('/api/payment-gateways', {
        method: 'PUT',
        token: adminToken,
        body: { momoEnabled: true },
      });
      assert.equal(on.status, 200);
      assert.equal(on.data.momoEnabled, true);
    });

    it('Không cho phép tắt toàn bộ cổng thanh toán (400)', async () => {
      const r = await api('/api/payment-gateways', {
        method: 'PUT',
        token: adminToken,
        body: { codEnabled: false, vnpayEnabled: false, momoEnabled: false },
      });
      assert.equal(r.status, 400);
    });
  });

  describe('2. VNPay: tạo URL ký HMAC-SHA512, Return URL & IPN', () => {
    let orderCode = '';
    let paymentUrl = '';

    it('Đơn online VNPay khởi tạo ở trạng thái chưa thanh toán và yêu cầu bước thanh toán', async () => {
      const before = await getStock();
      const r = await createOnlineOrder('vnpay', 2);
      assert.equal(r.status, 201, JSON.stringify(r.data));
      orderCode = r.data.order.id;
      assert.equal(r.data.order.paymentStatus, 'unpaid');
      assert.equal(r.data.order.totalAmount, 2 * TEST_PRODUCT_PRICE);
      assert.equal(r.data.payment.required, true);
      assert.equal(r.data.payment.nextStep, 'POST /api/payments/vnpay/create');
      assert.equal(await getStock(), before - 2);
    });

    it('Tạo URL thanh toán: sai SĐT bị chặn (403), đúng SĐT nhận paymentUrl có chữ ký hợp lệ', async () => {
      const denied = await api('/api/payments/vnpay/create', {
        method: 'POST',
        body: { orderCode, phone: '0900000000' },
      });
      assert.equal(denied.status, 403);

      const r = await api('/api/payments/vnpay/create', {
        method: 'POST',
        body: { orderCode, phone: TEST_PHONE_DIGITS, bankCode: 'NCB' },
      });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      paymentUrl = r.data.paymentUrl;
      assert.ok(paymentUrl.startsWith('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?'));

      const url = new URL(paymentUrl);
      assert.equal(url.searchParams.get('vnp_Amount'), String(2 * TEST_PRODUCT_PRICE * 100));
      assert.equal(url.searchParams.get('vnp_Command'), 'pay');
      assert.equal(url.searchParams.get('vnp_BankCode'), 'NCB');
      const params = {};
      for (const [k, v] of url.searchParams.entries()) if (k !== 'vnp_SecureHash') params[k] = v;
      assert.equal(url.searchParams.get('vnp_SecureHash'), vnpSign(params, vnpaySecret));
    });

    it('IPN với chữ ký giả mạo -> RspCode 97, sai số tiền -> RspCode 04', async () => {
      const forged = await api(`/api/payments/vnpay/ipn?${buildVnpayCallbackQuery(paymentUrl)}`.replace(/vnp_SecureHash=[a-f0-9]+/, 'vnp_SecureHash=deadbeef'));
      assert.equal(forged.status, 200);
      assert.equal(forged.data.RspCode, '97');

      const wrongAmount = await api(`/api/payments/vnpay/ipn?${buildVnpayCallbackQuery(paymentUrl, { vnp_Amount: '100' })}`);
      assert.equal(wrongAmount.data.RspCode, '04');
    });

    it('Return URL thành công -> đơn hàng chuyển sang Đã thanh toán, IPN lặp lại -> RspCode 02', async () => {
      const r = await api(`/api/payments/vnpay/return?${buildVnpayCallbackQuery(paymentUrl)}`);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(r.data.success, true);
      assert.equal(r.data.order.paymentStatus, 'paid');
      assert.ok(r.data.order.paidAt);

      const again = await api(`/api/payments/vnpay/ipn?${buildVnpayCallbackQuery(paymentUrl)}`);
      assert.equal(again.data.RspCode, '02');

      const payAgain = await api('/api/payments/vnpay/create', {
        method: 'POST',
        body: { orderCode, phone: TEST_PHONE_DIGITS },
      });
      assert.equal(payAgain.status, 409);
    });

    it('Tra cứu thanh toán theo đơn: thiếu quyền (403), đúng SĐT xem được lịch sử giao dịch', async () => {
      const denied = await api(`/api/payments/orders/${orderCode}`);
      assert.equal(denied.status, 403);

      const r = await api(`/api/payments/orders/${orderCode}?phone=${TEST_PHONE_RAW}`);
      assert.equal(r.status, 200);
      assert.equal(r.data.paymentStatus, 'paid');
      const success = r.data.transactions.find((t) => t.status === 'success');
      assert.ok(success, 'Expected one successful VNPay transaction');
      assert.equal(success.gateway, 'vnpay');
      assert.equal(success.gatewayTransNo, '14000001');
      assert.equal(success.bankCode, 'NCB');
    });

    it('Hủy đơn đã thanh toán -> tự động chuyển Đã hoàn tiền & hoàn tồn kho', async () => {
      const stockBefore = await getStock();
      const r = await api(`/api/orders/${orderCode}/status`, {
        method: 'PATCH',
        token: adminToken,
        body: { status: 'cancelled', staffName: 'Tester' },
      });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(r.data.paymentStatus, 'refunded');
      assert.equal(await getStock(), stockBefore + 2);

      const p = await api(`/api/payments/orders/${orderCode}`, { token: adminToken });
      assert.ok(p.data.transactions.some((t) => t.status === 'refunded'));
    });
  });

  describe('3. VNPay thất bại & thanh toán lại', () => {
    it('Khách hủy trên cổng (mã 24) -> Thanh toán thất bại, vẫn tạo lại được URL mới', async () => {
      const o = await createOnlineOrder('vnpay', 1);
      assert.equal(o.status, 201);
      const code = o.data.order.id;

      const c1 = await api('/api/payments/vnpay/create', {
        method: 'POST',
        body: { orderCode: code, phone: TEST_PHONE_DIGITS },
      });
      assert.equal(c1.status, 201);

      const fail = await api(
        `/api/payments/vnpay/return?${buildVnpayCallbackQuery(c1.data.paymentUrl, {
          vnp_ResponseCode: '24',
          vnp_TransactionStatus: '02',
          vnp_TransactionNo: '0',
        })}`
      );
      assert.equal(fail.status, 200);
      assert.equal(fail.data.success, false);
      assert.equal(fail.data.order.paymentStatus, 'failed');
      assert.match(fail.data.message, /hủy giao dịch/i);

      const c2 = await api('/api/payments/vnpay/create', {
        method: 'POST',
        body: { orderCode: code, phone: TEST_PHONE_DIGITS },
      });
      assert.equal(c2.status, 201, 'Failed order must be payable again');
      assert.notEqual(c2.data.txnRef, c1.data.txnRef);
    });

    it('Không thể dùng VNPay cho đơn đã chọn COD (400)', async () => {
      const o = await createOnlineOrder('cod', 1);
      const r = await api('/api/payments/vnpay/create', {
        method: 'POST',
        body: { orderCode: o.data.order.id, phone: TEST_PHONE_DIGITS },
      });
      assert.equal(r.status, 400);
    });
  });

  describe('4. MoMo: IPN ký HMAC-SHA256', () => {
    it('Tạo yêu cầu MoMo trả 201 (có mạng) hoặc 502 (không kết nối được cổng)', async () => {
      const o = await createOnlineOrder('momo', 1);
      assert.equal(o.status, 201);
      const r = await api('/api/payments/momo/create', {
        method: 'POST',
        body: { orderCode: o.data.order.id, phone: TEST_PHONE_DIGITS },
      });
      assert.ok([201, 502].includes(r.status), `Unexpected status ${r.status}: ${JSON.stringify(r.data)}`);
      if (r.status === 201) assert.ok(r.data.paymentUrl);
    });

    it('IPN hợp lệ -> Đã thanh toán (204), chữ ký sai -> 400', async () => {
      const o = await createOnlineOrder('momo', 1);
      const orderId = o.data.order.orderId;
      const txnRef = `${o.data.order.id}IPN`;
      await pool.query(
        "INSERT INTO PaymentTransactions (OrderId, TxnRef, Gateway, Amount, Status) VALUES (?, ?, 'momo', ?, 'pending')",
        [orderId, txnRef, TEST_PRODUCT_PRICE]
      );

      const ipn = {
        partnerCode: 'MOMO',
        orderId: txnRef,
        requestId: `${txnRef}R`,
        amount: TEST_PRODUCT_PRICE,
        orderInfo: 'Thanh toan don hang',
        orderType: 'momo_wallet',
        transId: 4088878653,
        resultCode: 0,
        message: 'Successful.',
        payType: 'qr',
        responseTime: Date.now(),
        extraData: '',
      };

      const bad = await api('/api/payments/momo/ipn', {
        method: 'POST',
        body: { ...ipn, signature: 'invalid' },
      });
      assert.equal(bad.status, 400);

      const ok = await api('/api/payments/momo/ipn', {
        method: 'POST',
        body: { ...ipn, signature: momoResultSignature(ipn) },
      });
      assert.equal(ok.status, 204);

      const p = await api(`/api/payments/orders/${o.data.order.id}`, { token: adminToken });
      assert.equal(p.data.paymentStatus, 'paid');
      assert.equal(p.data.transactions[0].gatewayTransNo, '4088878653');
    });
  });

  describe('5. COD, POS, xác nhận thu tiền thủ công & hoàn tiền', () => {
    it('Đơn COD giao thành công (completed) -> tự động Đã thanh toán + ghi giao dịch COD', async () => {
      const o = await createOnlineOrder('cod', 1);
      assert.equal(o.data.order.paymentStatus, 'unpaid');
      assert.equal(o.data.payment.required, false);
      const r = await api(`/api/orders/${o.data.order.id}/status`, {
        method: 'PATCH',
        token: adminToken,
        body: { status: 'completed', staffName: 'Hà Lê' },
      });
      assert.equal(r.status, 200);
      assert.equal(r.data.paymentStatus, 'paid');
      const p = await api(`/api/payments/orders/${o.data.order.id}`, { token: adminToken });
      assert.equal(p.data.transactions[0].gateway, 'cod');
      assert.equal(p.data.transactions[0].createdBy, 'Hà Lê');
    });

    it('Đơn POS tại quầy -> Đã thanh toán ngay + giao dịch tiền mặt', async () => {
      const r = await api('/api/orders', {
        method: 'POST',
        body: {
          customerName: 'Khách lẻ tại quầy',
          customerPhone: TEST_PHONE_RAW,
          deliveryMethod: 'pickup',
          paymentMethod: 'cod',
          orderSource: 'pos',
          staffName: 'Mai Nguyễn',
          items: [{ productId: TEST_PRODUCT_ID, quantity: 1 }],
        },
      });
      assert.equal(r.status, 201);
      assert.equal(r.data.order.paymentStatus, 'paid');
      const p = await api(`/api/payments/orders/${r.data.order.id}`, { token: adminToken });
      assert.equal(p.data.transactions[0].gateway, 'cash');
      assert.equal(p.data.transactions[0].status, 'success');
    });

    it('Nhân viên xác nhận thu tiền thủ công (200), xác nhận lại (409), hoàn tiền (200), hoàn lại lần 2 (400)', async () => {
      const o = await createOnlineOrder('cod', 1);
      const code = o.data.order.id;

      const denied = await api(`/api/payments/orders/${code}/confirm`, {
        method: 'POST',
        token: customerToken,
        body: { method: 'cash' },
      });
      assert.equal(denied.status, 403);

      const ok = await api(`/api/payments/orders/${code}/confirm`, {
        method: 'POST',
        token: adminToken,
        body: { method: 'cash', note: 'Khách thanh toán tại quầy', staffName: 'Linh Phạm' },
      });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
      assert.equal(ok.data.order.paymentStatus, 'paid');

      const dup = await api(`/api/payments/orders/${code}/confirm`, {
        method: 'POST',
        token: adminToken,
        body: { method: 'cash' },
      });
      assert.equal(dup.status, 409);

      const refund = await api(`/api/payments/orders/${code}/refund`, {
        method: 'POST',
        token: adminToken,
        body: { reason: 'Khách trả hàng' },
      });
      assert.equal(refund.status, 200);
      assert.equal(refund.data.order.paymentStatus, 'refunded');

      const refund2 = await api(`/api/payments/orders/${code}/refund`, {
        method: 'POST',
        token: adminToken,
        body: {},
      });
      assert.equal(refund2.status, 400);
    });
  });

  describe('6. Báo cáo, lịch sử giao dịch & tự động hủy đơn quá hạn thanh toán', () => {
    it('Summary & Transactions: Admin xem được (200), Customer bị chặn (403)', async () => {
      const denied = await api('/api/payments/summary', { token: customerToken });
      assert.equal(denied.status, 403);

      const s = await api('/api/payments/summary', { token: adminToken });
      assert.equal(s.status, 200);
      assert.ok(s.data.collectedAmount >= 0);
      assert.ok(s.data.byMethod && typeof s.data.byMethod.vnpay === 'number');

      const t = await api(`/api/payments/transactions?search=${encodeURIComponent('PH')}&gateway=vnpay`, {
        token: adminToken,
      });
      assert.equal(t.status, 200);
      assert.ok(Array.isArray(t.data));
      assert.ok(t.data.every((x) => x.gateway === 'vnpay'));

      const badStatus = await api('/api/payments/transactions?status=xyz', { token: adminToken });
      assert.equal(badStatus.status, 400);
    });

    it('Đơn VNPay quá hạn chưa thanh toán bị tự động hủy & hoàn tồn kho', async () => {
      const o = await createOnlineOrder('vnpay', 3);
      const code = o.data.order.id;
      const stockAfterOrder = await getStock();
      // Giả lập đơn đã tạo cách đây 10 ngày
      await pool.query(
        'UPDATE Orders SET CreatedAt = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 DAY) WHERE OrderCode = ?',
        [code]
      );

      const bad = await api('/api/payments/expire-unpaid', {
        method: 'POST',
        token: adminToken,
        body: { minutes: 1 },
      });
      assert.equal(bad.status, 400);

      const r = await api('/api/payments/expire-unpaid', {
        method: 'POST',
        token: adminToken,
        body: { minutes: 10080 },
      });
      assert.equal(r.status, 200);
      assert.ok(r.data.orderCodes.includes(code));
      assert.equal(await getStock(), stockAfterOrder + 3);

      const ord = await api(`/api/orders/${code}`);
      assert.equal(ord.data.status, 'cancelled');
    });

    it('OpenAPI có tài liệu cho toàn bộ API thanh toán', async () => {
      const r = await api('/openapi.json');
      assert.equal(r.status, 200);
      for (const p of [
        '/payment-gateways',
        '/payments/vnpay/create',
        '/payments/vnpay/return',
        '/payments/vnpay/ipn',
        '/payments/momo/create',
        '/payments/momo/return',
        '/payments/momo/ipn',
        '/payments/summary',
        '/payments/transactions',
        '/payments/expire-unpaid',
        '/payments/orders/{orderCode}',
        '/payments/orders/{orderCode}/confirm',
        '/payments/orders/{orderCode}/refund',
        '/payments/qr-scan/{txnRef}',
        '/payments/orders/{orderCode}/sandbox-complete',
      ]) {
        assert.ok(r.data.paths[p], `Missing OpenAPI path ${p}`);
      }
    });

    it('QR Sandbox: MoMo sandboxFallback trả 201 + qrScanUrl, xác nhận QR kiểm tra quyền & môi trường', async () => {
      const o = await createOnlineOrder('momo', 1);
      assert.equal(o.status, 201);
      const code = o.data.order.id;

      const created = await api('/api/payments/momo/create', {
        method: 'POST',
        body: { orderCode: code, phone: TEST_PHONE_DIGITS, sandboxFallback: true },
      });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      assert.ok(created.data.qrScanUrl);
      assert.ok(created.data.txnRef);

      const scanRes = await fetch(`${BASE_URL}/api/payments/qr-scan/${created.data.txnRef}`, {
        headers: { Accept: 'application/json' },
      });
      assert.equal(scanRes.status, 200);
      const scanJson = await scanRes.json();
      assert.equal(scanJson.orderCode, code);
      assert.equal(scanJson.customerPhone, undefined);

      // Sai SĐT bị chặn 403
      const denied = await api(`/api/payments/orders/${code}/sandbox-complete`, {
        method: 'POST',
        body: { phone: '0900000000', outcome: 'success' },
      });
      assert.equal(denied.status, 403);

      // Cổng ở chế độ production thì chặn giả lập 403
      await api('/api/payment-gateways', {
        method: 'PUT',
        token: adminToken,
        body: { momoEnvironment: 'production' },
      });
      const prodBlocked = await api(`/api/payments/orders/${code}/sandbox-complete`, {
        method: 'POST',
        body: { phone: TEST_PHONE_DIGITS, outcome: 'success' },
      });
      assert.equal(prodBlocked.status, 403);

      // Bật lại sandbox -> xác nhận QR thành công (paid)
      await api('/api/payment-gateways', {
        method: 'PUT',
        token: adminToken,
        body: { momoEnvironment: 'sandbox' },
      });
      const ok = await api(`/api/payments/orders/${code}/sandbox-complete`, {
        method: 'POST',
        body: { phone: TEST_PHONE_DIGITS, outcome: 'success' },
      });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
      assert.equal(ok.data.success, true);
      assert.equal(ok.data.order.paymentStatus, 'paid');
    });
  });
});
