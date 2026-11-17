const userService = require('../services/userService');
const userExtraService = require('../services/userExtraService');

async function lookupByPhone(req, res) {
  try {
    const result = await userService.lookupByPhone(req.query.phone);
    return res.status(200).json(result);
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ found: false, message: err.message });
    }
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function listUsers(req, res) {
  try {
    const users = await userService.listUsers(req.query || {});
    return res.status(200).json({ data: users, users });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function createUser(req, res) {
  try {
    const user = await userService.createUserByAdmin(req.body || {});
    return res.status(201).json({
      message: 'Tạo người dùng thành công!',
      data: user,
      user,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function getUserById(req, res) {
  try {
    const user = await userService.getUserById(Number(req.params.id));
    return res.status(200).json({ data: user, user });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function updateUser(req, res) {
  try {
    const user = await userService.updateUserByAdmin(Number(req.params.id), req.body || {});
    return res.status(200).json({
      message: 'Cập nhật người dùng thành công!',
      data: user,
      user,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function updateUserRole(req, res) {
  try {
    const user = await userService.updateUserRole(
      Number(req.params.id),
      req.body ? req.body.role : undefined
    );
    return res.status(200).json({
      message: 'Đã cập nhật vai trò người dùng.',
      user,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function updateUserStatus(req, res) {
  try {
    const user = await userService.updateUserStatus(
      Number(req.params.id),
      req.body ? req.body.status : undefined
    );
    return res.status(200).json({
      message: 'Đã cập nhật trạng thái tài khoản.',
      user,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function deleteUser(req, res) {
  try {
    await userService.deleteUserByAdmin(
      Number(req.params.id),
      req.user?.userId || null
    );
    return res.status(200).json({
      message: 'Đã xóa người dùng thành công!',
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function updateProfile(req, res) {
  try {
    const user = await userService.updateProfile(Number(req.params.id), req.body || {});
    return res.status(200).json({
      message: 'Đã cập nhật hồ sơ thành công!',
      user,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function changePassword(req, res) {
  try {
    await userService.changePassword(Number(req.params.id), req.body || {});
    return res.status(200).json({
      message: 'Đổi mật khẩu thành công!',
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function listAllAddresses(req, res) {
  try {
    const addresses = await userService.listAllAddresses();
    return res.status(200).json(addresses);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function getUserAddresses(req, res) {
  try {
    const addresses = await userService.getUserAddresses(Number(req.params.userId));
    return res.status(200).json(addresses);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function addUserAddress(req, res) {
  try {
    const address = await userService.addUserAddress(
      Number(req.params.userId),
      req.body || {}
    );
    return res.status(201).json(address);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function updateUserAddress(req, res) {
  try {
    const address = await userService.updateUserAddress(
      Number(req.params.userId),
      Number(req.params.addressId),
      req.body || {}
    );
    return res.status(200).json(address);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function setDefaultUserAddress(req, res) {
  try {
    const address = await userService.setDefaultUserAddress(
      Number(req.params.userId),
      Number(req.params.addressId)
    );
    return res.status(200).json(address);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function deleteUserAddress(req, res) {
  try {
    await userService.deleteUserAddress(
      Number(req.params.userId),
      Number(req.params.addressId)
    );
    return res.status(200).json({
      message: 'Đã xóa địa chỉ nhận hàng.',
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function getUserWishlist(req, res) {
  try {
    const result = await userExtraService.getUserWishlist(Number(req.params.userId));
    return res.status(200).json(result);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function addToWishlist(req, res) {
  try {
    const body = req.body || {};
    const rawProductId = body.productId || body.id;
    const { productId, productIds } = await userExtraService.addToWishlist(
      Number(req.params.userId),
      rawProductId
    );
    return res.status(201).json({
      message: 'Đã thêm sản phẩm vào danh sách yêu thích.',
      productId,
      wishlist: productIds,
      productIds,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function removeFromWishlist(req, res) {
  try {
    const { productId, productIds } = await userExtraService.removeFromWishlist(
      Number(req.params.userId),
      req.params.productId
    );
    return res.status(200).json({
      message: 'Đã xóa khỏi danh sách yêu thích.',
      productId,
      wishlist: productIds,
      productIds,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function getStaffRoster(req, res) {
  try {
    const result = await userExtraService.getStaffRoster();
    return res.status(200).json(result);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function replaceStaffRoster(req, res) {
  try {
    const body = req.body;
    const names = Array.isArray(body)
      ? body
      : body?.staffRoster || body?.names || body;
    const { staffRoster } = await userExtraService.replaceStaffRoster(names);
    return res.status(200).json({
      message: 'Đã cập nhật danh sách nhân viên trực.',
      staffRoster,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function addStaffMember(req, res) {
  try {
    const body = req.body || {};
    const name = body.staffName || body.name;
    const { staffRoster } = await userExtraService.addStaffMember(name);
    return res.status(201).json({
      message: 'Đã thêm nhân viên trực.',
      staffRoster,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function removeStaffMember(req, res) {
  try {
    const decodedName = decodeURIComponent(req.params.name);
    const { staffRoster } = await userExtraService.removeStaffMember(decodedName);
    return res.status(200).json({
      message: 'Đã xóa nhân viên khỏi danh sách trực.',
      staffRoster,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function getStaffPermissions(req, res) {
  try {
    const permissions = await userExtraService.getStaffPermissions();
    return res.status(200).json({ permissions });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function updateStaffPermissions(req, res) {
  try {
    const body = req.body;
    const payload =
      body && typeof body === 'object' && !Array.isArray(body)
        ? body.permissions || body
        : body;
    const permissions = await userExtraService.updateStaffPermissions(payload);
    return res.status(200).json({
      message: 'Đã lưu phân quyền nhân viên.',
      permissions,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message });
  }
}

module.exports = {
  lookupByPhone,
  listUsers,
  createUser,
  getUserById,
  updateUser,
  updateUserRole,
  updateUserStatus,
  deleteUser,
  updateProfile,
  changePassword,
  listAllAddresses,
  getUserAddresses,
  addUserAddress,
  updateUserAddress,
  setDefaultUserAddress,
  deleteUserAddress,
  getUserWishlist,
  addToWishlist,
  removeFromWishlist,
  getStaffRoster,
  replaceStaffRoster,
  addStaffMember,
  removeStaffMember,
  getStaffPermissions,
  updateStaffPermissions,
};
