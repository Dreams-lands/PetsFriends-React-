const express = require('express');
const path = require('path');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
require('dotenv').config();
const { poolPromise } = require('./db');

const authAndUserRoutes = require('../backend/src/routes/authAndUserRoutes');
const productRoutes = require('../backend/src/routes/productRoutes');
const orderRoutes = require('../backend/src/routes/orderRoutes');
const spaAndContactRoutes = require('../backend/src/routes/spaAndContactRoutes');

const app = express();
const PORT = process.env.PORT || 5000;
const specPath = path.join(__dirname, 'specs', 'openapi.yaml');

app.use(cors());
app.use(express.json());

// Swagger UI
app.get('/openapi.json', (req, res) => {
  const swaggerDocument = YAML.load(specPath);
  res.json(swaggerDocument);
});

app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(null, {
    swaggerOptions: {
      url: '/openapi.json',
    },
  })
);

app.get('/', (req, res) => {
  res.redirect('/api-docs');
});

// Kiểm tra trạng thái kết nối API & SQL Server
app.get('/api/health', async (req, res) => {
  try {
    const pool = await poolPromise;
    await pool.request().query('SELECT 1 AS ok');
    res.status(200).json({
      status: 'OK',
      uptime: process.uptime(),
      message: 'API & SQL Server QLThuCung đang hoạt động tốt!',
    });
  } catch (err) {
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
});

// Gắn đầy đủ các phân hệ RESTful API
app.use('/api', authAndUserRoutes);
app.use('/api', productRoutes);
app.use('/api', orderRoutes);
app.use('/api', spaAndContactRoutes);

// Xử lý đường dẫn API không tồn tại
app.use('/api/*', (req, res) => {
  res.status(404).json({ message: `Không tìm thấy đường dẫn ${req.originalUrl}` });
});

app.listen(PORT, () => {
  console.log(`Server đang chạy tại: http://localhost:${PORT}`);
  console.log(`Swagger UI: http://localhost:${PORT}/api-docs`);
});