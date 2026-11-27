const express = require('express');
const router = express.Router();
const { optionalAuth, requireRole } = require('../middlewares/authMiddleware');
const spaAndContactController = require('../controllers/spaAndContactController');

// 1. Spa Packages (SpaPackages)
router.get('/spa-packages', spaAndContactController.listSpaPackages);
router.get('/spa-packages/:id', spaAndContactController.getSpaPackageById);
router.post(
  '/spa-packages',
  optionalAuth,
  requireRole('admin'),
  spaAndContactController.createSpaPackage
);
router.put(
  '/spa-packages/:id',
  optionalAuth,
  requireRole('admin'),
  spaAndContactController.updateSpaPackage
);
router.delete(
  '/spa-packages/:id',
  optionalAuth,
  requireRole('admin'),
  spaAndContactController.deleteSpaPackage
);

// 2. Service Bookings (ServiceBookings)
router.get('/service-bookings', spaAndContactController.listServiceBookings);
// Guest Booking Lookup — MUST be mounted before /service-bookings/:id
router.get('/service-bookings/lookup', spaAndContactController.lookupServiceBooking);
router.get('/service-bookings/:id', spaAndContactController.getServiceBookingById);
router.post(
  '/service-bookings',
  optionalAuth,
  spaAndContactController.createServiceBooking
);
router.put(
  '/service-bookings/:id',
  optionalAuth,
  requireRole('admin', 'staff'),
  spaAndContactController.updateServiceBooking
);
router.patch(
  '/service-bookings/:id',
  optionalAuth,
  requireRole('admin', 'staff'),
  spaAndContactController.updateServiceBooking
);
router.patch(
  '/service-bookings/:id/status',
  optionalAuth,
  requireRole('admin', 'staff'),
  spaAndContactController.updateServiceBooking
);
router.patch(
  '/service-bookings/:id/assign-staff',
  optionalAuth,
  requireRole('admin', 'staff'),
  spaAndContactController.updateServiceBooking
);
router.post(
  '/service-bookings/:id/cancel',
  optionalAuth,
  spaAndContactController.cancelServiceBooking
);
router.delete(
  '/service-bookings/:id',
  optionalAuth,
  requireRole('admin'),
  spaAndContactController.deleteServiceBooking
);

// 3. Contact Messages (ContactMessages)
router.get(
  '/contact-messages',
  optionalAuth,
  requireRole('admin', 'staff'),
  spaAndContactController.listContactMessages
);
router.get(
  '/contact-messages/:id',
  optionalAuth,
  requireRole('admin', 'staff'),
  spaAndContactController.getContactMessageById
);
router.post('/contact-messages', spaAndContactController.createContactMessage);
router.patch(
  '/contact-messages/:id/status',
  optionalAuth,
  requireRole('admin', 'staff'),
  spaAndContactController.updateContactMessageStatus
);
router.delete(
  '/contact-messages/:id',
  optionalAuth,
  requireRole('admin'),
  spaAndContactController.deleteContactMessage
);

module.exports = router;
