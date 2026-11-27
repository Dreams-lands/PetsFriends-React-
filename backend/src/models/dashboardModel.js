const { poolPromise } = require('../config/db');

const num = (v) => Number(v) || 0;

// Gom doanh thu từ đơn hàng và lịch hẹn đã hoàn thành
const REVENUE_CTE = `
WITH r AS (
  SELECT DATE(CreatedAt) AS d, CAST(TotalAmount AS SIGNED) AS amount,
         CASE WHEN LOWER(PaymentMethod) LIKE '%vnpay%'
                OR LOWER(PaymentMethod) LIKE '%momo%'
                OR LOWER(PaymentMethod) LIKE '%chuyển khoản%' THEN 1 ELSE 0 END AS isTransfer,
         1 AS isOrder
  FROM Orders WHERE OrderStatus = 'completed'
  UNION ALL
  SELECT BookingDate AS d, CAST(Price AS SIGNED) AS amount, 0 AS isTransfer, 0 AS isOrder
  FROM Bookings WHERE Status = 'completed'
)`;

const SUMS = `
  SUM(amount) AS revenue,
  SUM(CASE WHEN isTransfer = 1 THEN amount ELSE 0 END) AS transfer,
  SUM(CASE WHEN isTransfer = 0 THEN amount ELSE 0 END) AS cash,
  SUM(isOrder) AS orders`;

const clean = (r) => ({
  revenue: num(r.revenue),
  transfer: num(r.transfer),
  cash: num(r.cash),
  orders: num(r.orders),
});

const LOW_STOCK_THRESHOLD = 15;

exports.overview = async () => {
  const pool = await poolPromise;

  const [
    [revRows],
    [orderCntRows],
    [bookingCntRows],
    [lowStockCntRows],
    [pendingOrders],
    [upcomingBookings],
    [lowStockList],
  ] = await Promise.all([
    pool.query(`${REVENUE_CTE}
      SELECT IFNULL(SUM(amount), 0) AS monthRevenue FROM r
      WHERE YEAR(d) = YEAR(UTC_DATE()) AND MONTH(d) = MONTH(UTC_DATE())`),
    pool.query(
      "SELECT COUNT(*) AS totalOrders, IFNULL(SUM(CASE WHEN OrderStatus = 'pending' THEN 1 ELSE 0 END), 0) AS pendingOrders FROM Orders"
    ),
    pool.query(
      "SELECT COUNT(*) AS totalBookings, IFNULL(SUM(CASE WHEN Status = 'upcoming' THEN 1 ELSE 0 END), 0) AS upcomingBookings FROM Bookings"
    ),
    pool.query(
      `SELECT COUNT(*) AS lowStockCount FROM Products WHERE IsActive = 1 AND StockCount <= ${LOW_STOCK_THRESHOLD}`
    ),
    pool.query(`
      SELECT OrderId AS id, OrderCode AS orderCode, CustomerName AS customerName, PaymentMethod AS paymentMethod,
             TotalAmount AS totalAmount, CreatedAt AS createdAt,
             (SELECT IFNULL(SUM(Quantity), 0) FROM OrderItems WHERE OrderId = Orders.OrderId) AS itemCount
      FROM Orders WHERE OrderStatus = 'pending' ORDER BY CreatedAt DESC LIMIT 5
    `),
    pool.query(`
      SELECT Id AS id, ServiceName AS serviceName, PetName AS petName, BookingDate AS date,
             TimeSlot AS timeSlot, Price AS price
      FROM Bookings WHERE Status = 'upcoming' ORDER BY BookingDate, TimeSlot LIMIT 5
    `),
    pool.query(`
      SELECT ProductId AS id, Name AS name, StockCount AS stockCount, ${LOW_STOCK_THRESHOLD} AS lowStockThreshold
      FROM Products WHERE IsActive = 1 AND StockCount <= ${LOW_STOCK_THRESHOLD} ORDER BY StockCount LIMIT 5
    `),
  ]);

  return {
    monthRevenue: num(revRows[0]?.monthRevenue),
    totalOrders: num(orderCntRows[0]?.totalOrders),
    pendingOrders: num(orderCntRows[0]?.pendingOrders),
    totalBookings: num(bookingCntRows[0]?.totalBookings),
    upcomingBookings: num(bookingCntRows[0]?.upcomingBookings),
    lowStockCount: num(lowStockCntRows[0]?.lowStockCount),
    pendingOrderList: pendingOrders,
    upcomingBookingList: upcomingBookings.map((b) => ({
      ...b,
      date: b.date instanceof Date ? b.date.toISOString().slice(0, 10) : b.date,
    })),
    lowStockList,
  };
};

exports.byMonth = async (year) => {
  const pool = await poolPromise;
  const [rows] = await pool.query(
    `${REVENUE_CTE}
     SELECT MONTH(d) AS k, ${SUMS} FROM r WHERE YEAR(d) = ? GROUP BY MONTH(d)`,
    [year]
  );
  const map = {};
  rows.forEach((x) => {
    map[x.k] = clean(x);
  });
  return map;
};

exports.byYear = async (fromYear, toYear) => {
  const pool = await poolPromise;
  const [rows] = await pool.query(
    `${REVENUE_CTE}
     SELECT YEAR(d) AS k, ${SUMS} FROM r WHERE YEAR(d) BETWEEN ? AND ? GROUP BY YEAR(d)`,
    [fromYear, toYear]
  );
  const map = {};
  rows.forEach((x) => {
    map[x.k] = clean(x);
  });
  return map;
};

exports.byDay = async (fromDate) => {
  const pool = await poolPromise;
  const [rows] = await pool.query(
    `${REVENUE_CTE}
     SELECT d AS k, ${SUMS} FROM r WHERE d >= ? GROUP BY d`,
    [fromDate]
  );
  const map = {};
  rows.forEach((x) => {
    const key = x.k instanceof Date ? x.k.toISOString().slice(0, 10) : String(x.k).slice(0, 10);
    map[key] = clean(x);
  });
  return map;
};
