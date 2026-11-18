const paymentService = require('../services/paymentService');

function sendError(res, err) {
  return res.status(err.statusCode || 500).json({ message: err.message || 'Lỗi máy chủ nội bộ.' });
}

function actorOf(req, fallback) {
  return (req.body && req.body.staffName) || (req.user && req.user.username) || fallback || null;
}

function redirectToFrontend(res, result, gateway) {
  const frontendUrl = process.env.FRONTEND_URL;
  if (!frontendUrl) return false;
  const status = result.success ? 'success' : 'failed';
  const params = new URLSearchParams({
    payment: status,
    gateway,
    orderCode: result.orderCode || '',
    code: result.responseCode || result.RspCode || '',
  });
  res.redirect(`${frontendUrl.replace(/\/+$/, '')}/?${params.toString()}`);
  return true;
}

// 1. Cấu hình cổng thanh toán
async function getPaymentGateways(req, res) {
  try {
    const includeSecrets =
      String(req.query.includeSecrets || '') === 'true' && req.user && req.user.role === 'admin';
    const data = await paymentService.getPaymentGateways({ includeSecrets });
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err);
  }
}

async function updatePaymentGateways(req, res) {
  try {
    const data = await paymentService.updatePaymentGateways(req.body || {});
    return res.status(200).json({ message: 'Đã lưu cấu hình cổng thanh toán.', ...data });
  } catch (err) {
    return sendError(res, err);
  }
}

// 2. VNPay
async function createVnpayPayment(req, res) {
  try {
    const body = req.body || {};
    const result = await paymentService.createVnpayPayment(body.orderCode || body.orderId || body.id, {
      requester: req.user || null,
      phone: body.phone || body.customerPhone || '',
      bankCode: body.bankCode || '',
      locale: body.locale || 'vn',
      returnUrl: body.returnUrl || '',
      ipAddr: paymentService.normalizeClientIp(req),
    });
    return res.status(201).json(result);
  } catch (err) {
    return sendError(res, err);
  }
}

async function vnpayReturn(req, res) {
  try {
    const result = await paymentService.processVnpayResult(req.query || {});
    if (redirectToFrontend(res, result, 'vnpay')) return undefined;
    if (result.RspCode === '97') {
      return res.status(400).json({ success: false, message: 'Chữ ký VNPay không hợp lệ.', ...result });
    }
    if (result.RspCode === '01') {
      return res.status(404).json({ success: false, message: 'Không tìm thấy giao dịch thanh toán.', ...result });
    }
    if (result.RspCode === '04') {
      return res.status(400).json({ success: false, message: 'Số tiền thanh toán không khớp đơn hàng.', ...result });
    }
    return res.status(200).json({
      message: result.success ? 'Thanh toán đơn hàng thành công.' : result.message || 'Thanh toán không thành công.',
      ...result,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function vnpayIpn(req, res) {
  try {
    const result = await paymentService.processVnpayResult(req.query || {});
    // VNPay yêu cầu luôn phản hồi HTTP 200 với { RspCode, Message }
    return res.status(200).json({ RspCode: result.RspCode, Message: result.Message });
  } catch (err) {
    return res.status(200).json({ RspCode: '99', Message: 'Unknown error' });
  }
}

// 3. MoMo
async function createMomoPayment(req, res) {
  try {
    const body = req.body || {};
    const result = await paymentService.createMomoPayment(body.orderCode || body.orderId || body.id, {
      requester: req.user || null,
      phone: body.phone || body.customerPhone || '',
      redirectUrl: body.redirectUrl || '',
      sandboxFallback: Boolean(body.sandboxFallback),
    });
    return res.status(201).json(result);
  } catch (err) {
    return sendError(res, err);
  }
}

async function momoReturn(req, res) {
  try {
    const result = await paymentService.processMomoResult(req.query || {});
    if (redirectToFrontend(res, result, 'momo')) return undefined;
    if (result.RspCode === '97') {
      return res.status(400).json({ success: false, message: 'Chữ ký MoMo không hợp lệ.', ...result });
    }
    if (result.RspCode === '01') {
      return res.status(404).json({ success: false, message: 'Không tìm thấy giao dịch thanh toán.', ...result });
    }
    if (result.RspCode === '04') {
      return res.status(400).json({ success: false, message: 'Số tiền thanh toán không khớp đơn hàng.', ...result });
    }
    return res.status(200).json({
      message: result.success ? 'Thanh toán đơn hàng thành công.' : result.message || 'Thanh toán không thành công.',
      ...result,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function momoIpn(req, res) {
  try {
    const result = await paymentService.processMomoResult(req.body || {});
    if (result.RspCode === '97') {
      return res.status(400).json({ message: 'Invalid signature' });
    }
    // MoMo chỉ cần HTTP 204 để xác nhận đã nhận IPN
    return res.status(204).end();
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

// 4. Nghiệp vụ thanh toán nội bộ
async function getOrderPayment(req, res) {
  try {
    const data = await paymentService.getOrderPayment(req.params.orderCode, {
      requester: req.user || null,
      phone: req.query.phone || '',
    });
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err);
  }
}

async function confirmManualPayment(req, res) {
  try {
    const body = req.body || {};
    const result = await paymentService.confirmManualPayment(req.params.orderCode, {
      method: body.method || 'cash',
      note: body.note || '',
      actorName: actorOf(req),
    });
    return res.status(200).json(result);
  } catch (err) {
    return sendError(res, err);
  }
}

async function refundPayment(req, res) {
  try {
    const body = req.body || {};
    const result = await paymentService.refundPayment(req.params.orderCode, {
      reason: body.reason || '',
      actorName: actorOf(req),
    });
    return res.status(200).json(result);
  } catch (err) {
    return sendError(res, err);
  }
}

async function listTransactions(req, res) {
  try {
    const data = await paymentService.listTransactions(req.query || {});
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err);
  }
}

async function getPaymentSummary(req, res) {
  try {
    const data = await paymentService.getPaymentSummary(req.query || {});
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err);
  }
}

async function expireUnpaidOrders(req, res) {
  try {
    const body = req.body || {};
    const result = await paymentService.expireUnpaidOnlineOrders({
      minutes: body.minutes !== undefined ? Number(body.minutes) : 30,
      actorName: actorOf(req),
    });
    return res.status(200).json(result);
  } catch (err) {
    return sendError(res, err);
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function qrScanRedirect(req, res) {
  try {
    const tx = await paymentService.getTransactionByRef(req.params.txnRef);
    const accept = String(req.headers.accept || '');
    if (accept.includes('application/json') && !accept.includes('text/html')) {
      const { customerPhone: _hiddenPhone, ...safeTx } = tx;
      return res.status(200).json(safeTx);
    }
    if (
      tx.payUrl &&
      /^https:\/\//i.test(tx.payUrl) &&
      req.query.direct === '1'
    ) {
      return res.redirect(tx.payUrl);
    }
    const gwLabel = tx.gateway === 'momo' ? 'Ví điện tử MoMo' : 'Cổng VNPay QR';
    const accent = tx.gateway === 'momo' ? '#a50064' : '#005baa';
    const formattedAmount = `${Number(tx.amount || 0).toLocaleString('vi-VN')}₫`;
    const statusLabel =
      tx.status === 'success'
        ? 'Đã thanh toán thành công'
        : tx.status === 'failed'
          ? 'Giao dịch đã hủy / thất bại'
          : 'Đang chờ xác nhận thanh toán';
    const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Thanh toán QR ${escapeHtml(gwLabel)} - PetsFriend</title>
  <style>
    body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f3f7ff;color:#17324d;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
    .card{width:100%;max-width:420px;background:#fff;border-radius:20px;border:1px solid #dfe6f0;overflow:hidden;box-shadow:0 16px 40px rgba(23,50,77,.08)}
    .head{background:${accent};color:#fff;padding:18px 20px}
    .head h1{margin:0;font-size:18px}
    .head p{margin:4px 0 0;font-size:12px;opacity:.9}
    .body{padding:20px;font-size:14px}
    .row{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px dashed #dfe6f0}
    .amt{font-size:24px;font-weight:800;color:${accent};text-align:center;margin:12px 0 16px}
    .btn{display:block;width:100%;padding:12px;border:none;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;margin-top:10px;text-align:center;text-decoration:none;box-sizing:border-box}
    .btn-primary{background:${accent};color:#fff}
    .btn-outline{background:#f8faff;color:#17324d;border:1px solid #dfe6f0}
    .msg{margin-top:12px;padding:10px 12px;border-radius:10px;background:#eff5ff;font-size:13px;text-align:center;font-weight:600}
  </style>
</head>
<body>
  <div class="card">
    <div class="head">
      <h1>${escapeHtml(gwLabel)} · Sandbox</h1>
      <p>PetsFriend — Cổng xác nhận quét mã QR</p>
    </div>
    <div class="body">
      <div class="amt">${escapeHtml(formattedAmount)}</div>
      <div class="row"><span>Mã đơn hàng</span><strong>#${escapeHtml(tx.orderCode)}</strong></div>
      <div class="row"><span>Mã giao dịch</span><strong>${escapeHtml(tx.txnRef)}</strong></div>
      <div class="row"><span>Khách hàng</span><strong>${escapeHtml(tx.customerName || 'Quý khách')}</strong></div>
      <div class="row"><span>Trạng thái</span><strong id="st">${escapeHtml(statusLabel)}</strong></div>
      <div id="actions" style="${tx.status === 'pending' ? '' : 'display:none'}">
        <button class="btn btn-primary" onclick="confirmQr('success')">Xác nhận thanh toán ngay</button>
        ${tx.payUrl && /^https:\/\//i.test(tx.payUrl) ? `<a class="btn btn-outline" href="${escapeHtml(tx.payUrl)}">Mở cổng ${escapeHtml(gwLabel)} thật</a>` : ''}
      </div>
      <div id="msg" class="msg" style="display:none"></div>
    </div>
  </div>
  <script>
    async function confirmQr(outcome){
      var msgEl=document.getElementById('msg');
      msgEl.style.display='block';
      msgEl.textContent='Đang xác nhận giao dịch...';
      try{
        var r=await fetch('/api/payments/orders/${encodeURIComponent(tx.orderCode)}/sandbox-complete',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({phone:${JSON.stringify(tx.customerPhone || '')},outcome:outcome})
        });
        var d=await r.json();
        msgEl.textContent=d.message||'Đã xử lý giao dịch.';
        if(r.ok){
          document.getElementById('actions').style.display='none';
          document.getElementById('st').textContent=d.success?'Đã thanh toán thành công':'Đã hủy giao dịch';
        }
      }catch(e){msgEl.textContent='Lỗi kết nối tới máy chủ API.';}
    }
  </script>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (err) {
    return sendError(res, err);
  }
}

async function sandboxCompletePayment(req, res) {
  try {
    const body = req.body || {};
    const result = await paymentService.sandboxCompletePayment(req.params.orderCode, {
      requester: req.user || null,
      phone: body.phone || body.customerPhone || '',
      outcome: body.outcome || 'success',
    });
    return res.status(200).json({
      message: result.success
        ? 'Đã xác nhận thanh toán QR thành công!'
        : result.message || 'Giao dịch thanh toán đã bị hủy.',
      ...result,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = {
  getPaymentGateways,
  updatePaymentGateways,
  createVnpayPayment,
  vnpayReturn,
  vnpayIpn,
  createMomoPayment,
  momoReturn,
  momoIpn,
  getOrderPayment,
  confirmManualPayment,
  refundPayment,
  listTransactions,
  getPaymentSummary,
  expireUnpaidOrders,
  qrScanRedirect,
  sandboxCompletePayment,
};
