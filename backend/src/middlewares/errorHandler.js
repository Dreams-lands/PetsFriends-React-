module.exports = (err, req, res, next) => {
  // 2627 / 2601: vi phạm UNIQUE (trùng email hoặc mã) trong SQL Server
  if (err.number === 2627 || err.number === 2601) {
    return res.status(409).json({ success: false, message: 'Dữ liệu đã tồn tại (trùng email hoặc mã)' });
  }
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({
    success: false,
    message: status === 500 ? 'Lỗi máy chủ' : err.message,
  });
};