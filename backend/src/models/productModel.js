const { sql, poolPromise } = require('../config/db');

const parse = (s) => { try { return s ? JSON.parse(s) : []; } catch { return []; } };
const map = (r) => r && { ...r, sizes: parse(r.sizes), gallery: parse(r.gallery), highlights: parse(r.highlights) };

const COLS = `Id AS id, Brand AS brand, Name AS name, ShortDesc AS shortDesc, Description AS description,
  PackSize AS packSize, Sizes AS sizes, Gallery AS gallery, Highlights AS highlights,
  PriceNum AS priceNum, OriginalPrice AS originalPrice, Badge AS badge, Category AS category,
  SubType AS subType, PetType AS petType, Image AS image, StockCount AS stockCount,
  LowStockThreshold AS lowStockThreshold, IsFeatured AS isFeatured, IsFlashSale AS isFlashSale,
  CreatedAt AS createdAt`;

const bind = (req, p) => req
  .input('id', sql.NVarChar(60), p.id)
  .input('brand', sql.NVarChar(100), p.brand)
  .input('name', sql.NVarChar(200), p.name)
  .input('shortDesc', sql.NVarChar(500), p.shortDesc)
  .input('description', sql.NVarChar(sql.MAX), p.description)
  .input('packSize', sql.NVarChar(100), p.packSize)
  .input('sizes', sql.NVarChar(sql.MAX), p.sizes)
  .input('gallery', sql.NVarChar(sql.MAX), p.gallery)
  .input('highlights', sql.NVarChar(sql.MAX), p.highlights)
  .input('priceNum', sql.Int, p.priceNum)
  .input('originalPrice', sql.Int, p.originalPrice)
  .input('badge', sql.NVarChar(100), p.badge)
  .input('category', sql.NVarChar(20), p.category)
  .input('subType', sql.NVarChar(100), p.subType)
  .input('petType', sql.NVarChar(10), p.petType)
  .input('image', sql.NVarChar(500), p.image)
  .input('stockCount', sql.Int, p.stockCount)
  .input('low', sql.Int, p.lowStockThreshold)
  .input('featured', sql.Bit, p.isFeatured)
  .input('flash', sql.Bit, p.isFlashSale);

exports.findAll = async ({ category, search } = {}) => {
  const pool = await poolPromise;
  const req = pool.request();
  const where = [];
  if (category) { req.input('category', sql.NVarChar(20), category); where.push('Category = @category'); }
  if (search) { req.input('search', sql.NVarChar(200), `%${search}%`); where.push('(Name LIKE @search OR Brand LIKE @search)'); }
  const r = await req.query(
    `SELECT ${COLS} FROM Products ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CreatedAt DESC`
  );
  return r.recordset.map(map);
};

exports.findLowStock = async () => {
  const pool = await poolPromise;
  const r = await pool.request().query(
    `SELECT ${COLS} FROM Products WHERE StockCount <= LowStockThreshold ORDER BY StockCount ASC`
  );
  return r.recordset.map(map);
};

exports.findById = async (id) => {
  const pool = await poolPromise;
  const r = await pool.request().input('id', sql.NVarChar(60), id)
    .query(`SELECT ${COLS} FROM Products WHERE Id = @id`);
  return map(r.recordset[0]) || null;
};

exports.create = async (p) => {
  const pool = await poolPromise;
  await bind(pool.request(), p).query(`
    INSERT INTO Products (Id, Brand, Name, ShortDesc, Description, PackSize, Sizes, Gallery, Highlights,
      PriceNum, OriginalPrice, Badge, Category, SubType, PetType, Image, StockCount, LowStockThreshold, IsFeatured, IsFlashSale)
    VALUES (@id, @brand, @name, @shortDesc, @description, @packSize, @sizes, @gallery, @highlights,
      @priceNum, @originalPrice, @badge, @category, @subType, @petType, @image, @stockCount, @low, @featured, @flash)`);
  return exports.findById(p.id);
};

exports.update = async (id, p) => {
  const pool = await poolPromise;
  const r = await bind(pool.request(), { ...p, id }).query(`
    UPDATE Products SET Brand=@brand, Name=@name, ShortDesc=@shortDesc, Description=@description,
      PackSize=@packSize, Sizes=@sizes, Gallery=@gallery, Highlights=@highlights, PriceNum=@priceNum,
      OriginalPrice=@originalPrice, Badge=@badge, Category=@category, SubType=@subType, PetType=@petType,
      Image=@image, StockCount=@stockCount, LowStockThreshold=@low, IsFeatured=@featured, IsFlashSale=@flash
    WHERE Id=@id`);
  return r.rowsAffected[0] > 0 ? exports.findById(id) : null;
};

exports.updateStock = async (id, stockCount) => {
  const pool = await poolPromise;
  const r = await pool.request()
    .input('id', sql.NVarChar(60), id)
    .input('stock', sql.Int, stockCount)
    .query('UPDATE Products SET StockCount = @stock WHERE Id = @id');
  return r.rowsAffected[0] > 0 ? exports.findById(id) : null;
};

exports.remove = async (id) => {
  const pool = await poolPromise;
  const r = await pool.request().input('id', sql.NVarChar(60), id)
    .query('DELETE FROM Products WHERE Id = @id');
  return r.rowsAffected[0] > 0;
};