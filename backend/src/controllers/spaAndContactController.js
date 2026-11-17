const spaAndContactService = require('../services/spaAndContactService');

// ============================================================================
// 1. Spa Packages Controllers
// ============================================================================

async function listSpaPackages(req, res) {
  try {
    const packages = await spaAndContactService.listSpaPackages();
    return res.status(200).json(packages);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function getSpaPackageById(req, res) {
  try {
    const pkg = await spaAndContactService.getSpaPackageById(req.params.id);
    return res.status(200).json(pkg);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function createSpaPackage(req, res) {
  try {
    const pkg = await spaAndContactService.createSpaPackage(req.body || {});
    return res.status(201).json(pkg);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function updateSpaPackage(req, res) {
  try {
    const pkg = await spaAndContactService.updateSpaPackage(
      req.params.id,
      req.body || {}
    );
    return res.status(200).json(pkg);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function deleteSpaPackage(req, res) {
  try {
    await spaAndContactService.deleteSpaPackage(req.params.id);
    return res.status(200).json({ message: 'Đã xóa gói dịch vụ Spa.' });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

// ============================================================================
// 2. Service Bookings Controllers
// ============================================================================

async function listServiceBookings(req, res) {
  try {
    const bookings = await spaAndContactService.listServiceBookings(req.query || {});
    return res.status(200).json(bookings);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function lookupServiceBooking(req, res) {
  try {
    const booking = await spaAndContactService.lookupServiceBooking(req.query || {});
    return res.status(200).json(booking);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function getServiceBookingById(req, res) {
  try {
    const booking = await spaAndContactService.getServiceBookingById(req.params.id);
    return res.status(200).json(booking);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function createServiceBooking(req, res) {
  try {
    const booking = await spaAndContactService.createServiceBooking(
      req.body || {},
      req.user || null
    );
    return res.status(201).json({
      message: 'Đặt lịch chăm sóc thành công!',
      booking,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function updateServiceBooking(req, res) {
  try {
    const rawBody = req.body || {};
    const payload =
      rawBody.staffName === undefined && rawBody.staff !== undefined
        ? { ...rawBody, staffName: rawBody.staff }
        : rawBody;
    const booking = await spaAndContactService.updateServiceBooking(
      req.params.id,
      payload
    );
    return res.status(200).json(booking);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function cancelServiceBooking(req, res) {
  try {
    const phone =
      req.body?.phone ?? req.body?.customerPhone ?? req.query?.phone ?? '';
    const { alreadyCancelled, booking } =
      await spaAndContactService.cancelServiceBooking(req.params.id, {
        reqUser: req.user || null,
        phone,
      });

    return res.status(200).json({
      message: alreadyCancelled
        ? 'Lịch hẹn đã ở trạng thái hủy.'
        : 'Đã hủy lịch hẹn chăm sóc thành công.',
      booking,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function deleteServiceBooking(req, res) {
  try {
    await spaAndContactService.deleteServiceBooking(req.params.id);
    return res.status(200).json({ message: 'Đã xóa lịch hẹn.' });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

// ============================================================================
// 3. Contact Messages Controllers
// ============================================================================

async function listContactMessages(req, res) {
  try {
    const messages = await spaAndContactService.listContactMessages(req.query || {});
    return res.status(200).json(messages);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function getContactMessageById(req, res) {
  try {
    const msg = await spaAndContactService.getContactMessageById(req.params.id);
    return res.status(200).json(msg);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function createContactMessage(req, res) {
  try {
    const data = await spaAndContactService.createContactMessage(req.body || {});
    return res.status(201).json({
      message: 'Đã tiếp nhận yêu cầu hỗ trợ thành công!',
      data,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function updateContactMessageStatus(req, res) {
  try {
    const updated = await spaAndContactService.updateContactMessageStatus(
      req.params.id,
      req.body?.status
    );
    return res.status(200).json(updated);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function deleteContactMessage(req, res) {
  try {
    await spaAndContactService.deleteContactMessage(req.params.id);
    return res.status(200).json({ message: 'Đã xóa tin nhắn liên hệ.' });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

module.exports = {
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
