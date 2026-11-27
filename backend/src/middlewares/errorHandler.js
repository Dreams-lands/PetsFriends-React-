module.exports = (err, req, res, next) => {
  // ER_DUP_ENTRY (errno 1062): vi phạm UNIQUE (trùng email hoặc mã) trong MySQL
  if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
    return res.status(409).json({ success: false, message: 'Dữ liệu đã tồn tại (trùng email hoặc mã)' });
  }
  const status = err.status || err.statusCode || 500;
  if (status === 500) console.error(err);
  res.status(status).json({
    success: false,
    message: status === 500 ? 'Lỗi máy chủ' : err.message,
  });
};
