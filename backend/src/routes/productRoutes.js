const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../../../api/db');
const { mapProductRow, mapReviewRow, parseMoneyNumber } = require('../utils/mappers');

// 1. Lấy danh sách danh mục
router.get('/categories', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT CategoryCode, Name FROM dbo.Categories');
    res.status(200).json(
      result.recordset.map((c) => ({
        id: c.CategoryCode,
        categoryCode: c.CategoryCode,
        label: c.Name,
        name: c.Name,
      }))
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 2. Lấy danh sách sản phẩm (kèm đánh giá và bộ lọc đầy đủ)
router.get('/products', async (req, res) => {
  const {
    category,
    petType,
    subType,
    minPrice,
    maxPrice,
    promoOnly,
    lowStock,
    search,
    sort,
    includeInactive,
  } = req.query;

  try {
    const pool = await poolPromise;
    const request = pool.request();
    let query = 'SELECT * FROM dbo.Products WHERE 1=1';

    if (includeInactive !== 'true') {
      query += ' AND IsActive = 1';
    }
    if (category && category !== 'all') {
      query += ' AND CategoryCode = @category';
      request.input('category', sql.NVarChar(30), String(category));
    }
    if (petType && petType !== 'all') {
      query += " AND (PetType = @petType OR PetType = N'both')";
      request.input('petType', sql.NVarChar(10), String(petType));
    }
    if (subType) {
      query += ' AND SubType = @subType';
      request.input('subType', sql.NVarChar(100), String(subType));
    }
    if (minPrice !== undefined && minPrice !== '') {
      query += ' AND Price >= @minPrice';
      request.input('minPrice', sql.Decimal(18, 0), Number(minPrice));
    }
    if (maxPrice !== undefined && maxPrice !== '') {
      query += ' AND Price <= @maxPrice';
      request.input('maxPrice', sql.Decimal(18, 0), Number(maxPrice));
    }
    if (promoOnly === 'true') {
      query += ' AND OriginalPrice IS NOT NULL AND OriginalPrice > Price';
    }
    if (lowStock === 'true') {
      query += ' AND StockCount <= 15';
    }
    if (search && String(search).trim()) {
      query += ` AND (
        Name LIKE @search OR Brand LIKE @search OR ProductId LIKE @search
        OR ShortDesc LIKE @search OR SubType LIKE @search
      )`;
      request.input('search', sql.NVarChar(220), `%${String(search).trim()}%`);
    }

    if (sort === 'price-asc') {
      query += ' ORDER BY Price ASC';
    } else if (sort === 'price-desc') {
      query += ' ORDER BY Price DESC';
    } else {
      query += ' ORDER BY IsFeatured DESC, CreatedAt DESC';
    }

    const [prodRes, revRes] = await Promise.all([
      request.query(query),
      pool.request().query('SELECT * FROM dbo.ProductReviews ORDER BY CreatedAt DESC'),
    ]);

    const reviewsByProduct = {};
    for (const r of revRes.recordset) {
      if (!reviewsByProduct[r.ProductId]) reviewsByProduct[r.ProductId] = [];
      reviewsByProduct[r.ProductId].push(mapReviewRow(r));
    }

    let items = prodRes.recordset.map((row) =>
      mapProductRow(row, reviewsByProduct[row.ProductId] || [])
    );

    if (sort === 'rating') {
      items = items.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);
    }

    res.status(200).json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 3. Lấy chi tiết 1 sản phẩm theo SKU
router.get('/products/:id', async (req, res) => {
  try {
    const pool = await poolPromise;
    const prodRes = await pool
      .request()
      .input('id', sql.NVarChar(60), req.params.id)
      .query('SELECT * FROM dbo.Products WHERE ProductId = @id');

    if (prodRes.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
    }

    const revRes = await pool
      .request()
      .input('id', sql.NVarChar(60), req.params.id)
      .query('SELECT * FROM dbo.ProductReviews WHERE ProductId = @id ORDER BY CreatedAt DESC');

    const reviews = revRes.recordset.map(mapReviewRow);
    res.status(200).json(mapProductRow(prodRes.recordset[0], reviews));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 4. Thêm sản phẩm mới (AdminInventoryView)
router.post('/products', async (req, res) => {
  const body = req.body;
  const productId = String(body.id || body.productId || `prod-custom-${Date.now().toString().slice(-5)}`).trim();
  const brand = String(body.brand || 'PETSFRIEND SELECT').trim();
  const name = String(body.name || '').trim();
  const categoryCode = String(body.category || body.categoryCode || 'food').trim();
  const petType = ['dog', 'cat', 'both'].includes(body.petType) ? body.petType : 'both';
  const priceNum = parseMoneyNumber(body.priceNum ?? body.price);
  const origNum = parseMoneyNumber(body.originalPriceNum ?? body.originalPrice);
  const primaryImage = String(body.image || body.primaryImage || '/images/prod-ceramic-bowl.jpg').trim();
  const sizesStr = Array.isArray(body.sizes)
    ? body.sizes.join(', ')
    : String(body.sizes || body.packSize || 'Tiêu chuẩn');

  if (!name || priceNum === null) {
    return res.status(400).json({ message: 'Tên sản phẩm và giá bán là bắt buộc.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('productId', sql.NVarChar(60), productId)
      .input('brand', sql.NVarChar(100), brand)
      .input('name', sql.NVarChar(200), name)
      .input('shortDesc', sql.NVarChar(400), body.shortDesc || body.description || null)
      .input('categoryCode', sql.NVarChar(30), categoryCode)
      .input('subType', sql.NVarChar(100), body.subType || null)
      .input('petType', sql.NVarChar(10), petType)
      .input('sizes', sql.NVarChar(200), sizesStr)
      .input('price', sql.Decimal(18, 0), priceNum)
      .input('originalPrice', sql.Decimal(18, 0), origNum && origNum > priceNum ? origNum : null)
      .input('primaryImage', sql.NVarChar(500), primaryImage)
      .input('stockCount', sql.Int, Math.max(0, Number(body.stockCount ?? 0)))
      .input('isFeatured', sql.Bit, body.isFeatured ? 1 : 0)
      .query(`
        INSERT INTO dbo.Products (
          ProductId, Brand, Name, ShortDesc, CategoryCode, SubType,
          PetType, Sizes, Price, OriginalPrice, PrimaryImage, StockCount, IsFeatured
        )
        OUTPUT INSERTED.*
        VALUES (
          @productId, @brand, @name, @shortDesc, @categoryCode, @subType,
          @petType, @sizes, @price, @originalPrice, @primaryImage, @stockCount, @isFeatured
        )
      `);

    res.status(201).json(mapProductRow(result.recordset[0], []));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 5. Cập nhật sản phẩm (AdminInventoryView)
router.put('/products/:id', async (req, res) => {
  const id = req.params.id;
  const body = req.body;
  const priceNum = parseMoneyNumber(body.priceNum ?? body.price);
  const origNum = parseMoneyNumber(body.originalPriceNum ?? body.originalPrice);
  const petType = ['dog', 'cat', 'both'].includes(body.petType) ? body.petType : 'both';
  const sizesStr = Array.isArray(body.sizes)
    ? body.sizes.join(', ')
    : String(body.sizes || body.packSize || 'Tiêu chuẩn');

  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('id', sql.NVarChar(60), id)
      .input('brand', sql.NVarChar(100), String(body.brand || 'PETSFRIEND').trim())
      .input('name', sql.NVarChar(200), String(body.name || '').trim())
      .input('shortDesc', sql.NVarChar(400), body.shortDesc || body.description || null)
      .input('categoryCode', sql.NVarChar(30), String(body.category || body.categoryCode || 'food'))
      .input('subType', sql.NVarChar(100), body.subType || null)
      .input('petType', sql.NVarChar(10), petType)
      .input('sizes', sql.NVarChar(200), sizesStr)
      .input('price', sql.Decimal(18, 0), priceNum ?? 0)
      .input('originalPrice', sql.Decimal(18, 0), origNum && priceNum && origNum > priceNum ? origNum : null)
      .input('primaryImage', sql.NVarChar(500), String(body.image || body.primaryImage || '/images/prod-ceramic-bowl.jpg'))
      .input('stockCount', sql.Int, Math.max(0, Number(body.stockCount ?? 0)))
      .input('isFeatured', sql.Bit, body.isFeatured ? 1 : 0)
      .input('isActive', sql.Bit, body.isActive === false ? 0 : 1)
      .query(`
        UPDATE dbo.Products
        SET Brand = @brand, Name = @name, ShortDesc = @shortDesc, CategoryCode = @categoryCode,
            SubType = @subType, PetType = @petType, Sizes = @sizes, Price = @price,
            OriginalPrice = @originalPrice, PrimaryImage = @primaryImage,
            StockCount = @stockCount, IsFeatured = @isFeatured, IsActive = @isActive
        OUTPUT INSERTED.*
        WHERE ProductId = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy sản phẩm để cập nhật.' });
    }

    const revRes = await pool
      .request()
      .input('id', sql.NVarChar(60), id)
      .query('SELECT * FROM dbo.ProductReviews WHERE ProductId = @id ORDER BY CreatedAt DESC');

    res.status(200).json(mapProductRow(result.recordset[0], revRes.recordset.map(mapReviewRow)));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 6. Điều chỉnh nhanh số lượng tồn kho
router.patch('/products/:id/stock', async (req, res) => {
  const { stockCount } = req.body;
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('id', sql.NVarChar(60), req.params.id)
      .input('stockCount', sql.Int, Math.max(0, Number(stockCount || 0)))
      .query('UPDATE dbo.Products SET StockCount = @stockCount OUTPUT INSERTED.* WHERE ProductId = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
    }
    res.status(200).json(mapProductRow(result.recordset[0], []));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 7. Xóa mềm sản phẩm (giữ toàn vẹn lịch sử OrderItems)
router.delete('/products/:id', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('id', sql.NVarChar(60), req.params.id)
      .query('UPDATE dbo.Products SET IsActive = 0 WHERE ProductId = @id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Không tìm thấy sản phẩm.' });
    }
    res.status(200).json({ message: 'Đã xóa sản phẩm khỏi danh mục cửa hàng.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 8. Đánh giá sản phẩm
router.get('/product-reviews', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM dbo.ProductReviews ORDER BY CreatedAt DESC');
    res.status(200).json(result.recordset.map(mapReviewRow));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/products/:id/reviews', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('id', sql.NVarChar(60), req.params.id)
      .query('SELECT * FROM dbo.ProductReviews WHERE ProductId = @id ORDER BY CreatedAt DESC');
    res.status(200).json(result.recordset.map(mapReviewRow));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/products/:id/reviews', async (req, res) => {
  const { userId, author, authorName, petTag, rating, comment } = req.body;
  const resolvedAuthor = String(author || authorName || 'Hội viên PetsFriend').trim();
  const resolvedComment = String(comment || '').trim();
  const safeRating = Math.min(5, Math.max(1, Number(rating || 5)));

  if (!resolvedComment) {
    return res.status(400).json({ message: 'Vui lòng nhập nội dung nhận xét.' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('productId', sql.NVarChar(60), req.params.id)
      .input('userId', sql.Int, userId ? Number(userId) : null)
      .input('authorName', sql.NVarChar(120), resolvedAuthor)
      .input('petTag', sql.NVarChar(100), petTag ? String(petTag).trim() : 'Hội viên PetsFriend')
      .input('rating', sql.TinyInt, safeRating)
      .input('comment', sql.NVarChar(1000), resolvedComment)
      .query(`
        INSERT INTO dbo.ProductReviews (ProductId, UserId, AuthorName, PetTag, Rating, Comment)
        OUTPUT INSERTED.*
        VALUES (@productId, @userId, @authorName, @petTag, @rating, @comment)
      `);

    res.status(201).json(mapReviewRow(result.recordset[0]));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;