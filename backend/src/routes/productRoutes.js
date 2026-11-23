const router = require('express').Router();
const c = require('../controllers/productController');
const { requirePermission } = require('../middlewares/permission');

const canEdit = requirePermission('inventoryEdit');

router.get('/', c.getAll);
router.get('/low-stock', c.lowStock); // phải đứng trước '/:id'
router.get('/:id', c.getById);
router.post('/', canEdit, c.create);
router.put('/:id', canEdit, c.update);
router.patch('/:id/stock', canEdit, c.updateStock);
router.delete('/:id', canEdit, c.remove);

module.exports = router;