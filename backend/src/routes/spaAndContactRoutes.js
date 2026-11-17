const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../../../api/db');
const { formatCurrency, mapBookingRow } = require('../../../api/utils/mappers');

// 1. Danh sách gói dịch vụ Spa
router.get('/spa-packages', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM dbo.SpaPackages ORDER BY PackageId ASC');
    res.status(200).json(
      result.recordset.map((pkg) => ({
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
      }))
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 2. Lấy danh sách lịch hẹn Spa
router.get('/service-bookings', async (req, res) => {
  const { userId, phone, status, staffName, date } = req.query;

  try {
    const pool = await poolPromise;
    const request = pool.request();
    let query = 'SELECT * FROM dbo.ServiceBookings WHERE 1=1';

    if (userId) {
      query += ' AND UserId = @userId';
      request.input('userId', sql.Int, Number(userId));
    }
    if (phone) {
      query += " AND REPLACE(REPLACE(CustomerPhone, ' ', ''), '.', '') = @cleanPhone";
      request.input('cleanPhone', sql.NVarChar(30), String(phone).replace(/\D/g, ''));
    }
    if (status && status !== 'all') {
      query += ' AND Status = @status';
      request.input('status', sql.NVarChar(20), String(status));
    }
    if (staffName && staffName !== 'all') {
      query += ' AND StaffName = @staffName';
      request.input('staffName', sql.NVarChar(120), String(staffName));
    }
    if (date) {
      query += ' AND BookingDate = @date';
      request.input('date', sql.Date, String(date));
    }

    query += ' ORDER BY BookingDate DESC, CreatedAt DESC';
    const result = await request.query(query);
    res.status(200).json(result.recordset.map(mapBookingRow));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 3. Tạo lịch hẹn Spa mới (Storefront & AdminAppointmentsView)
router.post('/service-bookings', async (req, res) => {
  const body = req.body;
  const serviceName = String(body.serviceName || '').trim();
  const petNameOrType = String(body.petName || body.petNameOrType || 'Thú cưng').trim();
  const bookingDate = String(body.date || body.bookingDate || new Date().toISOString().slice(0, 10)).trim();
  const timeSlot = String(body.timeSlot || '10:30 Sáng').trim();
  const customerName = String(body.customerName || 'Khách PetsFriend').trim();
  const customerPhone = String(body.customerPhone || '').trim();
  const price = Number(body.price || 0);

  if (!serviceName || !customerPhone) {
    return res.status(400).json({
      message: 'Vui lòng cung cấp gói dịch vụ và số điện thoại liên hệ.',
    });
  }

  const rawCode = String(body.id || body.bookingCode || '')
    .trim()
    .replace(/^#/, '');
  const bookingCode =
    rawCode || `BK${Math.floor(100000 + Math.random() * 899999)}`;

  try {
    const pool = await poolPromise;

    let validPackageId = null;
    if (body.packageId) {
      const pkgCheck = await pool
        .request()
        .input('pkgId', sql.NVarChar(30), String(body.packageId))
        .query('SELECT PackageId FROM dbo.SpaPackages WHERE PackageId = @pkgId');
      if (pkgCheck.recordset.length > 0) {
        validPackageId = String(body.packageId);
      }
    }

    const result = await pool
      .request()
      .input('bookingCode', sql.NVarChar(20), bookingCode)
      .input('userId', sql.Int, body.userId ? Number(body.userId) : null)
      .input('packageId', sql.NVarChar(30), validPackageId)
      .input('serviceName', sql.NVarChar(150), serviceName)
      .input('petNameOrType', sql.NVarChar(120), petNameOrType)
      .input('bookingDate', sql.Date, bookingDate)
      .input('timeSlot', sql.NVarChar(40), timeSlot)
      .input('price', sql.Decimal(18, 0), price)
      .input('customerName', sql.NVarChar(120), customerName)
      .input('customerPhone', sql.NVarChar(20), customerPhone)
      .input('staffName', sql.NVarChar(120), body.staffName || 'Linh Phạm')
      .input('note', sql.NVarChar(400), body.note || null)
      .query(`
        INSERT INTO dbo.ServiceBookings (
          BookingCode, UserId, PackageId, ServiceName, PetNameOrType,
          BookingDate, TimeSlot, Price, Status, CustomerName, CustomerPhone, StaffName, Note
        )
        OUTPUT INSERTED.*
        VALUES (
          @bookingCode, @userId, @packageId, @serviceName, @petNameOrType,
          @bookingDate, @timeSlot, @price, N'upcoming', @customerName, @customerPhone, @staffName, @note
        )
      `);

    res.status(201).json({
      message: 'Đặt lịch chăm sóc thành công!',
      booking: mapBookingRow(result.recordset[0]),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 4. Cập nhật trạng thái hoặc phân công chuyên viên cho lịch hẹn
async function updateBookingHandler(req, res) {
  const idParam = String(req.params.id).trim().replace(/^#/, '');
  const nextStatus = req.body.status ? String(req.body.status).trim() : null;
  const nextStaff = req.body.staffName ? String(req.body.staffName).trim() : null;

  if (nextStatus && !['upcoming', 'completed', 'cancelled'].includes(nextStatus)) {
    return res.status(400).json({ message: 'Trạng thái lịch hẹn không hợp lệ.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('code', sql.NVarChar(20), idParam)
      .input('status', sql.NVarChar(20), nextStatus)
      .input('staffName', sql.NVarChar(120), nextStaff)
      .query(`
        UPDATE dbo.ServiceBookings
        SET Status = COALESCE(@status, Status),
            StaffName = COALESCE(@staffName, StaffName)
        OUTPUT INSERTED.*
        WHERE BookingCode = @code OR BookingId = TRY_CAST(@code AS INT)
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy lịch hẹn.' });
    }
    res.status(200).json(mapBookingRow(result.recordset[0]));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

router.patch('/service-bookings/:id', updateBookingHandler);
router.patch('/service-bookings/:id/status', updateBookingHandler);
router.patch('/service-bookings/:id/assign-staff', updateBookingHandler);

// 5. Tin nhắn liên hệ (Contact Page)
router.get('/contact-messages', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .query('SELECT * FROM dbo.ContactMessages ORDER BY CreatedAt DESC');
    res.status(200).json(result.recordset);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/contact-messages', async (req, res) => {
  const { senderName, name, senderPhone, phone, topic, message } = req.body;
  const finalName = String(senderName || name || '').trim();
  const finalPhone = String(senderPhone || phone || '').trim();
  const finalTopic = String(topic || 'Tư vấn sản phẩm & dinh dưỡng').trim();
  const finalMsg = String(message || '').trim();

  if (!finalName || !finalPhone || !finalMsg) {
    return res.status(400).json({
      message: 'Vui lòng điền đầy đủ họ tên, số điện thoại và nội dung lời nhắn.',
    });
  }

  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('senderName', sql.NVarChar(120), finalName)
      .input('senderPhone', sql.NVarChar(20), finalPhone)
      .input('topic', sql.NVarChar(150), finalTopic)
      .input('message', sql.NVarChar(1000), finalMsg)
      .query(`
        INSERT INTO dbo.ContactMessages (SenderName, SenderPhone, Topic, Message)
        OUTPUT INSERTED.*
        VALUES (@senderName, @senderPhone, @topic, @message)
      `);

    res.status(201).json({
      message: 'Đã tiếp nhận yêu cầu hỗ trợ thành công!',
      data: result.recordset[0],
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/contact-messages/:id/status', async (req, res) => {
  const nextStatus = String(req.body.status || '').trim();
  if (!['new', 'replied', 'closed'].includes(nextStatus)) {
    return res.status(400).json({ message: 'Trạng thái tin nhắn không hợp lệ.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('id', sql.Int, Number(req.params.id))
      .input('status', sql.NVarChar(20), nextStatus)
      .query(`
        UPDATE dbo.ContactMessages
        SET Status = @status
        OUTPUT INSERTED.*
        WHERE MessageId = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy tin nhắn.' });
    }
    res.status(200).json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;