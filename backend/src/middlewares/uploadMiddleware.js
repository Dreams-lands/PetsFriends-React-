const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const MIME_TO_DEFAULT_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function resolveValidatedExtension(originalFilename, mimeType) {
  const rawName = String(originalFilename || '').trim();
  const ext = path.extname(rawName).toLowerCase();
  const cleanMime = String(mimeType || '')
    .toLowerCase()
    .split(';')[0]
    .trim();

  if (ext) {
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return null;
    }
    if (
      cleanMime &&
      cleanMime !== 'application/octet-stream' &&
      !MIME_TO_DEFAULT_EXT[cleanMime]
    ) {
      return null;
    }
    return ext;
  }

  if (cleanMime && MIME_TO_DEFAULT_EXT[cleanMime]) {
    return MIME_TO_DEFAULT_EXT[cleanMime];
  }

  return null;
}

function buildUniqueSafeFilename(originalFilename, resolvedExt) {
  const rawBase = path.basename(
    String(originalFilename || 'product'),
    path.extname(String(originalFilename || ''))
  );
  const safeBase =
    rawBase
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'product';

  const uniqueToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${uniqueToken}-${safeBase}${resolvedExt}`;
}

async function parseProductImageUpload(req, res, next) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();

  let originalFilename = '';
  let mimeType = '';
  let buffer = null;

  try {
    if (contentType.includes('multipart/form-data')) {
      const cleanHeaders = {};
      for (const [key, val] of Object.entries(req.headers)) {
        if (typeof val === 'string') {
          cleanHeaders[key] = val;
        } else if (Array.isArray(val)) {
          cleanHeaders[key] = val.join(', ');
        }
      }

      let formData;
      try {
        const webReq = new Request('http://localhost/upload', {
          method: req.method,
          headers: cleanHeaders,
          body: Readable.toWeb(req),
          duplex: 'half',
        });
        formData = await webReq.formData();
      } catch {
        return res.status(400).json({
          message: 'Dữ liệu multipart/form-data tải ảnh không hợp lệ.',
        });
      }

      let fileEntry = formData.get('image') || formData.get('file');
      if (!fileEntry) {
        for (const [, val] of formData.entries()) {
          if (val && typeof val === 'object' && typeof val.arrayBuffer === 'function') {
            fileEntry = val;
            break;
          }
        }
      }

      if (!fileEntry || typeof fileEntry === 'string' || typeof fileEntry.arrayBuffer !== 'function') {
        return res.status(400).json({
          message: 'Vui lòng chọn tệp ảnh cần tải lên (trường image hoặc file).',
        });
      }

      originalFilename = fileEntry.name || '';
      mimeType = fileEntry.type || '';
      const arrBuf = await fileEntry.arrayBuffer();
      buffer = Buffer.from(arrBuf);
    } else {
      const body = req.body || {};
      originalFilename = String(body.filename || body.fileName || body.name || '').trim();
      const rawData = body.dataBase64 || body.base64 || body.imageBase64 || '';

      if (!rawData || typeof rawData !== 'string' || !rawData.trim()) {
        return res.status(400).json({
          message: 'Vui lòng cung cấp dữ liệu ảnh tải lên (multipart hoặc JSON dataBase64).',
        });
      }

      const trimmed = rawData.trim();
      const dataUrlMatch = trimmed.match(/^data:([^;]+);base64,([\s\S]+)$/i);
      let base64Str;

      if (dataUrlMatch) {
        mimeType = dataUrlMatch[1].trim();
        base64Str = dataUrlMatch[2].replace(/\s+/g, '');
      } else {
        mimeType = String(body.mimeType || body.contentType || '').trim();
        base64Str = trimmed.replace(/\s+/g, '');
      }

      if (!base64Str || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Str)) {
        return res.status(400).json({
          message: 'Chuỗi dữ liệu ảnh Base64 không hợp lệ.',
        });
      }

      buffer = Buffer.from(base64Str, 'base64');
    }

    const resolvedExt = resolveValidatedExtension(originalFilename, mimeType);
    if (!resolvedExt) {
      return res.status(400).json({
        message: 'Định dạng ảnh không hợp lệ. Chỉ chấp nhận .jpg, .jpeg, .png, .webp, .gif.',
      });
    }

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({
        message: 'Tệp ảnh tải lên không được rỗng.',
      });
    }

    if (buffer.length > MAX_IMAGE_BYTES) {
      return res.status(400).json({
        message: 'Kích thước ảnh vượt quá giới hạn tối đa 5MB.',
      });
    }

    const uniqueSafeName = buildUniqueSafeFilename(originalFilename, resolvedExt);
    const uploadDir = path.resolve(__dirname, '../../uploads/products');
    await fs.promises.mkdir(uploadDir, { recursive: true });

    const targetPath = path.resolve(__dirname, '../../uploads/products', uniqueSafeName);
    await fs.promises.writeFile(targetPath, buffer);

    req.uploadedImage = {
      filename: uniqueSafeName,
      imageUrl: `/uploads/products/${uniqueSafeName}`,
      size: buffer.length,
    };

    return next();
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      message: err.message || 'Lỗi khi xử lý tải ảnh sản phẩm.',
    });
  }
}

module.exports = {
  parseProductImageUpload,
  MAX_IMAGE_BYTES,
  ALLOWED_EXTENSIONS,
};
