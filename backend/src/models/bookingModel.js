const { poolPromise } = require('../config/db');
const httpError = require('../utils/httpError');

const COLS = `Id AS id, ServiceId AS serviceId, ServiceName AS serviceName, PetName AS petName,
  BookingDate AS date, TimeSlot AS timeSlot, Price AS price, Status AS status, Note AS note,
  CustomerName AS customerName, CustomerPhone AS customerPhone, StaffName AS staffName,
  CreatedAt AS createdAt`;

const map = (r) =>
  r && {
    ...r,
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date,
  };

const TRANSITIONS = {
  upcoming: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

exports.findServices = async () => {
  const pool = await poolPromise;
  const [rows] = await pool.query(
    'SELECT Id AS id, Name AS name, Description AS description, Price AS price, Duration AS duration, IsPopular AS isPopular FROM Services ORDER BY Price'
  );
  return rows;
};

exports.findServiceById = async (id) => {
  const pool = await poolPromise;
  const [rows] = await pool.query(
    'SELECT Id AS id, Name AS name, Price AS price FROM Services WHERE Id = ?',
    [id]
  );
  return rows[0] || null;
};

exports.findAll = async ({ status, date, search } = {}) => {
  const pool = await poolPromise;
  const where = [];
  const params = [];
  if (status) {
    where.push('Status = ?');
    params.push(status);
  }
  if (date) {
    where.push('BookingDate = ?');
    params.push(date);
  }
  if (search) {
    const q = `%${search}%`;
    where.push(
      '(Id LIKE ? OR PetName LIKE ? OR CustomerName LIKE ? OR CustomerPhone LIKE ?)'
    );
    params.push(q, q, q, q);
  }
  const [rows] = await pool.query(
    `SELECT ${COLS} FROM Bookings ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY BookingDate DESC, TimeSlot`,
    params
  );
  return rows.map(map);
};

exports.findById = async (id) => {
  const pool = await poolPromise;
  const [rows] = await pool.query(`SELECT ${COLS} FROM Bookings WHERE Id = ?`, [id]);
  return map(rows[0]) || null;
};

exports.create = async (b) => {
  const pool = await poolPromise;
  await pool.query(
    `INSERT INTO Bookings (Id, ServiceId, ServiceName, PetName, BookingDate, TimeSlot, Price, Note, CustomerName, CustomerPhone, StaffName)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      b.id,
      b.serviceId || null,
      b.serviceName,
      b.petName,
      b.date,
      b.timeSlot,
      b.price,
      b.note || null,
      b.customerName || null,
      b.customerPhone || null,
      b.staffName || null,
    ]
  );
  return exports.findById(b.id);
};

exports.changeStatus = async (id, newStatus) => {
  const cur = await exports.findById(id);
  if (!cur) throw httpError(404, 'Không tìm thấy lịch hẹn');
  if (!TRANSITIONS[cur.status].includes(newStatus)) {
    throw httpError(
      400,
      `Không thể chuyển lịch từ "${cur.status}" sang "${newStatus}"`
    );
  }
  const pool = await poolPromise;
  await pool.query('UPDATE Bookings SET Status = ? WHERE Id = ?', [newStatus, id]);
  return exports.findById(id);
};
