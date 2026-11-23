const dashboardService = require('../services/dashboardService');
const asyncHandler = require('../utils/asyncHandler');

exports.overview = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await dashboardService.getOverview(req.user.role) });
});

exports.revenue = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await dashboardService.getRevenue(req.query) });
});