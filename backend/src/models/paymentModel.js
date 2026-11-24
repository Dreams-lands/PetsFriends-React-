const { sql, poolPromise } = require('../config/db');

const COLS = `CodEnabled AS codEnabled, CodNote AS codNote,
  VnpayEnabled AS vnpayEnabled, VnpayTmnCode AS vnpayTmnCode, VnpayEnvironment AS vnpayEnvironment, VnpayHashSecret AS vnpayHashSecret,
  MomoEnabled AS momoEnabled, MomoPartnerCode AS momoPartnerCode, MomoEnvironment AS momoEnvironment,
  MomoAccessKey AS momoAccessKey, MomoSecretKey AS momoSecretKey`;

exports.get = async () => {
  const pool = await poolPromise;
  const r = await pool.request().query(`SELECT ${COLS} FROM PaymentSettings WHERE Id = 1`);
  return r.recordset[0];
};

// Chỉ cập nhật trường nào được gửi lên (COALESCE giữ nguyên giá trị cũ)
exports.update = async (p) => {
  const pool = await poolPromise;
  await pool.request()
    .input('codEnabled', sql.Bit, p.codEnabled)
    .input('codNote', sql.NVarChar(500), p.codNote)
    .input('vnpayEnabled', sql.Bit, p.vnpayEnabled)
    .input('vnpayTmn', sql.NVarChar(100), p.vnpayTmnCode)
    .input('vnpayEnv', sql.NVarChar(12), p.vnpayEnvironment)
    .input('vnpaySecret', sql.NVarChar(200), p.vnpayHashSecret)
    .input('momoEnabled', sql.Bit, p.momoEnabled)
    .input('momoPartner', sql.NVarChar(100), p.momoPartnerCode)
    .input('momoEnv', sql.NVarChar(12), p.momoEnvironment)
    .input('momoAccess', sql.NVarChar(200), p.momoAccessKey)
    .input('momoSecret', sql.NVarChar(200), p.momoSecretKey)
    .query(`UPDATE PaymentSettings SET
      CodEnabled = COALESCE(@codEnabled, CodEnabled),
      CodNote = COALESCE(@codNote, CodNote),
      VnpayEnabled = COALESCE(@vnpayEnabled, VnpayEnabled),
      VnpayTmnCode = COALESCE(@vnpayTmn, VnpayTmnCode),
      VnpayEnvironment = COALESCE(@vnpayEnv, VnpayEnvironment),
      VnpayHashSecret = COALESCE(@vnpaySecret, VnpayHashSecret),
      MomoEnabled = COALESCE(@momoEnabled, MomoEnabled),
      MomoPartnerCode = COALESCE(@momoPartner, MomoPartnerCode),
      MomoEnvironment = COALESCE(@momoEnv, MomoEnvironment),
      MomoAccessKey = COALESCE(@momoAccess, MomoAccessKey),
      MomoSecretKey = COALESCE(@momoSecret, MomoSecretKey)
      WHERE Id = 1`);
  return exports.get();
};

exports.setOrderPayment = async (orderId, status) => {
  const pool = await poolPromise;
  const r = await pool.request()
    .input('id', sql.NVarChar(30), orderId)
    .input('status', sql.NVarChar(10), status)
    .query('UPDATE Orders SET PaymentStatus = @status WHERE Id = @id');
  return r.rowsAffected[0] > 0;
};