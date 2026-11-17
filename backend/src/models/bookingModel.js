const { sql, poolPromise } = require('../config/db');
const httpError = require('../utils/httpError');

const COLS = `Id AS id, ServiceId AS serviceId, ServiceName AS serviceName, PetName AS petName,
  BookingDate AS date, TimeSlot AS timeSlot, Price AS price, Status AS status, Note AS note,
  CustomerName AS customerName, CustomerPhone AS customerPhone, StaffName AS staffName,
  CreatedAt AS createdAt`;

const map = (r) => r && { ...r, date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date };

const TRANSITIONS = { upcoming: ['completed', 'cancelled'], completed: [], cancelled: [] };

exports.findServices = async () => {
  const pool = await poolPromise;
  const r = await pool.request().query(
    'SELECT Id AS id, Name AS name, Description AS description, Price AS price, Duration AS duration, IsPopular AS isPopular FROM Services ORDER BY Price'
  );
  return r.recordset;
};

exports.findServiceById = async (id) => {
  const pool = await poolPromise;
  const r = await pool.request().input('id', sql.NVarChar(30), id)
    .query('SELECT Id AS id, Name AS name, Price AS price FROM Services WHERE Id = @id');
  return r.recordset[0] || null;
};

exports.findAll = async ({ status, date, search } = {}) => {
  const pool = await poolPromise;
  const req = pool.request();
  const where = [];
  if (status) { req.input('status', sql.NVarChar(20), status); where.push('Status = @status'); }
  if (date) { req.input('date', sql.Date, date); where.push('BookingDate = @date'); }
  if (search) {
    req.input('search', sql.NVarChar(200), `%${search}%`);
    where.push('(Id LIKE @search OR PetName LIKE @search OR CustomerName LIKE @search OR CustomerPhone LIKE @search)');
  }
  const r = await req.query(
    `SELECT ${COLS} FROM Bookings ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY BookingDate DESC, TimeSlot`
  );
  return r.recordset.map(map);
};

exports.findById = async (id) => {
  const pool = await poolPromise;
  const r = await pool.request().input('id', sql.NVarChar(30), id)
    .query(`SELECT ${COLS} FROM Bookings WHERE Id = @id`);
  return map(r.recordset[0]) || null;
};

exports.create = async (b) => {
  const pool = await poolPromise;
  await pool.request()
    .input('id', sql.NVarChar(30), b.id)
    .input('sid', sql.NVarChar(30), b.serviceId)
    .input('sname', sql.NVarChar(150), b.serviceName)
    .input('pet', sql.NVarChar(100), b.petName)
    .input('date', sql.Date, b.date)
    .input('slot', sql.NVarChar(30), b.timeSlot)
    .input('price', sql.Int, b.price)
    .input('note', sql.NVarChar(500), b.note)
    .input('cname', sql.NVarChar(100), b.customerName)
    .input('cphone', sql.NVarChar(30), b.customerPhone)
    .input('staff', sql.NVarChar(100), b.staffName)
    .query(`INSERT INTO Bookings (Id, ServiceId, ServiceName, PetName, BookingDate, TimeSlot, Price, Note, CustomerName, CustomerPhone, StaffName)
            VALUES (@id, @sid, @sname, @pet, @date, @slot, @price, @note, @cname, @cphone, @staff)`);
  return exports.findById(b.id);
};

exports.changeStatus = async (id, newStatus) => {
  const cur = await exports.findById(id);
  if (!cur) throw httpError(404, 'Không tìm thấy lịch hẹn');
  if (!TRANSITIONS[cur.status].includes(newStatus)) {
    throw httpError(400, `Không thể chuyển lịch từ "${cur.status}" sang "${newStatus}"`);
  }
  const pool = await poolPromise;
  await pool.request()
    .input('id', sql.NVarChar(30), id)
    .input('status', sql.NVarChar(20), newStatus)
    .query('UPDATE Bookings SET Status = @status WHERE Id = @id');
  return exports.findById(id);
};