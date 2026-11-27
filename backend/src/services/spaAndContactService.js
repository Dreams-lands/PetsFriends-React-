const { poolPromise } = require('../../../api/db');
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
  const stripped = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(${col}, ''), '+84', '0'), ' ', ''), '.', ''), '-', ''), '(', ''), ')', '')`;
  return `(CASE WHEN LEFT(${stripped}, 2) = '84' AND CHAR_LENGTH(${stripped}) >= 11 THEN CONCAT('0', SUBSTRING(${stripped}, 3, 30)) ELSE ${stripped} END)`;
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
// 1. Spa Packages (SpaPackages)
// ============================================================================

async function listSpaPackages() {
  const pool = await poolPromise;
  const [rows] = await pool.query('SELECT * FROM SpaPackages ORDER BY PackageId ASC');
  return rows.map(mapSpaPackageRow);
}

async function getSpaPackageById(id) {
  const packageId = String(id || '').trim();
  if (!packageId) {
    throw new AppError('Mã gói dịch vụ Spa không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const [rows] = await pool.query(
    'SELECT * FROM SpaPackages WHERE PackageId = ?',
    [packageId]
  );

  if (rows.length === 0) {
    throw new AppError('Không tìm thấy gói dịch vụ Spa.', 404);
  }

  return mapSpaPackageRow(rows[0]);
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
  const [dupCheck] = await pool.query(
    'SELECT PackageId FROM SpaPackages WHERE PackageId = ?',
    [packageId]
  );

  if (dupCheck.length > 0) {
    throw new AppError('Mã gói dịch vụ Spa đã tồn tại.', 409);
  }

  await pool.query(
    `
      INSERT INTO SpaPackages (PackageId, Name, Description, Price, DurationLabel)
      VALUES (?, ?, ?, ?, ?)
    `,
    [
      packageId,
      name.slice(0, 150),
      description,
      Math.round(price),
      durationLabel.slice(0, 50),
    ]
  );

  const [rows] = await pool.query(
    'SELECT * FROM SpaPackages WHERE PackageId = ?',
    [packageId]
  );
  return mapSpaPackageRow(rows[0]);
}

async function updateSpaPackage(id, body = {}) {
  const packageId = String(id || '').trim();
  if (!packageId) {
    throw new AppError('Mã gói dịch vụ Spa không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const [existingRows] = await pool.query(
    'SELECT * FROM SpaPackages WHERE PackageId = ?',
    [packageId]
  );

  if (existingRows.length === 0) {
    throw new AppError('Không tìm thấy gói dịch vụ Spa.', 404);
  }

  const existing = existingRows[0];

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

  await pool.query(
    `
      UPDATE SpaPackages
      SET Name = ?,
          Description = ?,
          Price = ?,
          DurationLabel = ?
      WHERE PackageId = ?
    `,
    [
      mergedName.slice(0, 150),
      mergedDescription,
      Math.round(mergedPrice),
      mergedDuration.slice(0, 50),
      packageId,
    ]
  );

  const [updatedRows] = await pool.query(
    'SELECT * FROM SpaPackages WHERE PackageId = ?',
    [packageId]
  );
  return mapSpaPackageRow(updatedRows[0]);
}

async function deleteSpaPackage(id) {
  const packageId = String(id || '').trim();
  if (!packageId) {
    throw new AppError('Mã gói dịch vụ Spa không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const [delRes] = await pool.query(
    'DELETE FROM SpaPackages WHERE PackageId = ?',
    [packageId]
  );

  if (!delRes.affectedRows) {
    throw new AppError('Không tìm thấy gói dịch vụ Spa.', 404);
  }

  return { deleted: true };
}

// ============================================================================
// 2. Service Bookings (ServiceBookings)
// ============================================================================

async function findBookingRowByIdOrCode(pool, idOrCode) {
  const cleanCode = String(idOrCode || '')
    .trim()
    .replace(/^#/, '');
  if (!cleanCode) {
    return null;
  }

  const numericId = /^\d+$/.test(cleanCode) ? Number(cleanCode) : -1;
  const [rows] = await pool.query(
    `
      SELECT *
      FROM ServiceBookings
      WHERE BookingCode = ? OR BookingId = ?
      LIMIT 1
    `,
    [cleanCode, numericId]
  );

  return rows[0] || null;
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
  let query = 'SELECT * FROM ServiceBookings WHERE 1=1';
  const params = [];

  if (userId !== undefined && userId !== null && String(userId).trim() !== '') {
    const uid = Number(userId);
    if (Number.isNaN(uid)) {
      throw new AppError('Mã người dùng không hợp lệ.', 400);
    }
    query += ' AND UserId = ?';
    params.push(uid);
  }

  if (phone !== undefined && phone !== null && String(phone).trim() !== '') {
    const cleanPhone = toCleanPhone(phone);
    query += ` AND ${sqlNormalizedPhoneExpr('CustomerPhone')} = ?`;
    params.push(cleanPhone || '__NONE__');
  }

  if (status && String(status).trim() !== '' && String(status).trim() !== 'all') {
    query += ' AND Status = ?';
    params.push(String(status).trim());
  }

  if (staffName && String(staffName).trim() !== '' && String(staffName).trim() !== 'all') {
    query += ' AND StaffName = ?';
    params.push(String(staffName).trim());
  }

  if (date && String(date).trim() !== '') {
    const dateStr = String(date).trim();
    if (!isValidIsoDate(dateStr)) {
      throw new AppError('Định dạng ngày lọc không hợp lệ (YYYY-MM-DD).', 400);
    }
    query += ' AND BookingDate = CAST(? AS DATE)';
    params.push(dateStr);
  }

  if (fromDate && String(fromDate).trim() !== '') {
    const fromStr = String(fromDate).trim();
    if (!isValidIsoDate(fromStr)) {
      throw new AppError('Định dạng từ ngày không hợp lệ (YYYY-MM-DD).', 400);
    }
    query += ' AND BookingDate >= CAST(? AS DATE)';
    params.push(fromStr);
  }

  if (toDate && String(toDate).trim() !== '') {
    const toStr = String(toDate).trim();
    if (!isValidIsoDate(toStr)) {
      throw new AppError('Định dạng đến ngày không hợp lệ (YYYY-MM-DD).', 400);
    }
    query += ' AND BookingDate <= CAST(? AS DATE)';
    params.push(toStr);
  }

  if (search && String(search).trim() !== '') {
    const q = String(search).trim();
    const qDigits = toCleanPhone(q);
    const searchLike = `%${q}%`;
    if (qDigits) {
      query += ` AND (
        BookingCode LIKE ?
        OR CustomerName LIKE ?
        OR PetNameOrType LIKE ?
        OR ServiceName LIKE ?
        OR CustomerPhone LIKE ?
        OR ${sqlNormalizedPhoneExpr('CustomerPhone')} LIKE ?
      )`;
      params.push(searchLike, searchLike, searchLike, searchLike, searchLike, `%${qDigits}%`);
    } else {
      query += ` AND (
        BookingCode LIKE ?
        OR CustomerName LIKE ?
        OR PetNameOrType LIKE ?
        OR ServiceName LIKE ?
        OR CustomerPhone LIKE ?
      )`;
      params.push(searchLike, searchLike, searchLike, searchLike, searchLike);
    }
  }

  query += ' ORDER BY BookingDate DESC, CreatedAt DESC, BookingId DESC';
  const [rows] = await pool.query(query, params);
  return rows.map(mapBookingRow);
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
  const [rows] = await pool.query(
    `
      SELECT *
      FROM ServiceBookings
      WHERE UPPER(BookingCode) = ?
        AND ${sqlNormalizedPhoneExpr('CustomerPhone')} = ?
      LIMIT 1
    `,
    [cleanCode, cleanPhone]
  );

  if (rows.length === 0) {
    throw new AppError('Không tìm thấy lịch hẹn khớp với thông tin tra cứu.', 404);
  }

  return mapBookingRow(rows[0]);
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
    const [rosterRows] = await pool.query(
      'SELECT StaffName FROM StaffRoster ORDER BY StaffId ASC'
    );
    const names = rosterRows
      .map((r) => String(r.StaffName || '').trim())
      .filter(Boolean);
    if (names.length > 0) {
      roster = names;
    }
  } catch (_) {
    roster = DEFAULT_STAFF_ROSTER;
  }

  const [busyRows] = await pool.query(
    `
      SELECT DISTINCT StaffName
      FROM ServiceBookings
      WHERE BookingDate = CAST(? AS DATE)
        AND LOWER(TRIM(TimeSlot)) = LOWER(TRIM(?))
        AND Status = 'upcoming'
        AND StaffName IS NOT NULL
    `,
    [bookingDate, timeSlot]
  );

  const busyLower = new Set(
    busyRows.map((r) => String(r.StaffName || '').trim().toLowerCase())
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
    const [pkgRows] = await pool.query(
      'SELECT * FROM SpaPackages WHERE PackageId = ?',
      [pkgId]
    );
    if (pkgRows.length > 0) {
      matchedPkg = pkgRows[0];
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
    const [dupRows] = await pool.query(
      'SELECT BookingId FROM ServiceBookings WHERE UPPER(BookingCode) = UPPER(?)',
      [explicitCode]
    );
    if (dupRows.length > 0) {
      throw new AppError('Mã lịch hẹn đã tồn tại.', 409);
    }
  } else {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = `BK${Math.floor(100000 + Math.random() * 899999)}`;
      // eslint-disable-next-line no-await-in-loop
      const [dupRows] = await pool.query(
        'SELECT BookingId FROM ServiceBookings WHERE BookingCode = ?',
        [candidate]
      );
      if (dupRows.length === 0) {
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
      const [uRows] = await pool.query('SELECT UserId FROM Users WHERE UserId = ?', [
        parsedUid,
      ]);
      if (uRows.length > 0) {
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

  const [insertRes] = await pool.query(
    `
      INSERT INTO ServiceBookings (
        BookingCode, UserId, PackageId, ServiceName, PetNameOrType,
        BookingDate, TimeSlot, Price, Status, CustomerName, CustomerPhone, StaffName, Note
      )
      VALUES (?, ?, ?, ?, ?, CAST(? AS DATE), ?, ?, 'upcoming', ?, ?, ?, ?)
    `,
    [
      bookingCode,
      resolvedUserId,
      validPackageId,
      serviceName.slice(0, 150),
      petNameOrType,
      bookingDate,
      timeSlot,
      Math.round(price),
      customerName,
      customerPhone,
      staffName,
      note,
    ]
  );

  const [insertedRows] = await pool.query(
    'SELECT * FROM ServiceBookings WHERE BookingId = ?',
    [insertRes.insertId]
  );
  return mapBookingRow(insertedRows[0]);
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

  await pool.query(
    `
      UPDATE ServiceBookings
      SET Status = ?,
          StaffName = ?,
          BookingDate = CAST(? AS DATE),
          TimeSlot = ?,
          PetNameOrType = ?,
          ServiceName = ?,
          Price = ?,
          CustomerName = ?,
          CustomerPhone = ?,
          Note = ?
      WHERE BookingId = ?
    `,
    [
      mergedStatus,
      mergedStaffName,
      mergedBookingDate,
      mergedTimeSlot,
      mergedPetName,
      mergedServiceName,
      Math.round(mergedPrice),
      mergedCustomerName,
      mergedCustomerPhone,
      mergedNote,
      existing.BookingId,
    ]
  );

  const [updatedRows] = await pool.query(
    'SELECT * FROM ServiceBookings WHERE BookingId = ?',
    [existing.BookingId]
  );
  return mapBookingRow(updatedRows[0]);
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

  await pool.query(
    "UPDATE ServiceBookings SET Status = 'cancelled' WHERE BookingId = ?",
    [existing.BookingId]
  );

  const [updatedRows] = await pool.query(
    'SELECT * FROM ServiceBookings WHERE BookingId = ?',
    [existing.BookingId]
  );

  return {
    alreadyCancelled: false,
    booking: mapBookingRow(updatedRows[0]),
  };
}

async function deleteServiceBooking(id) {
  const cleanCode = String(id || '')
    .trim()
    .replace(/^#/, '');
  if (!cleanCode) {
    throw new AppError('Mã lịch hẹn không hợp lệ.', 400);
  }

  const numericId = /^\d+$/.test(cleanCode) ? Number(cleanCode) : -1;
  const pool = await poolPromise;
  const [delRes] = await pool.query(
    'DELETE FROM ServiceBookings WHERE BookingCode = ? OR BookingId = ?',
    [cleanCode, numericId]
  );

  if (!delRes.affectedRows) {
    throw new AppError('Không tìm thấy lịch hẹn.', 404);
  }

  return { deleted: true };
}

// ============================================================================
// 3. Contact Messages (ContactMessages)
// ============================================================================

async function listContactMessages({ status, search } = {}) {
  const pool = await poolPromise;
  let query = 'SELECT * FROM ContactMessages WHERE 1=1';
  const params = [];

  if (status && String(status).trim() !== '' && String(status).trim() !== 'all') {
    query += ' AND Status = ?';
    params.push(String(status).trim());
  }

  if (search && String(search).trim() !== '') {
    const q = String(search).trim();
    const qDigits = toCleanPhone(q);
    const searchLike = `%${q}%`;
    if (qDigits) {
      query += ` AND (
        SenderName LIKE ?
        OR SenderPhone LIKE ?
        OR Topic LIKE ?
        OR Message LIKE ?
        OR ${sqlNormalizedPhoneExpr('SenderPhone')} LIKE ?
      )`;
      params.push(searchLike, searchLike, searchLike, searchLike, `%${qDigits}%`);
    } else {
      query += ` AND (
        SenderName LIKE ?
        OR SenderPhone LIKE ?
        OR Topic LIKE ?
        OR Message LIKE ?
      )`;
      params.push(searchLike, searchLike, searchLike, searchLike);
    }
  }

  query += ' ORDER BY CreatedAt DESC, MessageId DESC';
  const [rows] = await pool.query(query, params);
  return rows.map(mapContactMessageRow);
}

async function getContactMessageById(id) {
  const messageId = Number(id);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    throw new AppError('Mã tin nhắn liên hệ không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const [rows] = await pool.query(
    'SELECT * FROM ContactMessages WHERE MessageId = ?',
    [messageId]
  );

  if (rows.length === 0) {
    throw new AppError('Không tìm thấy tin nhắn liên hệ.', 404);
  }

  return mapContactMessageRow(rows[0]);
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
  const [insertRes] = await pool.query(
    `
      INSERT INTO ContactMessages (SenderName, SenderPhone, Topic, Message)
      VALUES (?, ?, ?, ?)
    `,
    [
      finalName.slice(0, 120),
      senderPhone,
      finalTopic.slice(0, 150),
      finalMsg.slice(0, 1000),
    ]
  );

  const [rows] = await pool.query(
    'SELECT * FROM ContactMessages WHERE MessageId = ?',
    [insertRes.insertId]
  );
  return mapContactMessageRow(rows[0]);
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
  const [updRes] = await pool.query(
    'UPDATE ContactMessages SET Status = ? WHERE MessageId = ?',
    [nextStatus, messageId]
  );

  if (updRes.affectedRows === 0) {
    throw new AppError('Không tìm thấy tin nhắn liên hệ.', 404);
  }

  const [rows] = await pool.query(
    'SELECT * FROM ContactMessages WHERE MessageId = ?',
    [messageId]
  );
  return mapContactMessageRow(rows[0]);
}

async function deleteContactMessage(id) {
  const messageId = Number(id);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    throw new AppError('Mã tin nhắn liên hệ không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const [delRes] = await pool.query(
    'DELETE FROM ContactMessages WHERE MessageId = ?',
    [messageId]
  );

  if (!delRes.affectedRows) {
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
