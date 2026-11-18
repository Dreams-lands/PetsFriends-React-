const orderService = require('../services/orderService');

function sendError(res, err) {
  const statusCode = err?.statusCode || 500;
  return res.status(statusCode).json({
    message: err?.message || 'Lỗi máy chủ nội bộ.',
  });
}

async function listOrders(req, res) {
  try {
    const orders = await orderService.listOrders(req.query);
    return res.status(200).json(orders);
  } catch (err) {
    return sendError(res, err);
  }
}

async function lookupGuestOrder(req, res) {
  try {
    const order = await orderService.lookupGuestOrder(req.query);
    return res.status(200).json(order);
  } catch (err) {
    return sendError(res, err);
  }
}

async function getOrderById(req, res) {
  try {
    const order = await orderService.getOrderById(req.params.id);
    return res.status(200).json(order);
  } catch (err) {
    return sendError(res, err);
  }
}

async function getOrderItemsByOrderId(req, res) {
  try {
    const items = await orderService.getOrderItemsByOrderId(req.params.id);
    return res.status(200).json(items);
  } catch (err) {
    return sendError(res, err);
  }
}

async function createOrder(req, res) {
  try {
    const result = await orderService.createOrder(req.body);
    return res.status(201).json(result);
  } catch (err) {
    return sendError(res, err);
  }
}

async function updateOrderStatus(req, res) {
  try {
    const updatedOrder = await orderService.updateOrderStatus(
      req.params.id,
      req.body
    );
    return res.status(200).json(updatedOrder);
  } catch (err) {
    return sendError(res, err);
  }
}

async function cancelOrder(req, res) {
  try {
    const phone = (req.body && req.body.phone) || (req.query && req.query.phone) || '';
    const result = await orderService.cancelOrder(req.params.id, {
      requester: req.user || null,
      phone,
    });
    return res.status(200).json(result);
  } catch (err) {
    return sendError(res, err);
  }
}

async function deleteOrder(req, res) {
  try {
    const result = await orderService.deleteOrder(req.params.id);
    return res.status(200).json(result);
  } catch (err) {
    return sendError(res, err);
  }
}

async function listOrderItems(req, res) {
  try {
    const items = await orderService.listOrderItems(req.query);
    return res.status(200).json(items);
  } catch (err) {
    return sendError(res, err);
  }
}

async function getAnalyticsOverview(req, res) {
  try {
    const overview = await orderService.getAnalyticsOverview();
    return res.status(200).json(overview);
  } catch (err) {
    return sendError(res, err);
  }
}

async function getAnalyticsDaily(req, res) {
  try {
    const daily = await orderService.getAnalyticsDaily(req.query);
    return res.status(200).json(daily);
  } catch (err) {
    return sendError(res, err);
  }
}

async function getAnalyticsPeriod(req, res) {
  try {
    const periodStats = await orderService.getAnalyticsPeriod(req.query);
    return res.status(200).json(periodStats);
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = {
  listOrders,
  lookupGuestOrder,
  getOrderById,
  getOrderItemsByOrderId,
  createOrder,
  updateOrderStatus,
  cancelOrder,
  deleteOrder,
  listOrderItems,
  getAnalyticsOverview,
  getAnalyticsDaily,
  getAnalyticsPeriod,
};
