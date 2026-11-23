const express = require('express');
const cors = require('cors');
require('dotenv').config();
require('./config/db');

const userRoutes = require('./routes/userRoutes');
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const { requireAuth, requireAdmin, requireRole } = require('./middlewares/auth');
const { requirePermission } = require('./middlewares/permission');
const errorHandler = require('./middlewares/errorHandler');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', message: 'QLThuCung API is running' } });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', requireAuth, requireAdmin, userRoutes);
app.use('/api/products', requireAuth, requirePermission('inventoryView'), productRoutes);
app.use('/api/orders', requireAuth, requirePermission('ordersManage'), orderRoutes);
app.use('/api/bookings', requireAuth, requirePermission('appointments'), bookingRoutes);
app.use('/api/dashboard', requireAuth, requireRole('admin', 'staff'), dashboardRoutes);
app.use('/api/payments', requireAuth, requireRole('admin', 'staff'), paymentRoutes);
app.use('/api/settings', requireAuth, requireRole('admin', 'staff'), settingsRoutes);

app.use((req, res) => res.status(404).json({ success: false, message: 'Không tìm thấy đường dẫn' }));
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend chay tai http://localhost:${PORT}/api`));