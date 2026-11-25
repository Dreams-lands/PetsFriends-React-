const dashboardModel = require('../models/dashboardModel');
const httpError = require('../utils/httpError');

const EMPTY = { revenue: 0, transfer: 0, cash: 0, orders: 0 };
const pad = (n) => String(n).padStart(2, '0');
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

exports.getOverview = async (role) => {
  const data = await dashboardModel.overview();
  if (role !== 'admin') data.monthRevenue = null; // staff không có quyền xem doanh thu
  return data;
};

exports.getRevenue = async ({ period = 'months', year, days }) => {
  const nowYear = new Date().getFullYear();

  if (period === 'months') {
    const y = year ? Number(year) : nowYear;
    if (!Number.isInteger(y) || y < 2000 || y > 2100) throw httpError(400, 'Năm không hợp lệ');
    const map = await dashboardModel.byMonth(y);
    const trend = Array.from({ length: 12 }, (_, i) => ({
      period: `T${i + 1}`,
      fullLabel: `Tháng ${pad(i + 1)}/${y}`,
      ...(map[i + 1] || EMPTY),
    }));
    return { period, label: `12 tháng trong năm (${y})`, trend, total: sum(trend) };
  }

  if (period === 'years') {
    const to = year ? Number(year) : nowYear;
    if (!Number.isInteger(to) || to < 2000 || to > 2100) throw httpError(400, 'Năm không hợp lệ');
    const map = await dashboardModel.byYear(to - 2, to);
    const trend = [to - 2, to - 1, to].map((y) => ({
      period: String(y), fullLabel: `Năm ${y}`, ...(map[y] || EMPTY),
    }));
    return { period, label: `Các năm (${to - 2} – ${to})`, trend, total: sum(trend) };
  }

  if (period === 'daily') {
    const n = days ? Number(days) : 7;
    if (!Number.isInteger(n) || n < 1 || n > 31) throw httpError(400, 'Số ngày phải từ 1 đến 31');
    const list = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      list.push(d);
    }
    const map = await dashboardModel.byDay(isoLocal(list[0]));
    const trend = list.map((d) => ({
      period: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`,
      date: isoLocal(d),
      ...(map[isoLocal(d)] || EMPTY),
    }));
    return { period, label: `${n} ngày gần nhất`, trend, total: sum(trend) };
  }

  throw httpError(400, 'period phải là months, years hoặc daily');
};

function sum(trend) {
  return trend.reduce((a, t) => ({
    revenue: a.revenue + t.revenue, transfer: a.transfer + t.transfer,
    cash: a.cash + t.cash, orders: a.orders + t.orders,
  }), { ...EMPTY });
}