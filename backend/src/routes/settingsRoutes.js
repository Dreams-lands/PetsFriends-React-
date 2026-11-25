const router = require('express').Router();
const c = require('../controllers/settingsController');
const { requireRole } = require('../middlewares/auth');

router.get('/store', c.getStore);                                   // admin + staff
router.put('/store', requireRole('admin'), c.updateStore);          // chỉ admin
router.get('/permissions', c.getPermissions);                       // admin + staff (staff cần biết quyền của mình)
router.put('/permissions', requireRole('admin'), c.updatePermissions); // chỉ admin

module.exports = router;