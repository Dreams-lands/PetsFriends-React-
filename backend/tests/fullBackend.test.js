const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const PORT = '5062';
const BASE_URL = `http://localhost:${PORT}`;

const apiDir = path.resolve(__dirname, '../../api');
const uploadsDir = path.resolve(__dirname, '../uploads/products');

// Valid 1x1 transparent PNG (68 bytes)
const TINY_PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const TEST_CUSTOMER_EMAIL = 'e2e.full.customer@pethub.vn';
const TEST_CUSTOMER_PHONE = '0966555444';
const TEST_CATEGORY_CODE = 'test-cat';
const TEST_PRODUCT_ID = 'prod-e2e-999';
const TEST_ORDER_CODE = 'PHE2E999';
const TEST_ORDER_PHONE_RAW = '0988-777-666';
const TEST_ORDER_PHONE_DIGITS = '0988777666';
const TEST_SPA_PKG_ID = 'pkg-e2e-99';
const TEST_BOOKING_CODE = 'BKTEST888';
const TEST_BOOKING_PHONE_RAW = '0977-666-555';
const TEST_BOOKING_PHONE_DIGITS = '0977666555';
const TEST_CONTACT_PHONE = '0955-444-333';

let sql;
let pool;
let serverProc;
let adminToken = '';
let customerToken = '';
const uploadedFilenames = new Set();

function unwrapEntity(body, preferredKey) {
  if (!body || typeof body !== 'object') return body;
  if (preferredKey && body[preferredKey] !== undefined) return body[preferredKey];
  if (body.data !== undefined) return body.data;
  return body;
}

async function apiRequest(endpoint, { method = 'GET', token = '', body, headers = {} } = {}) {
  const reqHeaders = { ...headers };
  if (token) {
    reqHeaders.Authorization = `Bearer ${token}`;
  }

  let payload = body;
  if (
    body !== undefined &&
    !(body instanceof FormData) &&
    typeof body !== 'string' &&
    !Buffer.isBuffer(body)
  ) {
    reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: reqHeaders,
    body: payload,
  });

  const contentType = res.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.arrayBuffer();
  }

  return { status: res.status, headers: res.headers, data };
}

async function waitForHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    if (serverProc && serverProc.exitCode !== null) {
      throw new Error(`API server exited prematurely with code ${serverProc.exitCode}`);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.status === 200) {
        return;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${BASE_URL}/api/health: ${lastErr?.message || 'unknown'}`);
}

async function cleanupTestArtifacts() {
  if (pool) {
    // 1. Delete test orders & order items
    await pool.request().query(`
      DELETE oi
      FROM dbo.OrderItems oi
      INNER JOIN dbo.Orders o ON oi.OrderId = o.OrderId
      WHERE o.OrderCode = N'${TEST_ORDER_CODE}'
         OR o.CustomerPhone IN (N'${TEST_ORDER_PHONE_RAW}', N'${TEST_ORDER_PHONE_DIGITS}');
    `);
    await pool.request().query(`
      DELETE FROM dbo.Orders
      WHERE OrderCode = N'${TEST_ORDER_CODE}'
         OR CustomerPhone IN (N'${TEST_ORDER_PHONE_RAW}', N'${TEST_ORDER_PHONE_DIGITS}');
    `);

    // 2. Delete test product reviews & products
    await pool.request().query(`
      DELETE FROM dbo.ProductReviews
      WHERE ProductId IN (N'${TEST_PRODUCT_ID}', N'prod-bad-cat');
    `);
    await pool.request().query(`
      DELETE FROM dbo.Products
      WHERE ProductId IN (N'${TEST_PRODUCT_ID}', N'prod-bad-cat');
    `);

    // 3. Delete test category
    await pool.request().query(`
      DELETE FROM dbo.Categories
      WHERE CategoryCode = N'${TEST_CATEGORY_CODE}';
    `);

    // 4. Delete test bookings & spa package
    await pool.request().query(`
      DELETE FROM dbo.ServiceBookings
      WHERE BookingCode = N'${TEST_BOOKING_CODE}'
         OR CustomerPhone IN (N'${TEST_BOOKING_PHONE_RAW}', N'${TEST_BOOKING_PHONE_DIGITS}');
    `);
    await pool.request().query(`
      DELETE FROM dbo.SpaPackages
      WHERE PackageId = N'${TEST_SPA_PKG_ID}';
    `);

    // 5. Delete test contact messages
    await pool.request().query(`
      DELETE FROM dbo.ContactMessages
      WHERE SenderPhone IN (N'${TEST_CONTACT_PHONE}', N'0955444333')
         OR Topic = N'E2E Test Support';
    `);

    // 6. Delete temporary test customer
    await pool.request().query(`
      DELETE FROM dbo.Users
      WHERE Email = N'${TEST_CUSTOMER_EMAIL}';
    `);
  }

  // 7. Delete uploaded test files
  for (const filename of uploadedFilenames) {
    if (!filename) continue;
    const filePath = path.join(uploadsDir, path.basename(filename));
    await fs.promises.unlink(filePath).catch(() => {});
  }
  try {
    const existing = await fs.promises.readdir(uploadsDir);
    for (const file of existing) {
      if (/test-upload/i.test(file)) {
        await fs.promises.unlink(path.join(uploadsDir, file)).catch(() => {});
      }
    }
  } catch {
    // Directory might not exist yet
  }
}

describe('PetsFriend Full Backend & REST API Integration Suite (PORT 5062)', () => {
  before(async () => {
    const prevCwd = process.cwd();
    process.chdir(apiDir);
    const dbMod = require('../../api/db');
    sql = dbMod.sql;
    pool = await dbMod.poolPromise;
    process.chdir(prevCwd);

    await cleanupTestArtifacts();

    let serverStderr = '';
    serverProc = spawn(process.execPath, ['server.js'], {
      cwd: apiDir,
      env: { ...process.env, PORT },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc.stderr.on('data', (chunk) => {
      serverStderr += chunk.toString();
    });

    try {
      await waitForHealth(15000);
    } catch (err) {
      throw new Error(`${err.message}\nServer stderr:\n${serverStderr}`);
    }

    // Obtain admin JWT token
    const adminRes = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'admin@pethub.vn', password: 'Admin@123' },
    });
    assert.equal(adminRes.status, 200, `Admin login failed: ${JSON.stringify(adminRes.data)}`);
    assert.ok(adminRes.data.token, 'Expected JWT token for admin');
    adminToken = adminRes.data.token;

    // Register temporary customer for RBAC & review checks
    const custRes = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'E2E Full Customer',
        email: TEST_CUSTOMER_EMAIL,
        phone: TEST_CUSTOMER_PHONE,
        password: 'Customer@123',
        gender: 'Nữ',
      },
    });
    assert.equal(custRes.status, 201, `Customer register failed: ${JSON.stringify(custRes.data)}`);
    assert.ok(custRes.data.token, 'Expected JWT token for customer');
    customerToken = custRes.data.token;
  });

  after(async () => {
    try {
      await cleanupTestArtifacts();
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
      if (pool && typeof pool.close === 'function') {
        await pool.close().catch(() => {});
      }
    }
  });

  // =========================================================================
  // 1. System & Error Handling
  // =========================================================================
  describe('1. System & Error Handling', () => {
    it('GET /api/health returns 200 OK', async () => {
      const res = await apiRequest('/api/health');
      assert.equal(res.status, 200);
      assert.equal(res.data.status, 'OK');
    });

    it('Malformed JSON body returns 400 with friendly Vietnamese message', async () => {
      const res = await apiRequest('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"customerName": "Broken JSON", ',
      });
      assert.equal(res.status, 400);
      assert.ok(res.data && typeof res.data.message === 'string');
    });

    it('Unknown /api/* path returns 404 JSON', async () => {
      const res = await apiRequest('/api/non-existent-route-999');
      assert.equal(res.status, 404);
      assert.ok(res.data && typeof res.data.message === 'string');
    });

    it('GET /openapi.json returns 200 and documents all core endpoints across all 5 tags', async () => {
      const res = await apiRequest('/openapi.json');
      assert.equal(res.status, 200);
      assert.equal(res.data.openapi, '3.0.3');
      assert.ok(res.data.components?.securitySchemes?.bearerAuth);

      const expectedPaths = [
        '/health',
        '/auth/login',
        '/auth/register',
        '/auth/me',
        '/categories',
        '/categories/{code}',
        '/products',
        '/products/promotions',
        '/products/featured',
        '/products/low-stock',
        '/products/{id}',
        '/products/{id}/stock',
        '/products/{id}/restore',
        '/products/{id}/reviews',
        '/product-reviews',
        '/product-reviews/{reviewId}',
        '/upload',
        '/products/upload-image',
        '/orders',
        '/orders/lookup',
        '/orders/{id}',
        '/orders/{id}/items',
        '/orders/{id}/status',
        '/orders/{id}/cancel',
        '/order-items',
        '/analytics/overview',
        '/analytics/daily',
        '/analytics/period',
        '/spa-packages',
        '/spa-packages/{id}',
        '/service-bookings',
        '/service-bookings/lookup',
        '/service-bookings/{id}',
        '/service-bookings/{id}/status',
        '/service-bookings/{id}/assign-staff',
        '/service-bookings/{id}/cancel',
        '/contact-messages',
        '/contact-messages/{id}',
        '/contact-messages/{id}/status',
      ];

      for (const p of expectedPaths) {
        assert.ok(res.data.paths[p], `Expected path ${p} in /openapi.json`);
      }
    });
  });

  // =========================================================================
  // 2. Image Upload & Static Serving
  // =========================================================================
  describe('2. Image Upload & Static Serving', () => {
    it('Blocks customer role from uploading product images (403)', async () => {
      const form = new FormData();
      form.append('image', new Blob([TINY_PNG_BUFFER], { type: 'image/png' }), 'test-upload.png');
      const res = await apiRequest('/api/upload', {
        method: 'POST',
        token: customerToken,
        body: form,
      });
      assert.equal(res.status, 403);
    });

    it('Uploads valid 1x1 PNG via FormData (201) and serves it statically at /uploads/products/... (200 image/png)', async () => {
      const form = new FormData();
      form.append('image', new Blob([TINY_PNG_BUFFER], { type: 'image/png' }), 'test-upload.png');

      const uploadRes = await apiRequest('/api/upload', {
        method: 'POST',
        token: adminToken,
        body: form,
      });
      assert.equal(uploadRes.status, 201, `Upload failed: ${JSON.stringify(uploadRes.data)}`);
      assert.ok(
        typeof uploadRes.data.imageUrl === 'string' &&
          uploadRes.data.imageUrl.startsWith('/uploads/products/'),
        `Unexpected imageUrl: ${uploadRes.data.imageUrl}`
      );

      const filename = uploadRes.data.filename || path.basename(uploadRes.data.imageUrl);
      uploadedFilenames.add(filename);

      const staticRes = await apiRequest(uploadRes.data.imageUrl);
      assert.equal(staticRes.status, 200);
      assert.match(staticRes.headers.get('content-type') || '', /image\/png/i);
      assert.ok(staticRes.data.byteLength > 0);
    });

    it('Rejects invalid file extensions (.exe and .txt) with 400', async () => {
      const badFormExe = new FormData();
      badFormExe.append(
        'image',
        new Blob([Buffer.from('MZ-fake-exe')], { type: 'application/octet-stream' }),
        'malware.exe'
      );
      const exeRes = await apiRequest('/api/upload', {
        method: 'POST',
        token: adminToken,
        body: badFormExe,
      });
      assert.equal(exeRes.status, 400);

      const badFormTxt = new FormData();
      badFormTxt.append(
        'image',
        new Blob([Buffer.from('plain text content')], { type: 'text/plain' }),
        'readme.txt'
      );
      const txtRes = await apiRequest('/api/upload', {
        method: 'POST',
        token: adminToken,
        body: badFormTxt,
      });
      assert.equal(txtRes.status, 400);
    });
  });

  // =========================================================================
  // 3. Categories CRUD & Constraints
  // =========================================================================
  describe('3. Categories CRUD & Constraints', () => {
    it('Creates category test-cat (201), rejects duplicate (409), updates & fetches it (200)', async () => {
      // RBAC check
      const forbiddenRes = await apiRequest('/api/categories', {
        method: 'POST',
        token: customerToken,
        body: { id: TEST_CATEGORY_CODE, name: 'Test Cat' },
      });
      assert.equal(forbiddenRes.status, 403);

      // Create
      const createRes = await apiRequest('/api/categories', {
        method: 'POST',
        token: adminToken,
        body: {
          id: TEST_CATEGORY_CODE,
          categoryCode: TEST_CATEGORY_CODE,
          name: 'Đồ chơi Thử nghiệm',
          label: 'Đồ chơi Thử nghiệm',
        },
      });
      assert.equal(createRes.status, 201, `Create cat failed: ${JSON.stringify(createRes.data)}`);

      // Duplicate -> 409
      const dupRes = await apiRequest('/api/categories', {
        method: 'POST',
        token: adminToken,
        body: {
          id: TEST_CATEGORY_CODE,
          categoryCode: TEST_CATEGORY_CODE,
          name: 'Trùng danh mục',
        },
      });
      assert.equal(dupRes.status, 409);

      // Update -> 200
      const updateRes = await apiRequest(`/api/categories/${TEST_CATEGORY_CODE}`, {
        method: 'PUT',
        token: adminToken,
        body: { name: 'Đồ chơi Cao cấp E2E', label: 'Đồ chơi Cao cấp E2E' },
      });
      assert.equal(updateRes.status, 200);

      // Get single -> 200
      const getRes = await apiRequest(`/api/categories/${TEST_CATEGORY_CODE}`);
      assert.equal(getRes.status, 200);
      const cat = unwrapEntity(getRes.data, 'category');
      assert.equal(cat.name || cat.label, 'Đồ chơi Cao cấp E2E');
    });

    it('Prevents deleting category containing products (food -> 409, NOT 500) and deletes empty test-cat (200)', async () => {
      const foodDelRes = await apiRequest('/api/categories/food', {
        method: 'DELETE',
        token: adminToken,
      });
      assert.equal(foodDelRes.status, 409, `Expected 409 for non-empty category, got ${foodDelRes.status}`);

      const testDelRes = await apiRequest(`/api/categories/${TEST_CATEGORY_CODE}`, {
        method: 'DELETE',
        token: adminToken,
      });
      assert.equal(testDelRes.status, 200);

      const afterDelRes = await apiRequest(`/api/categories/${TEST_CATEGORY_CODE}`);
      assert.equal(afterDelRes.status, 404);
    });
  });

  // =========================================================================
  // 4. Products CRUD, Partial Update, Stock & Reviews
  // =========================================================================
  describe('4. Products CRUD, Partial Update, Stock & Reviews', () => {
    it('Creates prod-e2e-999 (201), rejects duplicate SKU (409) and invalid category (400)', async () => {
      const createRes = await apiRequest('/api/products', {
        method: 'POST',
        token: adminToken,
        body: {
          id: TEST_PRODUCT_ID,
          productId: TEST_PRODUCT_ID,
          brand: 'PETSFRIEND E2E',
          name: 'Bánh thưởng E2E Cá Hồi',
          shortDesc: 'Sản phẩm kiểm thử tích hợp toàn hệ thống',
          category: 'food',
          subType: 'Pate & Bánh thưởng',
          petType: 'both',
          sizes: ['Gói 100g', 'Gói 250g'],
          priceNum: 200000,
          originalPriceNum: 250000,
          stockCount: 5,
          image: '/images/prod-chicken-pate.jpg',
          isFeatured: true,
        },
      });
      assert.equal(createRes.status, 201, `Create product failed: ${JSON.stringify(createRes.data)}`);
      const created = unwrapEntity(createRes.data, 'product');
      assert.equal(created.id, TEST_PRODUCT_ID);
      assert.equal(created.priceNum, 200000);
      assert.equal(created.stockCount, 5);

      // Duplicate SKU -> 409
      const dupRes = await apiRequest('/api/products', {
        method: 'POST',
        token: adminToken,
        body: {
          id: TEST_PRODUCT_ID,
          name: 'Sản phẩm trùng SKU',
          category: 'food',
          priceNum: 150000,
          image: '/images/prod-chicken-pate.jpg',
        },
      });
      assert.equal(dupRes.status, 409);

      // Invalid category -> 400
      const badCatRes = await apiRequest('/api/products', {
        method: 'POST',
        token: adminToken,
        body: {
          id: 'prod-bad-cat',
          name: 'Sản phẩm sai danh mục',
          category: 'non-existent-category',
          priceNum: 150000,
          image: '/images/prod-chicken-pate.jpg',
        },
      });
      assert.equal(badCatRes.status, 400);
    });

    it('Partial PUT /api/products/prod-e2e-999 with ONLY { stockCount: 6 } preserves name, priceNum & originalPrice', async () => {
      const putRes = await apiRequest(`/api/products/${TEST_PRODUCT_ID}`, {
        method: 'PUT',
        token: adminToken,
        body: { stockCount: 6 },
      });
      assert.equal(putRes.status, 200, `Partial PUT failed: ${JSON.stringify(putRes.data)}`);

      const getRes = await apiRequest(`/api/products/${TEST_PRODUCT_ID}`);
      assert.equal(getRes.status, 200);
      const prod = unwrapEntity(getRes.data, 'product');
      assert.equal(prod.stockCount, 6);
      assert.equal(prod.name, 'Bánh thưởng E2E Cá Hồi');
      assert.equal(prod.priceNum, 200000);
      assert.equal(prod.originalPriceNum, 250000);
      assert.ok(prod.originalPrice, 'Expected formatted originalPrice to be preserved');
    });

    it('PATCH /api/products/prod-e2e-999/stock adjusts delta: -1 -> 5 and rejects negative resulting stock (delta: -999 -> 400)', async () => {
      const decRes = await apiRequest(`/api/products/${TEST_PRODUCT_ID}/stock`, {
        method: 'PATCH',
        token: adminToken,
        body: { delta: -1 },
      });
      assert.equal(decRes.status, 200);
      const prodAfterDec = unwrapEntity(decRes.data, 'product');
      assert.equal(prodAfterDec.stockCount, 5);

      const negRes = await apiRequest(`/api/products/${TEST_PRODUCT_ID}/stock`, {
        method: 'PATCH',
        token: adminToken,
        body: { delta: -999 },
      });
      assert.equal(negRes.status, 400);

      const verifyRes = await apiRequest(`/api/products/${TEST_PRODUCT_ID}`);
      const verifiedProd = unwrapEntity(verifyRes.data, 'product');
      assert.equal(verifiedProd.stockCount, 5);
    });

    it('Lists prod-e2e-999 in /api/products/promotions and /api/products/low-stock', async () => {
      const promoRes = await apiRequest('/api/products/promotions');
      assert.equal(promoRes.status, 200);
      const promoList = Array.isArray(promoRes.data)
        ? promoRes.data
        : promoRes.data.items || promoRes.data.products || promoRes.data.data;
      assert.ok(Array.isArray(promoList));
      assert.ok(promoList.some((p) => p.id === TEST_PRODUCT_ID));

      const lowStockRes = await apiRequest('/api/products/low-stock', { token: adminToken });
      assert.equal(lowStockRes.status, 200);
      const lowStockList = Array.isArray(lowStockRes.data)
        ? lowStockRes.data
        : lowStockRes.data.items || lowStockRes.data.products || lowStockRes.data.data;
      assert.ok(Array.isArray(lowStockList));
      assert.ok(lowStockList.some((p) => p.id === TEST_PRODUCT_ID));
    });

    it('Handles product reviews CRUD cleanly and returns 404 (not 500) for non-existent SKU', async () => {
      const missingSkuRes = await apiRequest('/api/products/non-existent-sku/reviews', {
        method: 'POST',
        body: { author: 'Tester', rating: 5, comment: 'Không tồn tại' },
      });
      assert.equal(missingSkuRes.status, 404);

      const createRevRes = await apiRequest(`/api/products/${TEST_PRODUCT_ID}/reviews`, {
        method: 'POST',
        token: customerToken,
        body: {
          author: 'E2E Reviewer',
          petTag: 'Nuôi Corgi',
          rating: 5,
          comment: 'Bánh thưởng rất thơm, bé ăn hết veo!',
        },
      });
      assert.equal(createRevRes.status, 201, `Create review failed: ${JSON.stringify(createRevRes.data)}`);
      const rev = unwrapEntity(createRevRes.data, 'review');
      const reviewId = rev.reviewId ?? Number(String(rev.id).replace(/^rev-/, ''));
      assert.ok(Number.isInteger(Number(reviewId)));

      const updateRevRes = await apiRequest(`/api/product-reviews/${reviewId}`, {
        method: 'PUT',
        token: customerToken,
        body: {
          rating: 4,
          comment: 'Cập nhật sau 1 tuần: chất lượng rất ổn định.',
        },
      });
      assert.equal(updateRevRes.status, 200);
      const updatedRev = unwrapEntity(updateRevRes.data, 'review');
      assert.equal(updatedRev.rating, 4);

      const delRevRes = await apiRequest(`/api/product-reviews/${reviewId}`, {
        method: 'DELETE',
        token: customerToken,
      });
      assert.equal(delRevRes.status, 200);
    });

    it('Soft-deletes prod-e2e-999 from active catalog and restores it cleanly', async () => {
      const delRes = await apiRequest(`/api/products/${TEST_PRODUCT_ID}`, {
        method: 'DELETE',
        token: adminToken,
      });
      assert.equal(delRes.status, 200);

      const listAfterDel = await apiRequest('/api/products');
      assert.equal(listAfterDel.status, 200);
      assert.ok(Array.isArray(listAfterDel.data));
      assert.equal(
        listAfterDel.data.some((p) => p.id === TEST_PRODUCT_ID),
        false,
        'Soft-deleted product must be hidden from GET /api/products'
      );

      const restoreRes = await apiRequest(`/api/products/${TEST_PRODUCT_ID}/restore`, {
        method: 'PATCH',
        token: adminToken,
      });
      assert.equal(restoreRes.status, 200);

      const listAfterRestore = await apiRequest('/api/products');
      assert.equal(listAfterRestore.status, 200);
      assert.equal(
        listAfterRestore.data.some((p) => p.id === TEST_PRODUCT_ID),
        true,
        'Restored product must appear again in GET /api/products'
      );
    });
  });

  // =========================================================================
  // 5. Orders, Stock Protection, Price Tampering Prevention & Self-Cancel
  // =========================================================================
  describe('5. Orders, Stock Protection, Price Tampering Prevention & Self-Cancel', () => {
    let createdOrderCode = TEST_ORDER_CODE;

    it('Rejects over-stock order (quantity: 50 when stockCount === 5) with 400 and preserves stockCount === 5', async () => {
      const overRes = await apiRequest('/api/orders', {
        method: 'POST',
        body: {
          customerName: 'Khách Đặt Quá Kho',
          customerPhone: TEST_ORDER_PHONE_RAW,
          deliveryMethod: 'delivery',
          shippingAddress: '100 Lê Lợi, Quận 1, TP.HCM',
          paymentMethod: 'cod',
          orderSource: 'online',
          items: [
            {
              productId: TEST_PRODUCT_ID,
              name: 'Bánh thưởng E2E Cá Hồi',
              image: '/images/prod-chicken-pate.jpg',
              price: 200000,
              quantity: 50,
            },
          ],
        },
      });
      assert.equal(overRes.status, 400);

      const prodRes = await apiRequest(`/api/products/${TEST_PRODUCT_ID}`);
      const prod = unwrapEntity(prodRes.data, 'product');
      assert.equal(prod.stockCount, 5);
    });

    it('Creates valid order (quantity: 2) ignoring tampered client price: 1 -> totalAmount === 400000 & stockCount === 3', async () => {
      const orderRes = await apiRequest('/api/orders', {
        method: 'POST',
        body: {
          orderCode: TEST_ORDER_CODE,
          customerName: 'Khách Hàng E2E',
          customerPhone: TEST_ORDER_PHONE_RAW,
          deliveryMethod: 'delivery',
          shippingAddress: '200 Nguyễn Huệ, Quận 1, TP.HCM',
          paymentMethod: 'vnpay',
          orderSource: 'online',
          items: [
            {
              productId: TEST_PRODUCT_ID,
              name: 'Bánh thưởng E2E Cá Hồi',
              image: '/images/prod-chicken-pate.jpg',
              price: 1, // Tampered client price!
              quantity: 2,
            },
          ],
        },
      });
      assert.equal(orderRes.status, 201, `Order create failed: ${JSON.stringify(orderRes.data)}`);
      const order = unwrapEntity(orderRes.data, 'order');
      createdOrderCode = order.orderCode || order.id;
      assert.equal(order.totalAmount, 400000);

      const prodRes = await apiRequest(`/api/products/${TEST_PRODUCT_ID}`);
      const prod = unwrapEntity(prodRes.data, 'product');
      assert.equal(prod.stockCount, 3);
    });

    it('Finds order via GET /api/orders/lookup with normalized digits 0988777666', async () => {
      const lookupRes = await apiRequest(
        `/api/orders/lookup?phone=${TEST_ORDER_PHONE_DIGITS}&orderCode=${encodeURIComponent(createdOrderCode)}`
      );
      assert.equal(lookupRes.status, 200, `Order lookup failed: ${JSON.stringify(lookupRes.data)}`);
      const lookedUp = unwrapEntity(lookupRes.data, 'order');
      assert.equal(lookedUp.orderCode || lookedUp.id, createdOrderCode);
      assert.equal(lookedUp.totalAmount, 400000);
    });

    it('Enforces ownership on self-cancel (wrong phone -> 403, matching phone -> 200) and restores stockCount to 5', async () => {
      const wrongPhoneRes = await apiRequest(`/api/orders/${createdOrderCode}/cancel`, {
        method: 'POST',
        body: { phone: '0911222333' },
      });
      assert.equal(wrongPhoneRes.status, 403);

      const cancelRes = await apiRequest(`/api/orders/${createdOrderCode}/cancel`, {
        method: 'POST',
        body: { phone: TEST_ORDER_PHONE_DIGITS },
      });
      assert.equal(cancelRes.status, 200, `Self-cancel failed: ${JSON.stringify(cancelRes.data)}`);
      const cancelledOrder = unwrapEntity(cancelRes.data, 'order');
      assert.equal(cancelledOrder.status, 'cancelled');

      const prodRes = await apiRequest(`/api/products/${TEST_PRODUCT_ID}`);
      const prod = unwrapEntity(prodRes.data, 'product');
      assert.equal(prod.stockCount, 5);
    });

    it('Deducts stock back to 3 when Admin re-opens cancelled order to shipping, and restores to 5 on Admin DELETE', async () => {
      const reopenRes = await apiRequest(`/api/orders/${createdOrderCode}/status`, {
        method: 'PATCH',
        token: adminToken,
        body: { status: 'shipping', staffName: 'Linh Phạm' },
      });
      assert.equal(reopenRes.status, 200, `Re-open order failed: ${JSON.stringify(reopenRes.data)}`);
      const reopened = unwrapEntity(reopenRes.data, 'order');
      assert.equal(reopened.status, 'shipping');

      const prodAfterReopen = await apiRequest(`/api/products/${TEST_PRODUCT_ID}`);
      assert.equal(unwrapEntity(prodAfterReopen.data, 'product').stockCount, 3);

      const delOrderRes = await apiRequest(`/api/orders/${createdOrderCode}`, {
        method: 'DELETE',
        token: adminToken,
      });
      assert.equal(delOrderRes.status, 200);

      const prodAfterDelete = await apiRequest(`/api/products/${TEST_PRODUCT_ID}`);
      assert.equal(unwrapEntity(prodAfterDelete.data, 'product').stockCount, 5);
    });
  });

  // =========================================================================
  // 6. Analytics
  // =========================================================================
  describe('6. Analytics', () => {
    it('GET /api/analytics/overview returns orders, bookings, lowStockCount, lowStockProducts, topProducts & monthlyTrend', async () => {
      const forbidden = await apiRequest('/api/analytics/overview', { token: customerToken });
      assert.equal(forbidden.status, 403);

      const res = await apiRequest('/api/analytics/overview', { token: adminToken });
      assert.equal(res.status, 200, `Analytics overview failed: ${JSON.stringify(res.data)}`);
      assert.ok(res.data.orders && typeof res.data.orders === 'object');
      assert.ok(res.data.bookings && typeof res.data.bookings === 'object');
      assert.equal(typeof res.data.lowStockCount, 'number');
      assert.ok(Array.isArray(res.data.lowStockProducts));
      assert.ok(Array.isArray(res.data.topProducts));
      assert.ok(Array.isArray(res.data.monthlyTrend));
    });

    it('GET /api/analytics/daily returns daily summary metrics, series & invoices', async () => {
      const res = await apiRequest('/api/analytics/daily', { token: adminToken });
      assert.equal(res.status, 200, `Analytics daily failed: ${JSON.stringify(res.data)}`);
      const summary = res.data.summary || res.data;
      assert.equal(typeof (summary.total ?? summary.totalRevenue), 'number');
      assert.ok(Array.isArray(res.data.series));
      assert.ok(Array.isArray(res.data.invoices));
    });

    it('GET /api/analytics/period supports past-months (12 months) and past-years (3 years)', async () => {
      const monthsRes = await apiRequest('/api/analytics/period?period=past-months', {
        token: adminToken,
      });
      assert.equal(monthsRes.status, 200);
      const monthsTrend = monthsRes.data.trend || monthsRes.data.series || monthsRes.data.items;
      assert.ok(Array.isArray(monthsTrend));
      assert.equal(monthsTrend.length, 12);

      const yearsRes = await apiRequest('/api/analytics/period?period=past-years', {
        token: adminToken,
      });
      assert.equal(yearsRes.status, 200);
      const yearsTrend = yearsRes.data.trend || yearsRes.data.series || yearsRes.data.items;
      assert.ok(Array.isArray(yearsTrend));
      assert.equal(yearsTrend.length, 3);
    });
  });

  // =========================================================================
  // 7. Spa Packages, Service Bookings & Contact Messages
  // =========================================================================
  describe('7. Spa Packages, Service Bookings & Contact Messages', () => {
    it('Manages Spa Packages CRUD (create 201, duplicate 409, partial PUT 200, GET/:id 200)', async () => {
      const createRes = await apiRequest('/api/spa-packages', {
        method: 'POST',
        token: adminToken,
        body: {
          id: TEST_SPA_PKG_ID,
          packageId: TEST_SPA_PKG_ID,
          name: 'Gói Spa E2E Khoáng Nóng',
          desc: 'Chăm sóc thư giãn chuyên sâu E2E',
          price: 290000,
          duration: '60 phút',
        },
      });
      assert.equal(createRes.status, 201, `Spa package create failed: ${JSON.stringify(createRes.data)}`);

      const dupRes = await apiRequest('/api/spa-packages', {
        method: 'POST',
        token: adminToken,
        body: {
          id: TEST_SPA_PKG_ID,
          name: 'Trùng Gói Spa',
          price: 190000,
          duration: '45 phút',
        },
      });
      assert.equal(dupRes.status, 409);

      const putRes = await apiRequest(`/api/spa-packages/${TEST_SPA_PKG_ID}`, {
        method: 'PUT',
        token: adminToken,
        body: { price: 320000 },
      });
      assert.equal(putRes.status, 200);

      const getRes = await apiRequest(`/api/spa-packages/${TEST_SPA_PKG_ID}`);
      assert.equal(getRes.status, 200);
      const pkg = unwrapEntity(getRes.data, 'spaPackage');
      assert.equal(pkg.name, 'Gói Spa E2E Khoáng Nóng');
      assert.equal(pkg.price, 320000);
      assert.equal(pkg.duration, '60 phút');
    });

    it('Creates Service Booking BKTEST888, looks up by normalized phone, self-cancels, and deletes booking & package', async () => {
      const createBkRes = await apiRequest('/api/service-bookings', {
        method: 'POST',
        body: {
          bookingCode: TEST_BOOKING_CODE,
          packageId: TEST_SPA_PKG_ID,
          petName: 'Mochi (Poodle)',
          date: '2026-12-22',
          timeSlot: '10:30 Sáng',
          customerName: 'Nguyễn Thảo E2E',
          customerPhone: TEST_BOOKING_PHONE_RAW,
          note: 'Bé rất ngoan',
        },
      });
      assert.equal(createBkRes.status, 201, `Booking create failed: ${JSON.stringify(createBkRes.data)}`);
      const createdBk = unwrapEntity(createBkRes.data, 'booking');
      assert.equal(createdBk.bookingCode || createdBk.id, TEST_BOOKING_CODE);
      assert.equal(createdBk.price, 320000);
      assert.ok(createdBk.staffName, 'Expected smart staff assignment to set staffName');

      const lookupRes = await apiRequest(
        `/api/service-bookings/lookup?phone=${TEST_BOOKING_PHONE_DIGITS}&bookingCode=${TEST_BOOKING_CODE}`
      );
      assert.equal(lookupRes.status, 200);
      const lookedUpBk = unwrapEntity(lookupRes.data, 'booking');
      assert.equal(lookedUpBk.bookingCode || lookedUpBk.id, TEST_BOOKING_CODE);

      const cancelRes = await apiRequest(`/api/service-bookings/${TEST_BOOKING_CODE}/cancel`, {
        method: 'POST',
        body: { phone: TEST_BOOKING_PHONE_DIGITS },
      });
      assert.equal(cancelRes.status, 200);
      const cancelledBk = unwrapEntity(cancelRes.data, 'booking');
      assert.equal(cancelledBk.status, 'cancelled');

      const delBkRes = await apiRequest(`/api/service-bookings/${TEST_BOOKING_CODE}`, {
        method: 'DELETE',
        token: adminToken,
      });
      assert.equal(delBkRes.status, 200);

      const delPkgRes = await apiRequest(`/api/spa-packages/${TEST_SPA_PKG_ID}`, {
        method: 'DELETE',
        token: adminToken,
      });
      assert.equal(delPkgRes.status, 200);
    });

    it('Manages Contact Messages lifecycle (POST 201 -> GET/:id 200 -> PATCH status replied 200 -> DELETE 200)', async () => {
      const postRes = await apiRequest('/api/contact-messages', {
        method: 'POST',
        body: {
          senderName: 'Lê Minh E2E',
          senderPhone: TEST_CONTACT_PHONE,
          topic: 'E2E Test Support',
          message: 'Nhờ shop tư vấn lịch tắm cuối tuần cho bé Corgi.',
        },
      });
      assert.equal(postRes.status, 201, `Contact post failed: ${JSON.stringify(postRes.data)}`);
      const msg = unwrapEntity(postRes.data, 'contactMessage');
      const msgId = msg.id ?? msg.messageId ?? msg.MessageId;
      assert.ok(Number.isInteger(Number(msgId)));

      const getRes = await apiRequest(`/api/contact-messages/${msgId}`, {
        token: adminToken,
      });
      assert.equal(getRes.status, 200);
      const fetched = unwrapEntity(getRes.data, 'contactMessage');
      assert.equal(fetched.senderName || fetched.SenderName, 'Lê Minh E2E');

      const patchRes = await apiRequest(`/api/contact-messages/${msgId}/status`, {
        method: 'PATCH',
        token: adminToken,
        body: { status: 'replied' },
      });
      assert.equal(patchRes.status, 200);
      const patched = unwrapEntity(patchRes.data, 'contactMessage');
      assert.equal(patched.status || patched.Status, 'replied');

      const delRes = await apiRequest(`/api/contact-messages/${msgId}`, {
        method: 'DELETE',
        token: adminToken,
      });
      assert.equal(delRes.status, 200);
    });
  });
});
