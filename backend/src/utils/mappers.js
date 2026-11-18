function formatCurrency(amount) {
  const num = Number(amount || 0);
  return `${num.toLocaleString('vi-VN')}₫`;
}

function formatVnDateTime(dateVal) {
  const d = dateVal ? new Date(dateVal) : new Date();
  if (Number.isNaN(d.getTime())) return String(dateVal || '');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} • ${hh}:${mi}`;
}

function formatVnDateOnly(dateVal) {
  const d = dateVal ? new Date(dateVal) : new Date();
  if (Number.isNaN(d.getTime())) return String(dateVal || '');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatIsoDateOnly(dateVal) {
  if (!dateVal) return '';
  if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
    return dateVal;
  }
  const d = new Date(dateVal);
  if (Number.isNaN(d.getTime())) return String(dateVal);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizePaymentMethodCode(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('vnpay')) return 'vnpay';
  if (s.includes('momo')) return 'momo';
  return 'cod';
}

function formatPaymentMethodLabel(code) {
  const normalized = normalizePaymentMethodCode(code);
  if (normalized === 'vnpay') return 'VNPay';
  if (normalized === 'momo') return 'MoMo';
  return 'Thanh toán khi nhận hàng (COD)';
}

function formatPaymentStatusLabel(status) {
  switch (status) {
    case 'paid':
      return 'Đã thanh toán';
    case 'failed':
      return 'Thanh toán thất bại';
    case 'refunded':
      return 'Đã hoàn tiền';
    default:
      return 'Chưa thanh toán';
  }
}

function parseMoneyNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/[^\d]/g, '');
  return cleaned ? Number(cleaned) : null;
}

function mapReviewRow(row) {
  return {
    id: `rev-${row.ReviewId}`,
    reviewId: row.ReviewId,
    productId: row.ProductId,
    userId: row.UserId,
    author: row.AuthorName,
    petTag: row.PetTag || 'Khách hàng PetsFriend',
    rating: Number(row.Rating),
    date: formatVnDateOnly(row.CreatedAt),
    verified: true,
    comment: row.Comment,
  };
}

function mapProductRow(row, reviews = []) {
  const priceNum = Number(row.Price || 0);
  const origNum = row.OriginalPrice !== null && row.OriginalPrice !== undefined
    ? Number(row.OriginalPrice)
    : null;
  const hasPromo = origNum !== null && origNum > priceNum && priceNum > 0;
  const pct = hasPromo ? Math.round(((origNum - priceNum) / origNum) * 100) : 0;

  const sizesArr = row.Sizes
    ? String(row.Sizes)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : ['Tiêu chuẩn'];

  const petPrefix =
    row.PetType === 'dog'
      ? 'Dành cho Chó'
      : row.PetType === 'cat'
        ? 'Dành cho Mèo'
        : 'Chó & Mèo';

  const avgRating =
    reviews.length > 0
      ? Number(
          (
            reviews.reduce((sum, r) => sum + Number(r.rating || 5), 0) /
            reviews.length
          ).toFixed(1)
        )
      : 4.9;

  const defaultSubTypeByCat = {
    food: 'Dinh dưỡng & Hạt khô',
    hygiene: 'Sữa tắm & Dưỡng lông',
    bed: 'Giường - Nệm - Thảm',
    backpack: 'Dụng cụ ăn uống',
    spa: 'Dịch vụ chăm sóc',
  };

  return {
    id: row.ProductId,
    productId: row.ProductId,
    brand: row.Brand,
    name: row.Name,
    shortDesc: row.ShortDesc || 'Sản phẩm chính hãng phân phối tại PetsFriend.',
    description:
      row.ShortDesc ||
      'Sản phẩm chọn lọc chuẩn chất lượng PetsFriend, an toàn cho thú cưng mỗi ngày.',
    packSize: `${petPrefix} • ${sizesArr[0] || 'Tiêu chuẩn'}`,
    sizes: sizesArr,
    rating: avgRating,
    reviewCount: reviews.length > 0 ? reviews.length : 1,
    priceNum,
    price: formatCurrency(priceNum),
    originalPrice: hasPromo ? formatCurrency(origNum) : undefined,
    originalPriceNum: origNum,
    discountBadge: hasPromo ? `−${pct}%` : undefined,
    badge: hasPromo
      ? `ƯU ĐÃI −${pct}%`
      : row.IsFeatured
        ? 'BÁN CHẠY'
        : 'CHÍNH HÃNG',
    category: row.CategoryCode,
    subType: row.SubType || defaultSubTypeByCat[row.CategoryCode] || 'Dụng cụ ăn uống',
    petType: row.PetType || 'both',
    image: row.PrimaryImage,
    gallery: [row.PrimaryImage],
    bgTone: '#eff5ff',
    stockCount: Number(row.StockCount || 0),
    highlights: [
      'Chính hãng 100% tại hệ thống PetsFriend',
      'Kiểm định an toàn sức khỏe thú cưng',
    ],
    isFeatured: Boolean(row.IsFeatured),
    isFlashSale: hasPromo,
    isActive: Boolean(row.IsActive),
    createdAt: row.CreatedAt,
    reviews,
  };
}

function mapOrderRow(row, itemRows = []) {
  return {
    id: row.OrderCode,
    orderId: row.OrderId,
    orderCode: row.OrderCode,
    userId: row.UserId,
    isGuest: Boolean(row.IsGuest),
    createdAt: formatVnDateTime(row.CreatedAt),
    createdAtIso: row.CreatedAt,
    status: row.OrderStatus,
    orderSource: row.OrderSource,
    totalAmount: Number(row.TotalAmount || 0),
    shippingAddress: row.ShippingAddress,
    paymentMethod: formatPaymentMethodLabel(row.PaymentMethod),
    paymentMethodCode: row.PaymentMethod,
    paymentStatus: row.PaymentStatus || (row.OrderSource === 'pos' ? 'paid' : 'unpaid'),
    paymentStatusLabel: formatPaymentStatusLabel(row.PaymentStatus || (row.OrderSource === 'pos' ? 'paid' : 'unpaid')),
    paidAt: row.PaidAt || null,
    deliveryMethod: row.DeliveryMethod,
    customerName: row.CustomerName,
    customerPhone: row.CustomerPhone,
    customerEmail: row.CustomerEmail || undefined,
    staffName: row.StaffName || undefined,
    items: itemRows.map((it) => ({
      id: it.ProductId || `item-${it.OrderItemId}`,
      orderItemId: it.OrderItemId,
      productId: it.ProductId,
      name: it.ProductName,
      image: it.ProductImage,
      price: Number(it.UnitPrice || 0),
      quantity: Number(it.Quantity || 1),
      variant: it.VariantLabel || 'Tiêu chuẩn',
    })),
  };
}

function mapBookingRow(row) {
  return {
    id: row.BookingCode,
    bookingId: row.BookingId,
    bookingCode: row.BookingCode,
    userId: row.UserId,
    packageId: row.PackageId,
    serviceName: row.ServiceName,
    petName: row.PetNameOrType,
    date: formatIsoDateOnly(row.BookingDate),
    timeSlot: row.TimeSlot,
    price: Number(row.Price || 0),
    status: row.Status,
    customerName: row.CustomerName,
    customerPhone: row.CustomerPhone,
    staffName: row.StaffName || undefined,
    note: row.Note || undefined,
    createdAt: row.CreatedAt,
  };
}

function mapAddressRow(row) {
  return {
    id: String(row.AddressId),
    addressId: row.AddressId,
    userId: row.UserId,
    label: row.Label,
    recipient: row.RecipientName,
    phone: row.Phone,
    address: row.FullAddress,
    isDefault: Boolean(row.IsDefault),
  };
}

function normalizePhoneDigits(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length >= 11) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

function mapUserRow(row) {
  return {
    id: row.UserId,
    userId: row.UserId,
    username: row.Username,
    name: row.FullName,
    fullName: row.FullName,
    email: row.Email,
    phone: row.Phone || '',
    role: row.Role,
    gender: row.Gender || 'Nam',
    status: row.Status || 'active',
    createdAt: row.CreatedAt,
  };
}

module.exports = {
  formatCurrency,
  formatVnDateTime,
  formatIsoDateOnly,
  normalizePaymentMethodCode,
  formatPaymentMethodLabel,
  formatPaymentStatusLabel,
  parseMoneyNumber,
  normalizePhoneDigits,
  mapReviewRow,
  mapProductRow,
  mapOrderRow,
  mapBookingRow,
  mapAddressRow,
  mapUserRow,
};