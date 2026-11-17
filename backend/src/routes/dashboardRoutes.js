const router = require('express').Router();
const c = require('../controllers/dashboardController');
const { requirePermission } = require('../middlewares/permission');

router.get('/overview', c.overview);                                    // admin + staff
router.get('/revenue', requirePermission('analytics'), c.revenue);      // theo ma trận phân quyền

module.exports = router;