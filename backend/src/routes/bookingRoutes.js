const router = require('express').Router();
const c = require('../controllers/bookingController');

router.get('/services', c.services); // phải đứng trước '/:id'
router.get('/', c.getAll);
router.get('/:id', c.getById);
router.post('/', c.create);
router.patch('/:id/status', c.changeStatus);

module.exports = router;