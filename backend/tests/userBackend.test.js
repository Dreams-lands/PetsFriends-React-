const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 5059;
const BASE_URL = `http://localhost:${PORT}`;
const apiDir = path.resolve(__dirname, '../../api');

const TEST_CUSTOMER_EMAIL = 'e2e.customer.user@pethub.vn';
const TEST_ADMIN_CREATED_EMAIL = 'e2e.editor.user@pethub.vn';
const TEMP_STAFF_NAME = 'Nhân Viên Test E2E';

const DEFAULT_PERMS = {
  ordersManage: true,
  ordersInvoices: true,
  pos: true,
  appointments: true,
  inventoryView: true,
  inventoryEdit: false,
  analytics: false,
  settings: false,
};

let serverProc = null;
let pool = null;

let customerId = null;
let customerToken = null;
let initialAddressId = null;
let adminToken = null;
let adminUserId = null;
let createdStaffUserId = null;

async function apiRequest(pathname, options = {}) {
  const { method = 'GET', token = null, body = undefined } = options;
  const headers = { Accept: 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers,
    body: payload,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function waitForHealth(timeoutMs = 20000) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { status, data } = await apiRequest('/api/health');
      if (status === 200 && data && data.status === 'OK') {
        return;
      }
    } catch (err) {
      lastError = err;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Server on port ${PORT} did not become healthy in time: ${lastError?.message || 'timeout'}`
  );
}

async function cleanupTestArtifacts() {
  if (!pool) return;

  await pool.query(
    `
      DELETE FROM Users
      WHERE LOWER(Email) IN (LOWER(?), LOWER(?))
    `,
    [TEST_CUSTOMER_EMAIL, TEST_ADMIN_CREATED_EMAIL]
  );

  await pool.query('DELETE FROM StaffRoster WHERE LOWER(StaffName) = LOWER(?)', [
    TEMP_STAFF_NAME,
  ]);

  for (const [permKey, isAllowed] of Object.entries(DEFAULT_PERMS)) {
    // eslint-disable-next-line no-await-in-loop
    await pool.query(
      `
        INSERT INTO StaffPermissions (PermKey, IsAllowed)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE IsAllowed = VALUES(IsAllowed)
      `,
      [permKey, isAllowed ? 1 : 0]
    );
  }
}

describe('User & Auth Backend Integration Suite (QLThuCung)', () => {
  before(async () => {
    const prevCwd = process.cwd();
    process.chdir(apiDir);
    const dbModule = require(path.join(apiDir, 'db'));
    pool = await dbModule.poolPromise;
    process.chdir(prevCwd);

    await cleanupTestArtifacts();

    serverProc = spawn(process.execPath, ['server.js'], {
      cwd: apiDir,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await waitForHealth();
  });

  after(async () => {
    try {
      await cleanupTestArtifacts();
    } finally {
      if (serverProc && !serverProc.killed) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 2000);
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

  it('1. POST /api/auth/register creates customer with dashed phone, gender Nữ, initial address, and stores bcrypt hash in MySQL', async () => {
    const { status, data } = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Nguyễn Thị Thử Nghiệm',
        email: TEST_CUSTOMER_EMAIL,
        phone: '0912-345-678',
        password: 'UserPass@123',
        gender: 'Nữ',
        address: '45 Lê Lợi, Quận 1, TP. Hồ Chí Minh',
      },
    });

    assert.equal(status, 201);
    assert.ok(data.token && typeof data.token === 'string');
    assert.ok(data.user && data.user.userId);
    assert.equal(data.user.email, TEST_CUSTOMER_EMAIL);
    assert.equal(data.user.role, 'customer');
    assert.equal(data.user.gender, 'Nữ');
    assert.equal(data.user.status, 'active');
    assert.ok(Array.isArray(data.addresses));
    assert.equal(data.addresses.length, 1);
    assert.equal(data.addresses[0].isDefault, true);

    customerId = data.user.userId;
    customerToken = data.token;
    initialAddressId = data.addresses[0].addressId;

    const [dbRows] = await pool.query(
      'SELECT PasswordHash, Gender, Status FROM Users WHERE UserId = ?',
      [customerId]
    );

    assert.equal(dbRows.length, 1);
    assert.match(dbRows[0].PasswordHash, /^\$2[aby]\$/);
    assert.notEqual(dbRows[0].PasswordHash, 'UserPass@123');
    assert.equal(dbRows[0].Gender, 'Nữ');
    assert.equal(dbRows[0].Status, 'active');
  });

  it('2. POST /api/auth/register rejects duplicate email with 409', async () => {
    const { status, data } = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'Trùng Email',
        email: TEST_CUSTOMER_EMAIL,
        phone: '0988777666',
        password: 'UserPass@123',
      },
    });

    assert.equal(status, 409);
    assert.ok(data && data.message);
  });

  it('3. POST /api/auth/login supports email, normalized phone digits (0912345678 -> 0912-345-678), and rejects wrong password (401)', async () => {
    const byEmail = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: {
        identifier: TEST_CUSTOMER_EMAIL,
        password: 'UserPass@123',
      },
    });
    assert.equal(byEmail.status, 200);
    assert.ok(byEmail.data.token);
    assert.equal(byEmail.data.user.userId, customerId);

    const byNormalizedPhone = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: {
        identifier: '0912345678',
        password: 'UserPass@123',
      },
    });
    assert.equal(byNormalizedPhone.status, 200);
    assert.ok(byNormalizedPhone.data.token);
    assert.equal(byNormalizedPhone.data.user.userId, customerId);

    const wrongPass = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: {
        identifier: TEST_CUSTOMER_EMAIL,
        password: 'WrongPassword999',
      },
    });
    assert.equal(wrongPass.status, 401);
  });

  it('4. GET /api/auth/me requires Bearer token (401 without token, 200 with valid token)', async () => {
    const noToken = await apiRequest('/api/auth/me');
    assert.equal(noToken.status, 401);

    const withToken = await apiRequest('/api/auth/me', {
      token: customerToken,
    });
    assert.equal(withToken.status, 200);
    assert.equal(withToken.data.user.userId, customerId);
    assert.ok(Array.isArray(withToken.data.addresses));
    assert.ok(Array.isArray(withToken.data.wishlist));
  });

  it('5. RBAC enforcement rejects unauthorized customer actions (403) and allows admin login', async () => {
    const createAttempt = await apiRequest('/api/users', {
      method: 'POST',
      token: customerToken,
      body: {
        fullName: 'Unauthorized Create',
        email: 'unauth.create@pethub.vn',
        role: 'staff',
      },
    });
    assert.equal(createAttempt.status, 403);

    const deleteAttempt = await apiRequest(`/api/users/${customerId}`, {
      method: 'DELETE',
      token: customerToken,
    });
    assert.equal(deleteAttempt.status, 403);

    const otherProfileAttempt = await apiRequest('/api/users/1/profile', {
      method: 'PUT',
      token: customerToken,
      body: {
        name: 'Hack Admin Name',
        email: 'admin@pethub.vn',
      },
    });
    assert.equal(otherProfileAttempt.status, 403);

    const adminLogin = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: {
        identifier: 'admin@pethub.vn',
        password: 'Admin@123',
      },
    });
    assert.equal(adminLogin.status, 200);
    assert.ok(adminLogin.data.token);
    assert.equal(adminLogin.data.user.role, 'admin');
    adminToken = adminLogin.data.token;
    adminUserId = adminLogin.data.user.userId;
  });

  it('6. Profile & Password updates persist and enforce current password validation', async () => {
    const updProfile = await apiRequest(`/api/users/${customerId}/profile`, {
      method: 'PUT',
      token: customerToken,
      body: {
        name: 'Nguyễn Thị Đã Cập Nhật',
        email: TEST_CUSTOMER_EMAIL,
        phone: '0912 345 678',
        gender: 'Khác',
      },
    });
    assert.equal(updProfile.status, 200);
    assert.equal(updProfile.data.user.name, 'Nguyễn Thị Đã Cập Nhật');
    assert.equal(updProfile.data.user.gender, 'Khác');

    const getCheck = await apiRequest(`/api/users/${customerId}`, {
      token: customerToken,
    });
    assert.equal(getCheck.status, 200);
    assert.equal(getCheck.data.user.fullName, 'Nguyễn Thị Đã Cập Nhật');
    assert.equal(getCheck.data.user.gender, 'Khác');

    const badPass = await apiRequest(`/api/users/${customerId}/password`, {
      method: 'PUT',
      token: customerToken,
      body: {
        currentPassword: 'WrongCurrentPassword',
        newPassword: 'NewUserPass@456',
      },
    });
    assert.equal(badPass.status, 400);

    const goodPass = await apiRequest(`/api/users/${customerId}/password`, {
      method: 'PUT',
      token: customerToken,
      body: {
        currentPassword: 'UserPass@123',
        newPassword: 'NewUserPass@456',
      },
    });
    assert.equal(goodPass.status, 200);

    const authChangePass = await apiRequest('/api/auth/change-password', {
      method: 'PUT',
      token: customerToken,
      body: {
        currentPassword: 'NewUserPass@456',
        newPassword: 'FinalUserPass@789',
      },
    });
    assert.equal(authChangePass.status, 200);

    const relogin = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: {
        identifier: TEST_CUSTOMER_EMAIL,
        password: 'FinalUserPass@789',
      },
    });
    assert.equal(relogin.status, 200);
    customerToken = relogin.data.token;
  });

  it('7. POS phone lookup (GET /api/users/lookup-phone?phone=0909123456) prioritizes customer role', async () => {
    const { status, data } = await apiRequest(
      '/api/users/lookup-phone?phone=0909123456',
      { token: adminToken }
    );
    assert.equal(status, 200);
    assert.equal(data.found, true);
    assert.equal(data.user.role, 'customer');
  });

  it('8. Addresses CRUD promotes remaining address to default when default address is deleted', async () => {
    const addSecond = await apiRequest(`/api/users/${customerId}/addresses`, {
      method: 'POST',
      token: customerToken,
      body: {
        label: 'Văn phòng',
        recipient: 'Nguyễn Thị Đã Cập Nhật',
        phone: '0912345678',
        address: '99 Nguyễn Thị Minh Khai, Quận 3, TP.HCM',
        isDefault: true,
      },
    });
    assert.equal(addSecond.status, 201);
    assert.equal(addSecond.data.isDefault, true);
    const secondAddressId = addSecond.data.addressId;

    const listAfterAdd = await apiRequest(`/api/users/${customerId}/addresses`, {
      token: customerToken,
    });
    assert.equal(listAfterAdd.status, 200);
    assert.equal(listAfterAdd.data.length, 2);
    const firstAddr = listAfterAdd.data.find((a) => a.addressId === initialAddressId);
    const secondAddr = listAfterAdd.data.find((a) => a.addressId === secondAddressId);
    assert.equal(firstAddr.isDefault, false);
    assert.equal(secondAddr.isDefault, true);

    const delDefault = await apiRequest(
      `/api/users/${customerId}/addresses/${secondAddressId}`,
      {
        method: 'DELETE',
        token: customerToken,
      }
    );
    assert.equal(delDefault.status, 200);

    const listAfterDel = await apiRequest(`/api/users/${customerId}/addresses`, {
      token: customerToken,
    });
    assert.equal(listAfterDel.status, 200);
    assert.equal(listAfterDel.data.length, 1);
    assert.equal(listAfterDel.data[0].addressId, initialAddressId);
    assert.equal(listAfterDel.data[0].isDefault, true);

    const delMissing = await apiRequest(
      `/api/users/${customerId}/addresses/99999999`,
      {
        method: 'DELETE',
        token: customerToken,
      }
    );
    assert.equal(delMissing.status, 404);
  });

  it('9. Wishlist CRUD handles valid products, returns 404 on missing product, and removes cleanly', async () => {
    const addValid = await apiRequest(`/api/users/${customerId}/wishlist`, {
      method: 'POST',
      token: customerToken,
      body: { productId: 'prod-rc-mini' },
    });
    assert.equal(addValid.status, 201);
    assert.ok(addValid.data.wishlist.includes('prod-rc-mini'));

    const getWish = await apiRequest(`/api/users/${customerId}/wishlist`, {
      token: customerToken,
    });
    assert.equal(getWish.status, 200);
    assert.ok(getWish.data.productIds.includes('prod-rc-mini'));
    assert.equal(getWish.data.items.length, 1);
    assert.equal(getWish.data.items[0].id, 'prod-rc-mini');

    const addMissing = await apiRequest(`/api/users/${customerId}/wishlist`, {
      method: 'POST',
      token: customerToken,
      body: { productId: 'prod-does-not-exist-999' },
    });
    assert.equal(addMissing.status, 404);

    const removeValid = await apiRequest(
      `/api/users/${customerId}/wishlist/prod-rc-mini`,
      {
        method: 'DELETE',
        token: customerToken,
      }
    );
    assert.equal(removeValid.status, 200);

    const getEmpty = await apiRequest(`/api/users/${customerId}/wishlist`, {
      token: customerToken,
    });
    assert.equal(getEmpty.status, 200);
    assert.deepEqual(getEmpty.data.productIds, []);
    assert.deepEqual(getEmpty.data.items, []);
  });

  it('10. Admin User CRUD maps editor -> staff, preserves fields on partial PUT, blocks banned login (403), and blocks self-delete (400)', async () => {
    const createRes = await apiRequest('/api/users', {
      method: 'POST',
      token: adminToken,
      body: {
        username: 'e2e_editor_staff',
        fullName: 'Nhân Viên Biên Tập',
        email: TEST_ADMIN_CREATED_EMAIL,
        phone: '0933444555',
        password: 'StaffTemp@123',
        role: 'editor',
        gender: 'Nam',
      },
    });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.data.user.role, 'staff');
    assert.equal(createRes.data.data.role, 'staff');
    createdStaffUserId = createRes.data.user.userId;

    const partialPut = await apiRequest(`/api/users/${createdStaffUserId}`, {
      method: 'PUT',
      token: adminToken,
      body: {
        fullName: 'Nhân Viên Đã Sửa Tên',
      },
    });
    assert.equal(partialPut.status, 200);
    assert.equal(partialPut.data.user.fullName, 'Nhân Viên Đã Sửa Tên');
    assert.equal(partialPut.data.user.email, TEST_ADMIN_CREATED_EMAIL);
    assert.equal(partialPut.data.user.phone, '0933444555');
    assert.equal(partialPut.data.user.role, 'staff');

    const rolePatch = await apiRequest(`/api/users/${createdStaffUserId}/role`, {
      method: 'PATCH',
      token: adminToken,
      body: { role: 'customer' },
    });
    assert.equal(rolePatch.status, 200);
    assert.equal(rolePatch.data.user.role, 'customer');

    const banPatch = await apiRequest(`/api/users/${createdStaffUserId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'banned' },
    });
    assert.equal(banPatch.status, 200);
    assert.equal(banPatch.data.user.status, 'banned');

    const bannedLogin = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: {
        identifier: TEST_ADMIN_CREATED_EMAIL,
        password: 'StaffTemp@123',
      },
    });
    assert.equal(bannedLogin.status, 403);

    const selfDelete = await apiRequest(`/api/users/${adminUserId}`, {
      method: 'DELETE',
      token: adminToken,
    });
    assert.equal(selfDelete.status, 400);

    const deleteCreated = await apiRequest(`/api/users/${createdStaffUserId}`, {
      method: 'DELETE',
      token: adminToken,
    });
    assert.equal(deleteCreated.status, 200);
    createdStaffUserId = null;
  });

  it('11. Staff Roster & Staff Permissions CRUD works and restores defaults cleanly', async () => {
    const addStaff = await apiRequest('/api/staff-roster', {
      method: 'POST',
      token: adminToken,
      body: { staffName: TEMP_STAFF_NAME },
    });
    assert.equal(addStaff.status, 201);
    assert.ok(addStaff.data.staffRoster.includes(TEMP_STAFF_NAME));

    const getRoster = await apiRequest('/api/staff-roster');
    assert.equal(getRoster.status, 200);
    assert.ok(getRoster.data.staffRoster.includes(TEMP_STAFF_NAME));

    const delStaff = await apiRequest(
      `/api/staff-roster/${encodeURIComponent(TEMP_STAFF_NAME)}`,
      {
        method: 'DELETE',
        token: adminToken,
      }
    );
    assert.equal(delStaff.status, 200);
    assert.ok(!delStaff.data.staffRoster.includes(TEMP_STAFF_NAME));

    const getPerms = await apiRequest('/api/staff-permissions');
    assert.equal(getPerms.status, 200);
    assert.equal(getPerms.data.permissions.settings, false);

    const updatePerms = await apiRequest('/api/staff-permissions', {
      method: 'PUT',
      token: adminToken,
      body: {
        permissions: {
          ...DEFAULT_PERMS,
          analytics: true,
          settings: true,
        },
      },
    });
    assert.equal(updatePerms.status, 200);
    assert.equal(updatePerms.data.permissions.analytics, true);
    assert.equal(updatePerms.data.permissions.settings, false);

    const restorePerms = await apiRequest('/api/staff-permissions', {
      method: 'PUT',
      token: adminToken,
      body: { permissions: DEFAULT_PERMS },
    });
    assert.equal(restorePerms.status, 200);
    assert.equal(restorePerms.data.permissions.analytics, false);
  });

  it('12. GET /openapi.json returns 200 with bearerAuth and all User/Wishlist/Staff paths', async () => {
    const { status, data } = await apiRequest('/openapi.json');
    assert.equal(status, 200);
    assert.ok(data && data.paths);
    assert.ok(data.components?.securitySchemes?.bearerAuth);

    const requiredPaths = [
      '/auth/login',
      '/auth/register',
      '/auth/me',
      '/auth/change-password',
      '/users',
      '/users/lookup-phone',
      '/users/{id}',
      '/users/{id}/role',
      '/users/{id}/status',
      '/users/{id}/profile',
      '/users/{id}/password',
      '/user-addresses',
      '/users/{userId}/addresses',
      '/users/{userId}/addresses/{addressId}',
      '/users/{userId}/addresses/{addressId}/default',
      '/users/{userId}/wishlist',
      '/users/{userId}/wishlist/{productId}',
      '/staff-roster',
      '/staff-roster/{name}',
      '/staff-permissions',
    ];

    for (const p of requiredPaths) {
      assert.ok(data.paths[p], `Missing OpenAPI path: ${p}`);
    }
  });
});
