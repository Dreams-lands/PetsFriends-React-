const { poolPromise } = require('../../../api/db');
const { mapProductRow, mapReviewRow, parseMoneyNumber } = require('../utils/mappers');
const { AppError } = require('../services/userService');

function mapCategoryRow(row) {
  return {
    id: row.CategoryCode,
    categoryCode: row.CategoryCode,
    label: row.Name,
    name: row.Name,
    productCount: Number(row.ProductCount ?? 0),
  };
}

function parseStrictNonNegativePrice(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) {
      throw new AppError('Giá bán sản phẩm phải là số không âm.', 400);
    }
    return Math.round(raw);
  }
  const str = String(raw).trim();
  if (!str) return null;
  if (str.startsWith('-') || str.startsWith('−')) {
    throw new AppError('Giá bán sản phẩm không được âm.', 400);
  }
  const parsed = parseMoneyNumber(str);
  if (parsed === null || !Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.round(parsed);
}

async function attachReviewsToProducts(pool, productRows) {
  if (!Array.isArray(productRows) || productRows.length === 0) {
    return [];
  }

  const uniqueProductIds = [...new Set(productRows.map((r) => r.ProductId).filter(Boolean))];
  const reviewsByProduct = {};

  if (uniqueProductIds.length > 0) {
    const placeholders = uniqueProductIds.map(() => '?').join(', ');
    const [revRows] = await pool.query(
      `
        SELECT *
        FROM ProductReviews
        WHERE ProductId IN (${placeholders})
        ORDER BY CreatedAt DESC, ReviewId DESC
      `,
      uniqueProductIds
    );

    for (const r of revRows) {
      if (!reviewsByProduct[r.ProductId]) {
        reviewsByProduct[r.ProductId] = [];
      }
      reviewsByProduct[r.ProductId].push(mapReviewRow(r));
    }
  }

  return productRows.map((row) =>
    mapProductRow(row, reviewsByProduct[row.ProductId] || [])
  );
}

// ============================================================================
// 1. CATEGORIES (Categories)
// ============================================================================

async function listCategories() {
  const pool = await poolPromise;
  const [rows] = await pool.query(`
    SELECT
      c.CategoryCode,
      c.Name,
      COUNT(p.ProductId) AS ProductCount
    FROM Categories c
    LEFT JOIN Products p
      ON p.CategoryCode = c.CategoryCode AND p.IsActive = 1
    GROUP BY c.CategoryCode, c.Name
    ORDER BY c.CategoryCode ASC
  `);

  return rows.map(mapCategoryRow);
}

async function getCategoryByCode(code) {
  const cleanCode = String(code || '').trim();
  if (!cleanCode) {
    throw new AppError('Mã danh mục không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const [rows] = await pool.query(
    `
      SELECT
        c.CategoryCode,
        c.Name,
        COUNT(p.ProductId) AS ProductCount
      FROM Categories c
      LEFT JOIN Products p
        ON p.CategoryCode = c.CategoryCode AND p.IsActive = 1
      WHERE c.CategoryCode = ?
      GROUP BY c.CategoryCode, c.Name
    `,
    [cleanCode]
  );

  if (rows.length === 0) {
    throw new AppError('Không tìm thấy danh mục sản phẩm.', 404);
  }

  return mapCategoryRow(rows[0]);
}

async function createCategory(payload = {}) {
  const code = String(payload.categoryCode ?? payload.id ?? '').trim();
  const name = String(payload.name ?? payload.label ?? '').trim();

  if (!code || !name) {
    throw new AppError('Mã danh mục và tên danh mục là bắt buộc.', 400);
  }
  if (code.length > 30) {
    throw new AppError('Mã danh mục không được vượt quá 30 ký tự.', 400);
  }

  const pool = await poolPromise;
  const [dupRows] = await pool.query(
    'SELECT CategoryCode FROM Categories WHERE CategoryCode = ?',
    [code]
  );

  if (dupRows.length > 0) {
    throw new AppError('Mã danh mục đã tồn tại.', 409);
  }

  await pool.query(
    'INSERT INTO Categories (CategoryCode, Name) VALUES (?, ?)',
    [code, name.slice(0, 100)]
  );

  const [insertedRows] = await pool.query(
    'SELECT * FROM Categories WHERE CategoryCode = ?',
    [code]
  );
  return mapCategoryRow({ ...insertedRows[0], ProductCount: 0 });
}

async function updateCategory(code, payload = {}) {
  const cleanCode = String(code || '').trim();
  const name = String(payload.name ?? payload.label ?? '').trim();

  if (!cleanCode) {
    throw new AppError('Mã danh mục không hợp lệ.', 400);
  }
  if (!name) {
    throw new AppError('Tên danh mục không được để trống.', 400);
  }

  const pool = await poolPromise;
  const [updateRes] = await pool.query(
    'UPDATE Categories SET Name = ? WHERE CategoryCode = ?',
    [name.slice(0, 100), cleanCode]
  );

  if (updateRes.affectedRows === 0) {
    throw new AppError('Không tìm thấy danh mục sản phẩm.', 404);
  }

  return getCategoryByCode(cleanCode);
}

async function deleteCategory(code) {
  const cleanCode = String(code || '').trim();
  if (!cleanCode) {
    throw new AppError('Mã danh mục không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const [existRows] = await pool.query(
    'SELECT CategoryCode FROM Categories WHERE CategoryCode = ?',
    [cleanCode]
  );

  if (existRows.length === 0) {
    throw new AppError('Không tìm thấy danh mục sản phẩm.', 404);
  }

  const [countRows] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM Products WHERE CategoryCode = ?',
    [cleanCode]
  );

  if (Number(countRows[0].cnt) > 0) {
    throw new AppError('Danh mục đang chứa sản phẩm, không thể xóa.', 409);
  }

  await pool.query('DELETE FROM Categories WHERE CategoryCode = ?', [cleanCode]);

  return { message: 'Đã xóa danh mục sản phẩm.' };
}

// ============================================================================
// 2. PRODUCTS (Products)
// ============================================================================

async function listProducts(queryParams = {}) {
  const {
    category,
    petType,
    subType,
    subTypes,
    minPrice,
    maxPrice,
    promoOnly,
    featured,
    lowStock,
    threshold,
    search,
    sort,
    includeInactive,
  } = queryParams;

  const pool = await poolPromise;
  let query = 'SELECT * FROM Products WHERE 1=1';
  const params = [];

  if (String(includeInactive) !== 'true') {
    query += ' AND IsActive = 1';
  }

  if (category && category !== 'all') {
    query += ' AND CategoryCode = ?';
    params.push(String(category).trim());
  }

  if (petType && petType !== 'all') {
    query += " AND (PetType = ? OR PetType = 'both')";
    params.push(String(petType).trim());
  }

  const rawSub = subTypes !== undefined ? subTypes : subType;
  if (rawSub !== undefined && rawSub !== null && String(rawSub).trim() !== '') {
    const rawList = Array.isArray(rawSub) ? rawSub : [rawSub];
    const parsedSubs = rawList
      .flatMap((entry) => String(entry).split(','))
      .map((s) => s.trim())
      .filter((s) => s && s !== 'all');

    if (parsedSubs.length === 1) {
      query += ' AND SubType = ?';
      params.push(parsedSubs[0]);
    } else if (parsedSubs.length > 1) {
      const subPlaceholders = parsedSubs.map(() => '?').join(', ');
      query += ` AND SubType IN (${subPlaceholders})`;
      params.push(...parsedSubs);
    }
  }

  if (minPrice !== undefined && minPrice !== null && String(minPrice).trim() !== '') {
    const minVal = Number(minPrice);
    if (Number.isNaN(minVal)) {
      throw new AppError('Giá tối thiểu không hợp lệ.', 400);
    }
    query += ' AND Price >= ?';
    params.push(minVal);
  }

  if (maxPrice !== undefined && maxPrice !== null && String(maxPrice).trim() !== '') {
    const maxVal = Number(maxPrice);
    if (Number.isNaN(maxVal)) {
      throw new AppError('Giá tối đa không hợp lệ.', 400);
    }
    query += ' AND Price <= ?';
    params.push(maxVal);
  }

  if (String(promoOnly) === 'true') {
    query += ' AND OriginalPrice IS NOT NULL AND OriginalPrice > Price';
  }

  if (String(featured) === 'true') {
    query += ' AND IsFeatured = 1';
  }

  if (String(lowStock) === 'true') {
    const parsedThreshold =
      threshold !== undefined && threshold !== null && String(threshold).trim() !== ''
        ? Number(threshold)
        : 15;
    const safeThreshold =
      Number.isFinite(parsedThreshold) && parsedThreshold >= 0
        ? Math.floor(parsedThreshold)
        : 15;
    query += ' AND StockCount <= ?';
    params.push(safeThreshold);
  }

  if (search && String(search).trim()) {
    const q = `%${String(search).trim()}%`;
    query += ` AND (
      Name LIKE ? OR Brand LIKE ? OR ProductId LIKE ?
      OR ShortDesc LIKE ? OR SubType LIKE ?
    )`;
    params.push(q, q, q, q, q);
  }

  if (sort === 'price-asc') {
    query += ' ORDER BY Price ASC, CreatedAt DESC';
  } else if (sort === 'price-desc') {
    query += ' ORDER BY Price DESC, CreatedAt DESC';
  } else if (sort === 'newest') {
    query += ' ORDER BY CreatedAt DESC';
  } else if (sort === 'stock-asc') {
    query += ' ORDER BY StockCount ASC, CreatedAt DESC';
  } else {
    query += ' ORDER BY IsFeatured DESC, CreatedAt DESC';
  }

  const [prodRows] = await pool.query(query, params);
  let items = await attachReviewsToProducts(pool, prodRows);

  if (sort === 'rating') {
    items = items.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);
  }

  return items;
}

async function listPromotionProducts(queryParams = {}) {
  return listProducts({
    ...queryParams,
    promoOnly: 'true',
    includeInactive: 'false',
  });
}

async function listFeaturedProducts(queryParams = {}) {
  return listProducts({
    ...queryParams,
    featured: 'true',
    includeInactive: 'false',
  });
}

async function listLowStockProducts(queryParams = {}) {
  const rawThreshold = queryParams.threshold;
  let safeThreshold = 15;

  if (rawThreshold !== undefined && rawThreshold !== null && String(rawThreshold).trim() !== '') {
    const parsed = Number(rawThreshold);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new AppError('Ngưỡng tồn kho không hợp lệ.', 400);
    }
    safeThreshold = Math.floor(parsed);
  }

  return listProducts({
    ...queryParams,
    lowStock: 'true',
    threshold: safeThreshold,
    includeInactive: 'false',
    sort: 'stock-asc',
  });
}

async function getProductById(productId) {
  const id = String(productId || '').trim();
  if (!id) {
    throw new AppError('Mã sản phẩm không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const [prodRows] = await pool.query('SELECT * FROM Products WHERE ProductId = ?', [id]);

  if (prodRows.length === 0) {
    throw new AppError('Không tìm thấy sản phẩm.', 404);
  }

  const items = await attachReviewsToProducts(pool, [prodRows[0]]);
  return items[0];
}

async function createProduct(body = {}) {
  const productId = String(
    body.id || body.productId || `prod-custom-${Date.now().toString().slice(-5)}`
  ).trim();
  const brand = String(body.brand || 'PETSFRIEND SELECT').trim();
  const name = String(body.name || '').trim();
  const categoryCode = String(body.category ?? body.categoryCode ?? 'food').trim();

  let petType = 'both';
  if (body.petType !== undefined && body.petType !== null && body.petType !== '') {
    if (!['dog', 'cat', 'both'].includes(body.petType)) {
      throw new AppError('Loại thú cưng không hợp lệ (chỉ nhận dog, cat, both).', 400);
    }
    petType = body.petType;
  }

  const rawPrice = body.priceNum !== undefined ? body.priceNum : body.price;
  const priceNum = parseStrictNonNegativePrice(rawPrice);

  if (!name || priceNum === null) {
    throw new AppError('Tên sản phẩm và giá bán hợp lệ là bắt buộc.', 400);
  }
  if (!productId) {
    throw new AppError('Mã SKU sản phẩm không hợp lệ.', 400);
  }
  if (!categoryCode) {
    throw new AppError('Danh mục sản phẩm không hợp lệ.', 400);
  }

  let stockCount = 0;
  if (body.stockCount !== undefined && body.stockCount !== null && body.stockCount !== '') {
    const parsedStock = Number(body.stockCount);
    if (!Number.isFinite(parsedStock) || parsedStock < 0) {
      throw new AppError('Số lượng tồn kho không hợp lệ.', 400);
    }
    stockCount = Math.floor(parsedStock);
  }

  const rawOrig = body.originalPriceNum !== undefined ? body.originalPriceNum : body.originalPrice;
  const origNum =
    rawOrig === null || rawOrig === undefined || rawOrig === '' || rawOrig === 0 || rawOrig === '0'
      ? null
      : parseMoneyNumber(rawOrig);
  const originalPrice = origNum !== null && origNum > priceNum ? origNum : null;

  const primaryImage = String(
    body.image || body.primaryImage || '/images/prod-ceramic-bowl.jpg'
  ).trim();
  const sizesStr = Array.isArray(body.sizes)
    ? body.sizes.map((s) => String(s).trim()).filter(Boolean).join(', ') || 'Tiêu chuẩn'
    : String(body.sizes || body.packSize || 'Tiêu chuẩn').trim();

  const shortDescRaw = body.shortDesc !== undefined ? body.shortDesc : body.description;
  const shortDesc =
    shortDescRaw !== undefined && shortDescRaw !== null && String(shortDescRaw).trim() !== ''
      ? String(shortDescRaw).trim()
      : null;
  const subType =
    body.subType !== undefined && body.subType !== null && String(body.subType).trim() !== ''
      ? String(body.subType).trim()
      : null;

  const pool = await poolPromise;

  const [dupRows] = await pool.query(
    'SELECT ProductId FROM Products WHERE ProductId = ?',
    [productId]
  );

  if (dupRows.length > 0) {
    throw new AppError('Mã SKU sản phẩm đã tồn tại.', 409);
  }

  const [catRows] = await pool.query(
    'SELECT CategoryCode FROM Categories WHERE CategoryCode = ?',
    [categoryCode]
  );

  if (catRows.length === 0) {
    throw new AppError('Danh mục sản phẩm không hợp lệ.', 400);
  }

  await pool.query(
    `
      INSERT INTO Products (
        ProductId, Brand, Name, ShortDesc, CategoryCode, SubType,
        PetType, Sizes, Price, OriginalPrice, PrimaryImage, StockCount, IsFeatured, IsActive
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      productId.slice(0, 60),
      brand.slice(0, 100),
      name.slice(0, 200),
      shortDesc ? shortDesc.slice(0, 400) : null,
      categoryCode.slice(0, 30),
      subType ? subType.slice(0, 100) : null,
      petType,
      sizesStr.slice(0, 200),
      priceNum,
      originalPrice,
      primaryImage.slice(0, 500),
      stockCount,
      body.isFeatured ? 1 : 0,
      body.isActive === false ? 0 : 1,
    ]
  );

  const [insertedRows] = await pool.query(
    'SELECT * FROM Products WHERE ProductId = ?',
    [productId]
  );
  return mapProductRow(insertedRows[0], []);
}

async function updateProduct(productId, body = {}) {
  const id = String(productId || '').trim();
  if (!id) {
    throw new AppError('Mã sản phẩm không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const [existingRows] = await pool.query(
    'SELECT * FROM Products WHERE ProductId = ?',
    [id]
  );

  if (existingRows.length === 0) {
    throw new AppError('Không tìm thấy sản phẩm để cập nhật.', 404);
  }

  const existing = existingRows[0];

  const mergedBrand =
    body.brand !== undefined
      ? String(body.brand || '').trim() || existing.Brand
      : existing.Brand;

  const mergedName =
    body.name !== undefined ? String(body.name ?? '').trim() : existing.Name;

  if (!mergedName) {
    throw new AppError('Tên sản phẩm không được để trống.', 400);
  }

  let mergedShortDesc = existing.ShortDesc;
  if (body.shortDesc !== undefined || body.description !== undefined) {
    const rawDesc = body.shortDesc !== undefined ? body.shortDesc : body.description;
    mergedShortDesc =
      rawDesc === null || String(rawDesc).trim() === ''
        ? null
        : String(rawDesc).trim();
  }

  const rawCategory = body.category !== undefined ? body.category : body.categoryCode;
  const mergedCategoryCode =
    rawCategory !== undefined ? String(rawCategory ?? '').trim() : existing.CategoryCode;

  if (!mergedCategoryCode) {
    throw new AppError('Danh mục sản phẩm không hợp lệ.', 400);
  }

  const [catCheck] = await pool.query(
    'SELECT CategoryCode FROM Categories WHERE CategoryCode = ?',
    [mergedCategoryCode]
  );

  if (catCheck.length === 0) {
    throw new AppError('Danh mục sản phẩm không hợp lệ.', 400);
  }

  let mergedSubType = existing.SubType;
  if (body.subType !== undefined) {
    mergedSubType =
      body.subType === null || String(body.subType).trim() === ''
        ? null
        : String(body.subType).trim();
  }

  let mergedPetType = existing.PetType || 'both';
  if (body.petType !== undefined) {
    if (body.petType === null || body.petType === '') {
      mergedPetType = existing.PetType || 'both';
    } else if (['dog', 'cat', 'both'].includes(body.petType)) {
      mergedPetType = body.petType;
    } else {
      throw new AppError('Loại thú cưng không hợp lệ (chỉ nhận dog, cat, both).', 400);
    }
  }

  let mergedSizes = existing.Sizes;
  if (body.sizes !== undefined) {
    mergedSizes = Array.isArray(body.sizes)
      ? body.sizes.map((s) => String(s).trim()).filter(Boolean).join(', ') || 'Tiêu chuẩn'
      : String(body.sizes || '').trim() || existing.Sizes;
  } else if (body.packSize !== undefined) {
    mergedSizes = String(body.packSize || '').trim() || existing.Sizes;
  }

  let mergedPrice = Number(existing.Price || 0);
  if (body.priceNum !== undefined || body.price !== undefined) {
    const rawPrice = body.priceNum !== undefined ? body.priceNum : body.price;
    const parsedPrice = parseStrictNonNegativePrice(rawPrice);
    if (parsedPrice === null) {
      throw new AppError('Giá bán sản phẩm không hợp lệ.', 400);
    }
    mergedPrice = parsedPrice;
  }

  let mergedOriginalPrice = null;
  if (body.originalPriceNum !== undefined || body.originalPrice !== undefined) {
    const rawOrig =
      body.originalPriceNum !== undefined ? body.originalPriceNum : body.originalPrice;
    if (rawOrig === null || rawOrig === '' || rawOrig === 0 || rawOrig === '0') {
      mergedOriginalPrice = null;
    } else {
      const parsedOrig = parseMoneyNumber(rawOrig);
      mergedOriginalPrice =
        parsedOrig !== null && parsedOrig > mergedPrice ? parsedOrig : null;
    }
  } else {
    const existingOrig =
      existing.OriginalPrice !== null && existing.OriginalPrice !== undefined
        ? Number(existing.OriginalPrice)
        : null;
    mergedOriginalPrice =
      existingOrig !== null && existingOrig > mergedPrice ? existingOrig : null;
  }

  const rawImage = body.image !== undefined ? body.image : body.primaryImage;
  const mergedImage =
    rawImage !== undefined
      ? String(rawImage || '').trim() || existing.PrimaryImage
      : existing.PrimaryImage;

  let mergedStockCount = Number(existing.StockCount || 0);
  if (body.stockCount !== undefined) {
    const parsedStock = Number(body.stockCount);
    if (!Number.isFinite(parsedStock) || parsedStock < 0) {
      throw new AppError('Số lượng tồn kho không hợp lệ.', 400);
    }
    mergedStockCount = Math.floor(parsedStock);
  }

  const mergedIsFeatured =
    body.isFeatured !== undefined
      ? body.isFeatured
        ? 1
        : 0
      : existing.IsFeatured
        ? 1
        : 0;

  const mergedIsActive =
    body.isActive !== undefined
      ? body.isActive
        ? 1
        : 0
      : existing.IsActive
        ? 1
        : 0;

  await pool.query(
    `
      UPDATE Products
      SET Brand = ?,
          Name = ?,
          ShortDesc = ?,
          CategoryCode = ?,
          SubType = ?,
          PetType = ?,
          Sizes = ?,
          Price = ?,
          OriginalPrice = ?,
          PrimaryImage = ?,
          StockCount = ?,
          IsFeatured = ?,
          IsActive = ?
      WHERE ProductId = ?
    `,
    [
      mergedBrand.slice(0, 100),
      mergedName.slice(0, 200),
      mergedShortDesc ? mergedShortDesc.slice(0, 400) : null,
      mergedCategoryCode.slice(0, 30),
      mergedSubType ? mergedSubType.slice(0, 100) : null,
      mergedPetType,
      mergedSizes ? String(mergedSizes).slice(0, 200) : null,
      mergedPrice,
      mergedOriginalPrice,
      mergedImage.slice(0, 500),
      mergedStockCount,
      mergedIsFeatured,
      mergedIsActive,
      id,
    ]
  );

  const [updatedRows] = await pool.query('SELECT * FROM Products WHERE ProductId = ?', [
    id,
  ]);
  const mappedList = await attachReviewsToProducts(pool, [updatedRows[0]]);
  return mappedList[0];
}

async function adjustProductStock(productId, body = {}) {
  const id = String(productId || '').trim();
  if (!id) {
    throw new AppError('Mã sản phẩm không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const [existingRows] = await pool.query(
    'SELECT * FROM Products WHERE ProductId = ?',
    [id]
  );

  if (existingRows.length === 0) {
    throw new AppError('Không tìm thấy sản phẩm.', 404);
  }

  const existing = existingRows[0];
  const hasStockCount =
    body.stockCount !== undefined && body.stockCount !== null && body.stockCount !== '';
  const hasDelta =
    body.delta !== undefined && body.delta !== null && body.delta !== '';

  if (!hasStockCount && !hasDelta) {
    throw new AppError('Vui lòng cung cấp stockCount hoặc delta để điều chỉnh tồn kho.', 400);
  }

  let nextStock;
  if (hasStockCount) {
    const parsedStock = Number(body.stockCount);
    if (!Number.isFinite(parsedStock) || parsedStock < 0) {
      throw new AppError('Số lượng tồn kho không hợp lệ.', 400);
    }
    nextStock = Math.floor(parsedStock);
  } else {
    const parsedDelta = Number(body.delta);
    if (!Number.isFinite(parsedDelta) || !Number.isInteger(parsedDelta)) {
      throw new AppError('Giá trị điều chỉnh tồn kho (delta) phải là số nguyên.', 400);
    }
    nextStock = Number(existing.StockCount || 0) + parsedDelta;
    if (nextStock < 0) {
      throw new AppError('Số lượng tồn kho sau điều chỉnh không được âm.', 400);
    }
  }

  await pool.query('UPDATE Products SET StockCount = ? WHERE ProductId = ?', [
    nextStock,
    id,
  ]);

  const [updatedRows] = await pool.query('SELECT * FROM Products WHERE ProductId = ?', [
    id,
  ]);
  const mappedList = await attachReviewsToProducts(pool, [updatedRows[0]]);
  return mappedList[0];
}

async function restoreProduct(productId) {
  const id = String(productId || '').trim();
  if (!id) {
    throw new AppError('Mã sản phẩm không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const [existingRows] = await pool.query(
    'SELECT ProductId FROM Products WHERE ProductId = ?',
    [id]
  );
  if (existingRows.length === 0) {
    throw new AppError('Không tìm thấy sản phẩm.', 404);
  }

  await pool.query('UPDATE Products SET IsActive = 1 WHERE ProductId = ?', [id]);
  const [updatedRows] = await pool.query('SELECT * FROM Products WHERE ProductId = ?', [
    id,
  ]);

  const mappedList = await attachReviewsToProducts(pool, [updatedRows[0]]);
  return mappedList[0];
}

async function softDeleteProduct(productId) {
  const id = String(productId || '').trim();
  if (!id) {
    throw new AppError('Mã sản phẩm không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const [res] = await pool.query('UPDATE Products SET IsActive = 0 WHERE ProductId = ?', [
    id,
  ]);

  if (res.affectedRows === 0) {
    throw new AppError('Không tìm thấy sản phẩm.', 404);
  }

  return { message: 'Đã xóa sản phẩm khỏi danh mục cửa hàng.' };
}

// ============================================================================
// 3. PRODUCT REVIEWS (ProductReviews)
// ============================================================================

async function listAllReviews(queryParams = {}) {
  const { productId, rating } = queryParams;
  const pool = await poolPromise;
  let query = 'SELECT * FROM ProductReviews WHERE 1=1';
  const params = [];

  if (productId && String(productId).trim()) {
    query += ' AND ProductId = ?';
    params.push(String(productId).trim());
  }

  if (rating !== undefined && rating !== null && String(rating).trim() !== '') {
    const rNum = Number(rating);
    if (!Number.isInteger(rNum) || rNum < 1 || rNum > 5) {
      throw new AppError('Số sao lọc phải từ 1 đến 5.', 400);
    }
    query += ' AND Rating = ?';
    params.push(rNum);
  }

  query += ' ORDER BY CreatedAt DESC, ReviewId DESC';
  const [rows] = await pool.query(query, params);
  return rows.map(mapReviewRow);
}

async function listProductReviews(productId) {
  const id = String(productId || '').trim();
  if (!id) {
    throw new AppError('Mã sản phẩm không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const [prodRows] = await pool.query(
    'SELECT ProductId FROM Products WHERE ProductId = ?',
    [id]
  );

  if (prodRows.length === 0) {
    throw new AppError('Không tìm thấy sản phẩm.', 404);
  }

  const [revRows] = await pool.query(
    'SELECT * FROM ProductReviews WHERE ProductId = ? ORDER BY CreatedAt DESC, ReviewId DESC',
    [id]
  );

  return revRows.map(mapReviewRow);
}

async function createProductReview(productId, body = {}, currentUser = null) {
  const id = String(productId || '').trim();
  if (!id) {
    throw new AppError('Mã sản phẩm không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const [prodRows] = await pool.query(
    'SELECT ProductId FROM Products WHERE ProductId = ?',
    [id]
  );

  if (prodRows.length === 0) {
    throw new AppError('Không tìm thấy sản phẩm.', 404);
  }

  const resolvedComment = String(body.comment ?? '').trim();
  if (!resolvedComment) {
    throw new AppError('Vui lòng nhập nội dung nhận xét.', 400);
  }

  let safeRating = 5;
  if (body.rating !== undefined && body.rating !== null && String(body.rating).trim() !== '') {
    const parsedRating = Number(body.rating);
    if (!Number.isFinite(parsedRating)) {
      throw new AppError('Số sao đánh giá không hợp lệ.', 400);
    }
    safeRating = Math.min(5, Math.max(1, Math.round(parsedRating)));
  }

  let resolvedUserId = body.userId
    ? Number(body.userId)
    : currentUser?.userId
      ? Number(currentUser.userId)
      : null;

  if (resolvedUserId !== null && (!Number.isInteger(resolvedUserId) || resolvedUserId <= 0)) {
    resolvedUserId = null;
  }

  let matchedUserName = null;
  if (resolvedUserId !== null) {
    const [userRows] = await pool.query(
      'SELECT UserId, FullName FROM Users WHERE UserId = ?',
      [resolvedUserId]
    );

    if (userRows.length === 0) {
      resolvedUserId = null;
    } else {
      matchedUserName = userRows[0].FullName || null;
    }
  }

  const resolvedAuthor = String(
    body.author || body.authorName || matchedUserName || 'Hội viên PetsFriend'
  ).trim();
  const resolvedPetTag =
    body.petTag && String(body.petTag).trim()
      ? String(body.petTag).trim()
      : 'Hội viên PetsFriend';

  const [insertRes] = await pool.query(
    `
      INSERT INTO ProductReviews (ProductId, UserId, AuthorName, PetTag, Rating, Comment)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      resolvedUserId,
      resolvedAuthor.slice(0, 120),
      resolvedPetTag.slice(0, 100),
      safeRating,
      resolvedComment.slice(0, 1000),
    ]
  );

  const [revRows] = await pool.query(
    'SELECT * FROM ProductReviews WHERE ReviewId = ?',
    [insertRes.insertId]
  );
  return mapReviewRow(revRows[0]);
}

async function updateProductReview(reviewId, body = {}, currentUser = null) {
  const revId = Number(reviewId);
  if (!Number.isInteger(revId) || revId <= 0) {
    throw new AppError('Mã đánh giá không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const [revRows] = await pool.query(
    'SELECT * FROM ProductReviews WHERE ReviewId = ?',
    [revId]
  );

  if (revRows.length === 0) {
    throw new AppError('Không tìm thấy đánh giá sản phẩm.', 404);
  }

  const rev = revRows[0];

  if (!currentUser && process.env.STRICT_AUTH === 'true') {
    throw new AppError('Vui lòng đăng nhập.', 401);
  }

  if (
    currentUser &&
    currentUser.role !== 'admin' &&
    (rev.UserId === null || Number(currentUser.userId) !== Number(rev.UserId))
  ) {
    throw new AppError('Bạn không có quyền chỉnh sửa đánh giá này.', 403);
  }

  let mergedRating = Number(rev.Rating);
  if (body.rating !== undefined && body.rating !== null && String(body.rating).trim() !== '') {
    const parsedRating = Number(body.rating);
    if (!Number.isFinite(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      throw new AppError('Số sao đánh giá phải nằm trong khoảng từ 1 đến 5.', 400);
    }
    mergedRating = Math.round(parsedRating);
  }

  const mergedComment =
    body.comment !== undefined ? String(body.comment ?? '').trim() : rev.Comment;
  if (!mergedComment) {
    throw new AppError('Nội dung nhận xét không được để trống.', 400);
  }

  const mergedPetTag =
    body.petTag !== undefined
      ? body.petTag && String(body.petTag).trim()
        ? String(body.petTag).trim()
        : rev.PetTag
      : rev.PetTag;

  const rawAuthor = body.author !== undefined ? body.author : body.authorName;
  const mergedAuthor =
    rawAuthor !== undefined
      ? String(rawAuthor || '').trim() || rev.AuthorName
      : rev.AuthorName;

  await pool.query(
    `
      UPDATE ProductReviews
      SET AuthorName = ?,
          PetTag = ?,
          Rating = ?,
          Comment = ?
      WHERE ReviewId = ?
    `,
    [
      mergedAuthor.slice(0, 120),
      mergedPetTag ? String(mergedPetTag).slice(0, 100) : null,
      mergedRating,
      mergedComment.slice(0, 1000),
      revId,
    ]
  );

  const [updatedRows] = await pool.query(
    'SELECT * FROM ProductReviews WHERE ReviewId = ?',
    [revId]
  );
  return mapReviewRow(updatedRows[0]);
}

async function deleteProductReview(reviewId, currentUser = null) {
  const revId = Number(reviewId);
  if (!Number.isInteger(revId) || revId <= 0) {
    throw new AppError('Mã đánh giá không hợp lệ.', 400);
  }

  const pool = await poolPromise;
  const [revRows] = await pool.query(
    'SELECT * FROM ProductReviews WHERE ReviewId = ?',
    [revId]
  );

  if (revRows.length === 0) {
    throw new AppError('Không tìm thấy đánh giá sản phẩm.', 404);
  }

  const rev = revRows[0];

  if (!currentUser && process.env.STRICT_AUTH === 'true') {
    throw new AppError('Vui lòng đăng nhập.', 401);
  }

  if (
    currentUser &&
    currentUser.role !== 'admin' &&
    currentUser.role !== 'staff' &&
    (rev.UserId === null || Number(currentUser.userId) !== Number(rev.UserId))
  ) {
    throw new AppError('Bạn không có quyền xóa đánh giá này.', 403);
  }

  await pool.query('DELETE FROM ProductReviews WHERE ReviewId = ?', [revId]);

  return { message: 'Đã xóa đánh giá sản phẩm.' };
}

module.exports = {
  listCategories,
  getCategoryByCode,
  createCategory,
  updateCategory,
  deleteCategory,
  listProducts,
  listPromotionProducts,
  listFeaturedProducts,
  listLowStockProducts,
  getProductById,
  createProduct,
  updateProduct,
  adjustProductStock,
  restoreProduct,
  softDeleteProduct,
  listAllReviews,
  listProductReviews,
  createProductReview,
  updateProductReview,
  deleteProductReview,
};
