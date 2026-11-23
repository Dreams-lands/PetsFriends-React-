const router = require('express').Router();
const c = require('../controllers/paymentController');
const { requireRole } = require('../middlewares/auth');

router.get('/settings', requireRole('admin'), c.getSettings);
router.put('/settings', requireRole('admin'), c.updateSettings);
router.patch('/orders/:id', requireRole('admin', 'staff'), c.setOrderPayment);

module.exports = router;