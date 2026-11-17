const bookingModel = require('../models/bookingModel');
const httpError = require('../utils/httpError');

const STATUSES = ['upcoming', 'completed', 'cancelled'];

const newId = () => {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `BK${yy}${mm}${dd}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
};

exports.getServices = () => bookingModel.findServices();

exports.getAll = (q) => {
  if (q.status && !STATUSES.includes(q.status)) throw httpError(400, 'Trạng thái không hợp lệ');
  if (q.date && !/^\d{4}-\d{2}-\d{2}$/.test(q.date)) throw httpError(400, 'Ngày phải có dạng YYYY-MM-DD');
  return bookingModel.findAll(q);
};

exports.getById = async (id) => {
  const b = await bookingModel.findById(id);
  if (!b) throw httpError(404, 'Không tìm thấy lịch hẹn');
  return b;
};

exports.create = async (b) => {
  const petName = (b.petName || '').trim();
  const timeSlot = (b.timeSlot || '').trim();
  if (!petName) throw httpError(400, 'Tên thú cưng không được để trống');
  if (!timeSlot) throw httpError(400, 'Thiếu khung giờ');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) throw httpError(400, 'Ngày phải có dạng YYYY-MM-DD');

  const service = await bookingModel.findServiceById(b.serviceId);
  if (!service) throw httpError(400, 'Dịch vụ không tồn tại');

  return bookingModel.create({
    id: newId(),
    serviceId: service.id,
    serviceName: service.name,
    price: service.price, // lấy giá từ database
    petName,
    date: b.date,
    timeSlot,
    note: b.note || null,
    customerName: b.customerName || null,
    customerPhone: b.customerPhone || null,
    staffName: b.staffName || null,
  });
};

exports.changeStatus = (id, status) => {
  if (!STATUSES.includes(status)) throw httpError(400, 'Trạng thái không hợp lệ');
  return bookingModel.changeStatus(id, status);
};