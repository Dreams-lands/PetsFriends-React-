const { sql, poolPromise } = require('../config/db');

const num = (v) => Number(v) || 0;

// Gom doanh thu từ đơn hàng và lịch hẹn đã hoàn thành
const REVENUE_CTE = `
WITH r AS (
  SELECT CAST(CreatedAt AS DATE) AS d, CAST(TotalAmount AS BIGINT) AS amount,
         CASE WHEN LOWER(PaymentMethod) LIKE N'%vnpay%'
                OR LOWER(PaymentMethod) LIKE N'%momo%'
                OR LOWER(PaymentMethod) LIKE N'%chuyển khoản%' THEN 1 ELSE 0 END AS isTransfer,
         1 AS isOrder
  FROM Orders WHERE Status = 'completed'
  UNION ALL
  SELECT BookingDate, CAST(Price AS BIGINT), 0, 0
  FROM Bookings WHERE Status = 'completed'
)`;

const SUMS = `
  SUM(amount) AS revenue,
  SUM(CASE WHEN isTransfer = 1 THEN amount ELSE 0 END) AS transfer,
  SUM(CASE WHEN isTransfer = 0 THEN amount ELSE 0 END) AS cash,
  SUM(isOrder) AS orders`;

const clean = (r) => ({
  revenue: num(r.revenue), transfer: num(r.transfer), cash: num(r.cash), orders: num(r.orders),
});

exports.overview = async () => {
  const pool = await poolPromise;

  const rev = await pool.request().query(`${REVENUE_CTE}
    SELECT ISNULL(SUM(amount), 0) AS monthRevenue FROM r
    WHERE YEAR(d) = YEAR(GETDATE()) AND MONTH(d) = MONTH(GETDATE())`);

  const r = await pool.request().query(`
    SELECT COUNT(*) AS totalOrders, ISNULL(SUM(CASE WHEN Status = 'pending' THEN 1 ELSE 0 END), 0) AS pendingOrders FROM Orders;
    SELECT COUNT(*) AS totalBookings, ISNULL(SUM(CASE WHEN Status = 'upcoming' THEN 1 ELSE 0 END), 0) AS upcomingBookings FROM Bookings;
    SELECT COUNT(*) AS lowStockCount FROM Products WHERE StockCount <= LowStockThreshold;
    SELECT TOP 5 Id AS id, CustomerName AS customerName, PaymentMethod AS paymentMethod,
           TotalAmount AS totalAmount, CreatedAt AS createdAt,
           (SELECT ISNULL(SUM(Quantity), 0) FROM OrderItems WHERE OrderId = Orders.Id) AS itemCount
    FROM Orders WHERE Status = 'pending' ORDER BY CreatedAt DESC;
    SELECT TOP 5 Id AS id, ServiceName AS serviceName, PetName AS petName, BookingDate AS date,
           TimeSlot AS timeSlot, Price AS price
    FROM Bookings WHERE Status = 'upcoming' ORDER BY BookingDate, TimeSlot;
    SELECT TOP 5 Id AS id, Name AS name, StockCount AS stockCount, LowStockThreshold AS lowStockThreshold
    FROM Products WHERE StockCount <= LowStockThreshold ORDER BY StockCount;
  `);
  const s = r.recordsets;

  return {
    monthRevenue: num(rev.recordset[0].monthRevenue),
    totalOrders: num(s[0][0].totalOrders),
    pendingOrders: num(s[0][0].pendingOrders),
    totalBookings: num(s[1][0].totalBookings),
    upcomingBookings: num(s[1][0].upcomingBookings),
    lowStockCount: num(s[2][0].lowStockCount),
    pendingOrderList: s[3],
    upcomingBookingList: s[4].map((b) => ({ ...b, date: b.date.toISOString().slice(0, 10) })),
    lowStockList: s[5],
  };
};

exports.byMonth = async (year) => {
  const pool = await poolPromise;
  const r = await pool.request().input('year', sql.Int, year).query(`${REVENUE_CTE}
    SELECT MONTH(d) AS k, ${SUMS} FROM r WHERE YEAR(d) = @year GROUP BY MONTH(d)`);
  const map = {};
  r.recordset.forEach((x) => { map[x.k] = clean(x); });
  return map;
};

exports.byYear = async (fromYear, toYear) => {
  const pool = await poolPromise;
  const r = await pool.request()
    .input('from', sql.Int, fromYear).input('to', sql.Int, toYear)
    .query(`${REVENUE_CTE}
      SELECT YEAR(d) AS k, ${SUMS} FROM r WHERE YEAR(d) BETWEEN @from AND @to GROUP BY YEAR(d)`);
  const map = {};
  r.recordset.forEach((x) => { map[x.k] = clean(x); });
  return map;
};

exports.byDay = async (fromDate) => {
  const pool = await poolPromise;
  const r = await pool.request().input('from', sql.Date, fromDate).query(`${REVENUE_CTE}
    SELECT d AS k, ${SUMS} FROM r WHERE d >= @from GROUP BY d`);
  const map = {};
  r.recordset.forEach((x) => { map[x.k.toISOString().slice(0, 10)] = clean(x); });
  return map;
};