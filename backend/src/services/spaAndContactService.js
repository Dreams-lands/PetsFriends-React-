const { sql, poolPromise } = require('../../../api/db');
const {
  formatCurrency,
  formatIsoDateOnly,
  mapBookingRow,
  normalizePhoneDigits,
} = require('../utils/mappers');
const { AppError } = require('../services/userService');

const DEFAULT_STAFF_ROSTER = ['Linh Phạm', 'Hà Lê', 'Mai Nguyễn', 'An Trần'];
const VALID_BOOKING_STATUSES = ['upcoming', 'completed', 'cancelled'];
const VALID_CONTACT_STATUSES = ['new', 'replied', 'closed'];

function toCleanPhone(raw) {
  if (typeof normalizePhoneDigits === 'function') {
    return normalizePhoneDigits(raw);
  }
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length >= 11) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

function sqlNormalizedPhoneExpr(col = 'CustomerPhone') {
  const stripped = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(${col}, ''), '+84', '0'), ' ', ''), '.', ''), '-', ''), '(', ''), ')', '')`;
  return `CASE WHEN LEFT(${stripped}, 2) = '84' AND LEN(${stripped}) >= 11 THEN '0' + SUBSTRING(${stripped}, 3, 30) ELSE ${stripped} END`;
}

function isValidIsoDate(val) {
  const str = String(val || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [yyyy, mm, dd] = str.split('-').map(Number);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  const dt = new Date(Date.UTC(yyyy, mm - 1, dd));
  return (
    dt.getUTCFullYear() === yyyy &&
    dt.getUTCMonth() === mm - 1 &&
    dt.getUTCDate() === dd
  );
}

function getTodayIsoLocal() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function mapSpaPackageRow(pkg) {
  return {
    id: pkg.PackageId,
    packageId: pkg.PackageId,
    name: pkg.Name,
    desc: pkg.Description || '',
    description: pkg.Description || '',
    price: Number(pkg.Price || 0),
    priceStr:
      pkg.PackageId === 'pkg-4'
        ? `${formatCurrency(pkg.Price)} / ngày`
        : formatCurrency(pkg.Price),
    duration: pkg.DurationLabel,
    isPopular: pkg.PackageId === 'pkg-3',
  };
}

function mapContactMessageRow(row) {
  return {
    id: row.MessageId,
    messageId: row.MessageId,
    senderName: row.SenderName,
    senderPhone: row.SenderPhone,
    topic: row.Topic,
    message: row.Message,
    status: row.Status,
    createdAt: row.CreatedAt,
    MessageId: row.MessageId,
    SenderName: row.SenderName,
    SenderPhone: row.SenderPhone,
    Topic: row.Topic,
    Message: row.Message,
    Status: row.Status,
    CreatedAt: row.CreatedAt,
  };
}

// ============================================================================
// 1. Spa Packages (dbo.SpaPackages)
// ============================================================================

async function listSpaPackages() {
  const pool = await poolPromise;
  const result = await pool
    .request()
    .query('SELECT * FROM dbo.SpaPackages ORDER BY PackageId ASC');
  return result.recordset.map(mapSpaPackageRow);
}

async function getSpaPackageById(id) {
  const packageId = String(id || '').trim();
  if (!packageId) {
    throw new AppError('Mã gói dịch vụ Spa không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const result = await pool
    .request()
    .input('packageId', sql.NVarChar(30), packageId)
    .query('SELECT * FROM dbo.SpaPackages WHERE PackageId = @packageId');

  if (result.recordset.length === 0) {
    throw new AppError('Không tìm thấy gói dịch vụ Spa.', 404);
  }

  return mapSpaPackageRow(result.recordset[0]);
}

async function createSpaPackage(body = {}) {
  const name = String(body.name || '').trim();
  const durationLabel = String(body.duration ?? body.durationLabel ?? '').trim();
  const rawPrice = body.price !== undefined ? body.price : body.priceNum;

  if (!name) {
    throw new AppError('Vui lòng nhập tên gói dịch vụ Spa.', 400);
  }
  if (rawPrice === undefined || rawPrice === null || String(rawPrice).trim() === '') {
    throw new AppError('Vui lòng nhập giá gói dịch vụ Spa.', 400);
  }
  const price = Number(rawPrice);
  if (!Number.isFinite(price) || price < 0) {
    throw new AppError('Giá gói dịch vụ Spa phải là số không âm.', 400);
  }
  if (!durationLabel) {
    throw new AppError('Vui lòng nhập thời lượng gói dịch vụ Spa.', 400);
  }

  const packageId = String(
    body.id || body.packageId || `pkg-${Date.now().toString().slice(-5)}`
  ).trim();
  if (!packageId || packageId.length > 30) {
    throw new AppError('Mã gói dịch vụ Spa không hợp lệ (tối đa 30 ký tự).', 400);
  }

  const rawDesc = body.description !== undefined ? body.description : body.desc;
  const description =
    rawDesc !== undefined && rawDesc !== null && String(rawDesc).trim() !== ''
      ? String(rawDesc).trim().slice(0, 400)
      : null;

  const pool = await poolPromise;
  const dupCheck = await pool
    .request()
    .input('packageId', sql.NVarChar(30), packageId)
    .query('SELECT PackageId FROM dbo.SpaPackages WHERE PackageId = @packageId');

  if (dupCheck.recordset.length > 0) {
    throw new AppError('Mã gói dịch vụ Spa đã tồn tại.', 409);
  }

  const insertRes = await pool
    .request()
    .input('packageId', sql.NVarChar(30), packageId)
    .input('name', sql.NVarChar(150), name.slice(0, 150))
    .input('description', sql.NVarChar(400), description)
    .input('price', sql.Decimal(18, 0), Math.round(price))
    .input('durationLabel', sql.NVarChar(50), durationLabel.slice(0, 50))
    .query(`
      INSERT INTO dbo.SpaPackages (PackageId, Name, Description, Price, DurationLabel)
      OUTPUT INSERTED.*
      VALUES (@packageId, @name, @description, @price, @durationLabel)
    `);

  return mapSpaPackageRow(insertRes.recordset[0]);
}

async function updateSpaPackage(id, body = {}) {
  const packageId = String(id || '').trim();
  if (!packageId) {
    throw new AppError('Mã gói dịch vụ Spa không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const existingRes = await pool
    .request()
    .input('packageId', sql.NVarChar(30), packageId)
    .query('SELECT * FROM dbo.SpaPackages WHERE PackageId = @packageId');

  if (existingRes.recordset.length === 0) {
    throw new AppError('Không tìm thấy gói dịch vụ Spa.', 404);
  }

  const existing = existingRes.recordset[0];

  const mergedName =
    body.name !== undefined ? String(body.name || '').trim() : existing.Name;
  if (!mergedName) {
    throw new AppError('Tên gói dịch vụ Spa không được để trống.', 400);
  }

  let mergedDescription = existing.Description;
  if (body.description !== undefined || body.desc !== undefined) {
    const rawDesc = body.description !== undefined ? body.description : body.desc;
    mergedDescription =
      rawDesc === null || String(rawDesc).trim() === ''
        ? null
        : String(rawDesc).trim().slice(0, 400);
  }

  let mergedPrice = Number(existing.Price || 0);
  const rawPrice = body.price !== undefined ? body.price : body.priceNum;
  if (rawPrice !== undefined) {
    if (rawPrice === null || String(rawPrice).trim() === '') {
      throw new AppError('Giá gói dịch vụ Spa không hợp lệ.', 400);
    }
    const parsedPrice = Number(rawPrice);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      throw new AppError('Giá gói dịch vụ Spa phải là số không âm.', 400);
    }
    mergedPrice = parsedPrice;
  }

  let mergedDuration = existing.DurationLabel;
  if (body.duration !== undefined || body.durationLabel !== undefined) {
    const rawDur = body.duration !== undefined ? body.duration : body.durationLabel;
    mergedDuration = String(rawDur ?? '').trim();
    if (!mergedDuration) {
      throw new AppError('Thời lượng gói dịch vụ Spa không được để trống.', 400);
    }
  }

  const updateRes = await pool
    .request()
    .input('packageId', sql.NVarChar(30), packageId)
    .input('name', sql.NVarChar(150), mergedName.slice(0, 150))
    .input('description', sql.NVarChar(400), mergedDescription)
    .input('price', sql.Decimal(18, 0), Math.round(mergedPrice))
    .input('durationLabel', sql.NVarChar(50), mergedDuration.slice(0, 50))
    .query(`
      UPDATE dbo.SpaPackages
      SET Name = @name,
          Description = @description,
          Price = @price,
          DurationLabel = @durationLabel
      OUTPUT INSERTED.*
      WHERE PackageId = @packageId
    `);

  return mapSpaPackageRow(updateRes.recordset[0]);
}

async function deleteSpaPackage(id) {
  const packageId = String(id || '').trim();
  if (!packageId) {
    throw new AppError('Mã gói dịch vụ Spa không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const delRes = await pool
    .request()
    .input('packageId', sql.NVarChar(30), packageId)
    .query('DELETE FROM dbo.SpaPackages WHERE PackageId = @packageId');

  if (!delRes.rowsAffected || delRes.rowsAffected[0] === 0) {
    throw new AppError('Không tìm thấy gói dịch vụ Spa.', 404);
  }

  return { deleted: true };
}

// ============================================================================
// 2. Service Bookings (dbo.ServiceBookings)
// ============================================================================

async function findBookingRowByIdOrCode(pool, idOrCode) {
  const cleanCode = String(idOrCode || '')
    .trim()
    .replace(/^#/, '');
  if (!cleanCode) {
    return null;
  }

  const res = await pool
    .request()
    .input('code', sql.NVarChar(50), cleanCode)
    .query(`
      SELECT TOP 1 *
      FROM dbo.ServiceBookings
      WHERE BookingCode = @code OR BookingId = TRY_CAST(@code AS INT)
    `);

  return res.recordset[0] || null;
}

async function listServiceBookings(queryParams = {}) {
  const {
    userId,
    phone,
    status,
    staffName,
    date,
    fromDate,
    toDate,
    search,
  } = queryParams;

  const pool = await poolPromise;
  const request = pool.request();
  let query = 'SELECT * FROM dbo.ServiceBookings WHERE 1=1';

  if (userId !== undefined && userId !== null && String(userId).trim() !== '') {
    const uid = Number(userId);
    if (Number.isNaN(uid)) {
      throw new AppError('Mã người dùng không hợp lệ.', 400);
    }
    query += ' AND UserId = @userId';
    request.input('userId', sql.Int, uid);
  }

  if (phone !== undefined && phone !== null && String(phone).trim() !== '') {
    const cleanPhone = toCleanPhone(phone);
    query += ` AND ${sqlNormalizedPhoneExpr('CustomerPhone')} = @cleanPhone`;
    request.input('cleanPhone', sql.NVarChar(30), cleanPhone || '__NONE__');
  }

  if (status && String(status).trim() !== '' && String(status).trim() !== 'all') {
    query += ' AND Status = @status';
    request.input('status', sql.NVarChar(20), String(status).trim());
  }

  if (staffName && String(staffName).trim() !== '' && String(staffName).trim() !== 'all') {
    query += ' AND StaffName = @staffName';
    request.input('staffName', sql.NVarChar(120), String(staffName).trim());
  }

  if (date && String(date).trim() !== '') {
    const dateStr = String(date).trim();
    if (!isValidIsoDate(dateStr)) {
      throw new AppError('Định dạng ngày lọc không hợp lệ (YYYY-MM-DD).', 400);
    }
    query += ' AND BookingDate = CAST(@date AS DATE)';
    request.input('date', sql.VarChar(10), dateStr);
  }

  if (fromDate && String(fromDate).trim() !== '') {
    const fromStr = String(fromDate).trim();
    if (!isValidIsoDate(fromStr)) {
      throw new AppError('Định dạng từ ngày không hợp lệ (YYYY-MM-DD).', 400);
    }
    query += ' AND BookingDate >= CAST(@fromDate AS DATE)';
    request.input('fromDate', sql.VarChar(10), fromStr);
  }

  if (toDate && String(toDate).trim() !== '') {
    const toStr = String(toDate).trim();
    if (!isValidIsoDate(toStr)) {
      throw new AppError('Định dạng đến ngày không hợp lệ (YYYY-MM-DD).', 400);
    }
    query += ' AND BookingDate <= CAST(@toDate AS DATE)';
    request.input('toDate', sql.VarChar(10), toStr);
  }

  if (search && String(search).trim() !== '') {
    const q = String(search).trim();
    const qDigits = toCleanPhone(q);
    request.input('searchLike', sql.NVarChar(160), `%${q}%`);
    if (qDigits) {
      request.input('phoneLike', sql.NVarChar(40), `%${qDigits}%`);
      query += ` AND (
        BookingCode LIKE @searchLike
        OR CustomerName LIKE @searchLike
        OR PetNameOrType LIKE @searchLike
        OR ServiceName LIKE @searchLike
        OR CustomerPhone LIKE @searchLike
        OR ${sqlNormalizedPhoneExpr('CustomerPhone')} LIKE @phoneLike
      )`;
    } else {
      query += ` AND (
        BookingCode LIKE @searchLike
        OR CustomerName LIKE @searchLike
        OR PetNameOrType LIKE @searchLike
        OR ServiceName LIKE @searchLike
        OR CustomerPhone LIKE @searchLike
      )`;
    }
  }

  query += ' ORDER BY BookingDate DESC, CreatedAt DESC, BookingId DESC';
  const result = await request.query(query);
  return result.recordset.map(mapBookingRow);
}

async function lookupServiceBooking({ phone, bookingCode, code } = {}) {
  const cleanPhone = toCleanPhone(phone);
  const cleanCode = String(bookingCode || code || '')
    .trim()
    .replace(/^#/, '')
    .toUpperCase();

  if (!cleanPhone || !cleanCode) {
    throw new AppError(
      'Vui lòng cung cấp số điện thoại và mã lịch hẹn để tra cứu.',
      400
    );
  }

  const pool = await poolPromise;
  const result = await pool
    .request()
    .input('cleanCode', sql.NVarChar(30), cleanCode)
    .input('cleanPhone', sql.NVarChar(30), cleanPhone)
    .query(`
      SELECT TOP 1 *
      FROM dbo.ServiceBookings
      WHERE UPPER(BookingCode) = @cleanCode
        AND ${sqlNormalizedPhoneExpr('CustomerPhone')} = @cleanPhone
    `);

  if (result.recordset.length === 0) {
    throw new AppError('Không tìm thấy lịch hẹn khớp với thông tin tra cứu.', 404);
  }

  return mapBookingRow(result.recordset[0]);
}

async function getServiceBookingById(id) {
  const pool = await poolPromise;
  const row = await findBookingRowByIdOrCode(pool, id);
  if (!row) {
    throw new AppError('Không tìm thấy lịch hẹn.', 404);
  }
  return mapBookingRow(row);
}

async function pickAvailableStaff(pool, bookingDate, timeSlot) {
  let roster = DEFAULT_STAFF_ROSTER;
  try {
    const rosterRes = await pool
      .request()
      .query('SELECT StaffName FROM dbo.StaffRoster ORDER BY StaffId ASC');
    const names = rosterRes.recordset
      .map((r) => String(r.StaffName || '').trim())
      .filter(Boolean);
    if (names.length > 0) {
      roster = names;
    }
  } catch (_) {
    roster = DEFAULT_STAFF_ROSTER;
  }

  const busyRes = await pool
    .request()
    .input('bookingDate', sql.VarChar(10), bookingDate)
    .input('timeSlot', sql.NVarChar(40), timeSlot)
    .query(`
      SELECT DISTINCT StaffName
      FROM dbo.ServiceBookings
      WHERE BookingDate = CAST(@bookingDate AS DATE)
        AND LOWER(LTRIM(RTRIM(TimeSlot))) = LOWER(LTRIM(RTRIM(@timeSlot)))
        AND Status = N'upcoming'
        AND StaffName IS NOT NULL
    `);

  const busyLower = new Set(
    busyRes.recordset.map((r) => String(r.StaffName || '').trim().toLowerCase())
  );
  const available = roster.find((name) => !busyLower.has(name.toLowerCase()));
  return available || roster[0] || 'Linh Phạm';
}

async function createServiceBooking(body = {}, reqUser = null) {
  const rawPhone = String(body.customerPhone ?? body.phone ?? '').trim();
  const cleanPhone = toCleanPhone(rawPhone);
  if (!rawPhone || cleanPhone.length < 8) {
    throw new AppError(
      'Vui lòng cung cấp số điện thoại liên hệ hợp lệ (tối thiểu 8 chữ số).',
      400
    );
  }
  const customerPhone = rawPhone.length > 20 ? cleanPhone.slice(0, 20) : rawPhone;

  const bookingDate = String(
    body.date || body.bookingDate || getTodayIsoLocal()
  ).trim();
  if (!isValidIsoDate(bookingDate)) {
    throw new AppError(
      'Ngày đặt lịch không hợp lệ (định dạng chuẩn YYYY-MM-DD).',
      400
    );
  }

  const pool = await poolPromise;

  let validPackageId = null;
  let matchedPkg = null;
  if (body.packageId !== undefined && body.packageId !== null && String(body.packageId).trim() !== '') {
    const pkgId = String(body.packageId).trim();
    const pkgRes = await pool
      .request()
      .input('pkgId', sql.NVarChar(30), pkgId)
      .query('SELECT * FROM dbo.SpaPackages WHERE PackageId = @pkgId');
    if (pkgRes.recordset.length > 0) {
      matchedPkg = pkgRes.recordset[0];
      validPackageId = matchedPkg.PackageId;
    }
  }

  const rawServiceName = String(body.serviceName || '').trim();
  const serviceName = rawServiceName || (matchedPkg ? String(matchedPkg.Name || '').trim() : '');
  if (!serviceName) {
    throw new AppError('Vui lòng cung cấp gói dịch vụ chăm sóc.', 400);
  }

  let price;
  if (body.price === undefined || body.price === null || String(body.price).trim() === '') {
    price = matchedPkg ? Number(matchedPkg.Price || 0) : 0;
  } else {
    price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new AppError('Giá dịch vụ không hợp lệ (phải là số không âm).', 400);
    }
  }

  const explicitCode = String(body.id || body.bookingCode || '')
    .trim()
    .replace(/^#/, '');
  let bookingCode = explicitCode;

  if (explicitCode) {
    if (explicitCode.length > 20) {
      throw new AppError('Mã lịch hẹn không được vượt quá 20 ký tự.', 400);
    }
    const dupRes = await pool
      .request()
      .input('code', sql.NVarChar(20), explicitCode)
      .query('SELECT BookingId FROM dbo.ServiceBookings WHERE UPPER(BookingCode) = UPPER(@code)');
    if (dupRes.recordset.length > 0) {
      throw new AppError('Mã lịch hẹn đã tồn tại.', 409);
    }
  } else {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = `BK${Math.floor(100000 + Math.random() * 899999)}`;
      const dupRes = await pool
        .request()
        .input('code', sql.NVarChar(20), candidate)
        .query('SELECT BookingId FROM dbo.ServiceBookings WHERE BookingCode = @code');
      if (dupRes.recordset.length === 0) {
        bookingCode = candidate;
        break;
      }
    }
    if (!bookingCode) {
      bookingCode = `BK${Date.now().toString().slice(-6)}`;
    }
  }

  let resolvedUserId = null;
  if (body.userId !== undefined && body.userId !== null && String(body.userId).trim() !== '') {
    const parsedUid = Number(body.userId);
    if (!Number.isNaN(parsedUid) && parsedUid > 0) {
      const uRes = await pool
        .request()
        .input('uid', sql.Int, parsedUid)
        .query('SELECT UserId FROM dbo.Users WHERE UserId = @uid');
      if (uRes.recordset.length > 0) {
        resolvedUserId = parsedUid;
      }
    }
  } else if (reqUser && reqUser.role === 'customer' && reqUser.userId) {
    const parsedUid = Number(reqUser.userId);
    if (!Number.isNaN(parsedUid) && parsedUid > 0) {
      resolvedUserId = parsedUid;
    }
  }

  const petNameOrType = String(body.petName || body.petNameOrType || 'Thú cưng')
    .trim()
    .slice(0, 120) || 'Thú cưng';
  const timeSlot = String(body.timeSlot || '10:30 Sáng')
    .trim()
    .slice(0, 40) || '10:30 Sáng';
  const customerName = String(body.customerName || 'Khách PetsFriend')
    .trim()
    .slice(0, 120) || 'Khách PetsFriend';
  const note =
    body.note !== undefined && body.note !== null && String(body.note).trim() !== ''
      ? String(body.note).trim().slice(0, 400)
      : null;

  const explicitStaff =
    body.staffName !== undefined && body.staffName !== null
      ? String(body.staffName).trim()
      : '';
  const staffName = explicitStaff
    ? explicitStaff.slice(0, 120)
    : (await pickAvailableStaff(pool, bookingDate, timeSlot)).slice(0, 120);

  const insertRes = await pool
    .request()
    .input('bookingCode', sql.NVarChar(20), bookingCode)
    .input('userId', sql.Int, resolvedUserId)
    .input('packageId', sql.NVarChar(30), validPackageId)
    .input('serviceName', sql.NVarChar(150), serviceName.slice(0, 150))
    .input('petNameOrType', sql.NVarChar(120), petNameOrType)
    .input('bookingDate', sql.VarChar(10), bookingDate)
    .input('timeSlot', sql.NVarChar(40), timeSlot)
    .input('price', sql.Decimal(18, 0), Math.round(price))
    .input('customerName', sql.NVarChar(120), customerName)
    .input('customerPhone', sql.NVarChar(20), customerPhone)
    .input('staffName', sql.NVarChar(120), staffName)
    .input('note', sql.NVarChar(400), note)
    .query(`
      INSERT INTO dbo.ServiceBookings (
        BookingCode, UserId, PackageId, ServiceName, PetNameOrType,
        BookingDate, TimeSlot, Price, Status, CustomerName, CustomerPhone, StaffName, Note
      )
      OUTPUT INSERTED.*
      VALUES (
        @bookingCode, @userId, @packageId, @serviceName, @petNameOrType,
        CAST(@bookingDate AS DATE), @timeSlot, @price, N'upcoming', @customerName, @customerPhone, @staffName, @note
      )
    `);

  return mapBookingRow(insertRes.recordset[0]);
}

async function updateServiceBooking(id, body = {}) {
  const pool = await poolPromise;
  const existing = await findBookingRowByIdOrCode(pool, id);
  if (!existing) {
    throw new AppError('Không tìm thấy lịch hẹn.', 404);
  }

  let mergedStatus = existing.Status;
  if (body.status !== undefined && body.status !== null) {
    const nextStatus = String(body.status).trim();
    if (!VALID_BOOKING_STATUSES.includes(nextStatus)) {
      throw new AppError('Trạng thái lịch hẹn không hợp lệ.', 400);
    }
    mergedStatus = nextStatus;
  }

  let mergedStaffName = existing.StaffName;
  if (body.staffName !== undefined) {
    mergedStaffName =
      body.staffName === null || String(body.staffName).trim() === ''
        ? null
        : String(body.staffName).trim().slice(0, 120);
  }

  let mergedBookingDate = formatIsoDateOnly(existing.BookingDate);
  const rawDate = body.bookingDate !== undefined ? body.bookingDate : body.date;
  if (rawDate !== undefined) {
    const nextDate = String(rawDate || '').trim();
    if (!isValidIsoDate(nextDate)) {
      throw new AppError('Ngày đặt lịch không hợp lệ (YYYY-MM-DD).', 400);
    }
    mergedBookingDate = nextDate;
  }

  let mergedTimeSlot = existing.TimeSlot;
  if (body.timeSlot !== undefined) {
    const nextSlot = String(body.timeSlot || '').trim();
    if (!nextSlot) {
      throw new AppError('Khung giờ hẹn không được để trống.', 400);
    }
    mergedTimeSlot = nextSlot.slice(0, 40);
  }

  let mergedPetName = existing.PetNameOrType;
  const rawPet = body.petNameOrType !== undefined ? body.petNameOrType : body.petName;
  if (rawPet !== undefined) {
    const nextPet = String(rawPet || '').trim();
    if (!nextPet) {
      throw new AppError('Tên hoặc loại thú cưng không được để trống.', 400);
    }
    mergedPetName = nextPet.slice(0, 120);
  }

  let mergedServiceName = existing.ServiceName;
  if (body.serviceName !== undefined) {
    const nextService = String(body.serviceName || '').trim();
    if (!nextService) {
      throw new AppError('Tên dịch vụ không được để trống.', 400);
    }
    mergedServiceName = nextService.slice(0, 150);
  }

  let mergedPrice = Number(existing.Price || 0);
  if (body.price !== undefined) {
    if (body.price === null || String(body.price).trim() === '') {
      throw new AppError('Giá dịch vụ không hợp lệ.', 400);
    }
    const parsedPrice = Number(body.price);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      throw new AppError('Giá dịch vụ phải là số không âm.', 400);
    }
    mergedPrice = parsedPrice;
  }

  let mergedCustomerName = existing.CustomerName;
  if (body.customerName !== undefined) {
    const nextCustName = String(body.customerName || '').trim();
    if (!nextCustName) {
      throw new AppError('Tên khách hàng không được để trống.', 400);
    }
    mergedCustomerName = nextCustName.slice(0, 120);
  }

  let mergedCustomerPhone = existing.CustomerPhone;
  if (body.customerPhone !== undefined) {
    const rawPhone = String(body.customerPhone || '').trim();
    const cleanPhone = toCleanPhone(rawPhone);
    if (cleanPhone.length < 8) {
      throw new AppError('Số điện thoại liên hệ không hợp lệ.', 400);
    }
    mergedCustomerPhone = rawPhone.length > 20 ? cleanPhone.slice(0, 20) : rawPhone;
  }

  let mergedNote = existing.Note;
  if (body.note !== undefined) {
    mergedNote =
      body.note === null || String(body.note).trim() === ''
        ? null
        : String(body.note).trim().slice(0, 400);
  }

  const updateRes = await pool
    .request()
    .input('bookingId', sql.Int, existing.BookingId)
    .input('status', sql.NVarChar(20), mergedStatus)
    .input('staffName', sql.NVarChar(120), mergedStaffName)
    .input('bookingDate', sql.VarChar(10), mergedBookingDate)
    .input('timeSlot', sql.NVarChar(40), mergedTimeSlot)
    .input('petNameOrType', sql.NVarChar(120), mergedPetName)
    .input('serviceName', sql.NVarChar(150), mergedServiceName)
    .input('price', sql.Decimal(18, 0), Math.round(mergedPrice))
    .input('customerName', sql.NVarChar(120), mergedCustomerName)
    .input('customerPhone', sql.NVarChar(20), mergedCustomerPhone)
    .input('note', sql.NVarChar(400), mergedNote)
    .query(`
      UPDATE dbo.ServiceBookings
      SET Status = @status,
          StaffName = @staffName,
          BookingDate = CAST(@bookingDate AS DATE),
          TimeSlot = @timeSlot,
          PetNameOrType = @petNameOrType,
          ServiceName = @serviceName,
          Price = @price,
          CustomerName = @customerName,
          CustomerPhone = @customerPhone,
          Note = @note
      OUTPUT INSERTED.*
      WHERE BookingId = @bookingId
    `);

  return mapBookingRow(updateRes.recordset[0]);
}

async function cancelServiceBooking(id, { reqUser = null, phone = '' } = {}) {
  const pool = await poolPromise;
  const existing = await findBookingRowByIdOrCode(pool, id);
  if (!existing) {
    throw new AppError('Không tìm thấy lịch hẹn.', 404);
  }

  if (existing.Status === 'cancelled') {
    return {
      alreadyCancelled: true,
      booking: mapBookingRow(existing),
    };
  }

  const isStaffOrAdmin = Boolean(
    reqUser && (reqUser.role === 'admin' || reqUser.role === 'staff')
  );

  if (!isStaffOrAdmin) {
    if (existing.Status !== 'upcoming') {
      throw new AppError('Chỉ có thể hủy lịch hẹn sắp tới.', 400);
    }

    const ownsByUser = Boolean(
      reqUser &&
        existing.UserId !== null &&
        existing.UserId !== undefined &&
        Number(existing.UserId) === Number(reqUser.userId)
    );
    const cleanInputPhone = toCleanPhone(phone);
    const cleanBookingPhone = toCleanPhone(existing.CustomerPhone);
    const ownsByPhone = Boolean(
      cleanInputPhone && cleanBookingPhone && cleanInputPhone === cleanBookingPhone
    );

    if (!ownsByUser && !ownsByPhone) {
      throw new AppError('Bạn không có quyền hủy lịch hẹn này.', 403);
    }
  }

  const updateRes = await pool
    .request()
    .input('bookingId', sql.Int, existing.BookingId)
    .query(`
      UPDATE dbo.ServiceBookings
      SET Status = N'cancelled'
      OUTPUT INSERTED.*
      WHERE BookingId = @bookingId
    `);

  return {
    alreadyCancelled: false,
    booking: mapBookingRow(updateRes.recordset[0]),
  };
}

async function deleteServiceBooking(id) {
  const cleanCode = String(id || '')
    .trim()
    .replace(/^#/, '');
  if (!cleanCode) {
    throw new AppError('Mã lịch hẹn không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const delRes = await pool
    .request()
    .input('code', sql.NVarChar(50), cleanCode)
    .query(`
      DELETE FROM dbo.ServiceBookings
      WHERE BookingCode = @code OR BookingId = TRY_CAST(@code AS INT)
    `);

  if (!delRes.rowsAffected || delRes.rowsAffected[0] === 0) {
    throw new AppError('Không tìm thấy lịch hẹn.', 404);
  }

  return { deleted: true };
}

// ============================================================================
// 3. Contact Messages (dbo.ContactMessages)
// ============================================================================

async function listContactMessages({ status, search } = {}) {
  const pool = await poolPromise;
  const request = pool.request();
  let query = 'SELECT * FROM dbo.ContactMessages WHERE 1=1';

  if (status && String(status).trim() !== '' && String(status).trim() !== 'all') {
    query += ' AND Status = @status';
    request.input('status', sql.NVarChar(20), String(status).trim());
  }

  if (search && String(search).trim() !== '') {
    const q = String(search).trim();
    const qDigits = toCleanPhone(q);
    request.input('searchLike', sql.NVarChar(200), `%${q}%`);
    if (qDigits) {
      request.input('phoneLike', sql.NVarChar(40), `%${qDigits}%`);
      query += ` AND (
        SenderName LIKE @searchLike
        OR SenderPhone LIKE @searchLike
        OR Topic LIKE @searchLike
        OR Message LIKE @searchLike
        OR ${sqlNormalizedPhoneExpr('SenderPhone')} LIKE @phoneLike
      )`;
    } else {
      query += ` AND (
        SenderName LIKE @searchLike
        OR SenderPhone LIKE @searchLike
        OR Topic LIKE @searchLike
        OR Message LIKE @searchLike
      )`;
    }
  }

  query += ' ORDER BY CreatedAt DESC, MessageId DESC';
  const result = await request.query(query);
  return result.recordset.map(mapContactMessageRow);
}

async function getContactMessageById(id) {
  const messageId = Number(id);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    throw new AppError('Mã tin nhắn liên hệ không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const result = await pool
    .request()
    .input('id', sql.Int, messageId)
    .query('SELECT * FROM dbo.ContactMessages WHERE MessageId = @id');

  if (result.recordset.length === 0) {
    throw new AppError('Không tìm thấy tin nhắn liên hệ.', 404);
  }

  return mapContactMessageRow(result.recordset[0]);
}

async function createContactMessage(body = {}) {
  const finalName = String(body.senderName || body.name || '').trim();
  const rawPhone = String(body.senderPhone || body.phone || '').trim();
  const cleanPhone = toCleanPhone(rawPhone);
  const finalTopic =
    String(body.topic || 'Tư vấn sản phẩm & dinh dưỡng').trim() ||
    'Tư vấn sản phẩm & dinh dưỡng';
  const finalMsg = String(body.message || '').trim();

  if (!finalName || !rawPhone || !finalMsg) {
    throw new AppError(
      'Vui lòng điền đầy đủ họ tên, số điện thoại và nội dung lời nhắn.',
      400
    );
  }
  if (cleanPhone.length < 8) {
    throw new AppError(
      'Số điện thoại liên hệ không hợp lệ (tối thiểu 8 chữ số).',
      400
    );
  }

  const senderPhone = rawPhone.length > 20 ? cleanPhone.slice(0, 20) : rawPhone;

  const pool = await poolPromise;
  const result = await pool
    .request()
    .input('senderName', sql.NVarChar(120), finalName.slice(0, 120))
    .input('senderPhone', sql.NVarChar(20), senderPhone)
    .input('topic', sql.NVarChar(150), finalTopic.slice(0, 150))
    .input('message', sql.NVarChar(1000), finalMsg.slice(0, 1000))
    .query(`
      INSERT INTO dbo.ContactMessages (SenderName, SenderPhone, Topic, Message)
      OUTPUT INSERTED.*
      VALUES (@senderName, @senderPhone, @topic, @message)
    `);

  return mapContactMessageRow(result.recordset[0]);
}

async function updateContactMessageStatus(id, status) {
  const messageId = Number(id);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    throw new AppError('Mã tin nhắn liên hệ không hợp lệ.', 400);
  }

  const nextStatus = String(status || '').trim();
  if (!VALID_CONTACT_STATUSES.includes(nextStatus)) {
    throw new AppError('Trạng thái tin nhắn không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const result = await pool
    .request()
    .input('id', sql.Int, messageId)
    .input('status', sql.NVarChar(20), nextStatus)
    .query(`
      UPDATE dbo.ContactMessages
      SET Status = @status
      OUTPUT INSERTED.*
      WHERE MessageId = @id
    `);

  if (result.recordset.length === 0) {
    throw new AppError('Không tìm thấy tin nhắn liên hệ.', 404);
  }

  return mapContactMessageRow(result.recordset[0]);
}

async function deleteContactMessage(id) {
  const messageId = Number(id);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    throw new AppError('Mã tin nhắn liên hệ không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const delRes = await pool
    .request()
    .input('id', sql.Int, messageId)
    .query('DELETE FROM dbo.ContactMessages WHERE MessageId = @id');

  if (!delRes.rowsAffected || delRes.rowsAffected[0] === 0) {
    throw new AppError('Không tìm thấy tin nhắn liên hệ.', 404);
  }

  return { deleted: true };
}

module.exports = {
  mapSpaPackageRow,
  mapContactMessageRow,
  listSpaPackages,
  getSpaPackageById,
  createSpaPackage,
  updateSpaPackage,
  deleteSpaPackage,
  listServiceBookings,
  lookupServiceBooking,
  getServiceBookingById,
  createServiceBooking,
  updateServiceBooking,
  cancelServiceBooking,
  deleteServiceBooking,
  listContactMessages,
  getContactMessageById,
  createContactMessage,
  updateContactMessageStatus,
  deleteContactMessage,
};
