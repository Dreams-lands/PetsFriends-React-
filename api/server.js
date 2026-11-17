const express = require('express');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

const app = express();
const PORT = process.env.PORT || 3001;
const specPath = path.join(__dirname, 'specs', 'openapi.yaml');

// Trả về file đặc tả dạng JSON để Swagger UI luôn cập nhật khi sửa openapi.yaml
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

app.listen(PORT, () => {
  console.log(`Swagger UI dang chay tai: http://localhost:${PORT}/api-docs`);
});
