const express = require('express');
const router = express.Router();

const {
  verifyToken,
  optionalAuth,
  requireRole,
  requireSelfOrAdmin,
} = require('../middlewares/authMiddleware');
const authController = require('../controllers/authController');
const userController = require('../controllers/userController');

// 1-4. Xác thực & tài khoản hiện tại (Auth)
router.post('/auth/login', authController.login);
router.post('/auth/register', authController.register);
router.get('/auth/me', verifyToken, authController.getMe);
router.put('/auth/change-password', verifyToken, authController.changePassword);

// 5. Tra cứu nhanh hội viên bằng SĐT tại quầy POS (ĐẶT TRƯỚC /users/:id)
router.get(
  '/users/lookup-phone',
  optionalAuth,
  requireRole('admin', 'staff'),
  userController.lookupByPhone
);

// 6-14. Quản trị người dùng & Hồ sơ cá nhân
router.get('/users', optionalAuth, requireRole('admin', 'staff'), userController.listUsers);
router.post('/users', optionalAuth, requireRole('admin'), userController.createUser);
router.get('/users/:id', optionalAuth, requireSelfOrAdmin('id'), userController.getUserById);
router.put('/users/:id', optionalAuth, requireRole('admin'), userController.updateUser);
router.patch(
  '/users/:id/role',
  optionalAuth,
  requireRole('admin'),
  userController.updateUserRole
);
router.patch(
  '/users/:id/status',
  optionalAuth,
  requireRole('admin'),
  userController.updateUserStatus
);
router.delete('/users/:id', optionalAuth, requireRole('admin'), userController.deleteUser);
router.put(
  '/users/:id/profile',
  optionalAuth,
  requireSelfOrAdmin('id'),
  userController.updateProfile
);
router.put(
  '/users/:id/password',
  optionalAuth,
  requireSelfOrAdmin('id'),
  userController.changePassword
);

// 15-20. Sổ địa chỉ nhận hàng
router.get(
  '/user-addresses',
  optionalAuth,
  requireRole('admin', 'staff'),
  userController.listAllAddresses
);
router.get(
  '/users/:userId/addresses',
  optionalAuth,
  requireSelfOrAdmin('userId'),
  userController.getUserAddresses
);
router.post(
  '/users/:userId/addresses',
  optionalAuth,
  requireSelfOrAdmin('userId'),
  userController.addUserAddress
);
router.put(
  '/users/:userId/addresses/:addressId',
  optionalAuth,
  requireSelfOrAdmin('userId'),
  userController.updateUserAddress
);
router.patch(
  '/users/:userId/addresses/:addressId/default',
  optionalAuth,
  requireSelfOrAdmin('userId'),
  userController.setDefaultUserAddress
);
router.delete(
  '/users/:userId/addresses/:addressId',
  optionalAuth,
  requireSelfOrAdmin('userId'),
  userController.deleteUserAddress
);

// 21-23. Danh sách sản phẩm yêu thích (Wishlist)
router.get(
  '/users/:userId/wishlist',
  optionalAuth,
  requireSelfOrAdmin('userId'),
  userController.getUserWishlist
);
router.post(
  '/users/:userId/wishlist',
  optionalAuth,
  requireSelfOrAdmin('userId'),
  userController.addToWishlist
);
router.delete(
  '/users/:userId/wishlist/:productId',
  optionalAuth,
  requireSelfOrAdmin('userId'),
  userController.removeFromWishlist
);

// 24-27. Danh sách nhân viên trực (Staff Roster)
router.get('/staff-roster', userController.getStaffRoster);
router.put(
  '/staff-roster',
  optionalAuth,
  requireRole('admin'),
  userController.replaceStaffRoster
);
router.post(
  '/staff-roster',
  optionalAuth,
  requireRole('admin'),
  userController.addStaffMember
);
router.delete(
  '/staff-roster/:name',
  optionalAuth,
  requireRole('admin'),
  userController.removeStaffMember
);

// 28-29. Phân quyền nhân viên (Staff Permissions)
router.get('/staff-permissions', userController.getStaffPermissions);
router.put(
  '/staff-permissions',
  optionalAuth,
  requireRole('admin'),
  userController.updateStaffPermissions
);

module.exports = router;
