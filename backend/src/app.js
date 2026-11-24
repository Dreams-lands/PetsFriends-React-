const express = require('express');
const cors = require('cors');
require('dotenv').config();
require('./config/db');

const authAndUserRoutes = require('./routes/authAndUserRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const spaAndContactRoutes = require('./routes/spaAndContactRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const { requireAuth, requireRole } = require('./middlewares/auth');
const { requirePermission } = require('./middlewares/permission');
const errorHandler = require('./middlewares/errorHandler');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', message: 'QLThuCung API is running' } });
});

// Routes có sẵn của Backend-Database
app.use('/api', authAndUserRoutes);
app.use('/api', productRoutes);
app.use('/api', orderRoutes);
app.use('/api', paymentRoutes);
app.use('/api', spaAndContactRoutes);

// Routes mới bổ sung từ khanh-backend
app.use('/api/bookings', requireAuth, requirePermission('appointments'), bookingRoutes);
app.use('/api/dashboard', requireAuth, requireRole('admin', 'staff'), dashboardRoutes);
app.use('/api/settings', requireAuth, requireRole('admin', 'staff'), settingsRoutes);

app.use((req, res) => res.status(404).json({ success: false, message: 'Không tìm thấy đường dẫn' }));
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend chay tai http://localhost:${PORT}/api`));