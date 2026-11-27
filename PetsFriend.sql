-- ============================================================================
-- PetsFriend (QLThuCung) - MySQL 8.0 Schema & Seed Script (MySQL Workbench)
-- Mở file này trong MySQL Workbench và nhấn biểu tượng ⚡ (Ctrl + Shift + Enter)
-- Script viết dạng idempotent: chạy lại nhiều lần không làm mất dữ liệu.
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET @OLD_SQL_SAFE_UPDATES = @@SQL_SAFE_UPDATES, SQL_SAFE_UPDATES = 0;

CREATE DATABASE IF NOT EXISTS QLThuCung
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE QLThuCung;

-- 1. Người dùng (Customer, Staff, Admin)
CREATE TABLE IF NOT EXISTS Users (
    UserId INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    Username VARCHAR(50) NULL,
    FullName VARCHAR(120) NOT NULL,
    Email VARCHAR(150) NOT NULL UNIQUE,
    Phone VARCHAR(20) NULL,
    Gender VARCHAR(15) NULL,
    PasswordHash VARCHAR(255) NOT NULL,
    Role VARCHAR(20) NOT NULL DEFAULT 'customer',
    Status VARCHAR(20) NOT NULL DEFAULT 'active',
    CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT CK_Users_Role CHECK (Role IN ('customer', 'staff', 'admin')),
    CONSTRAINT CK_Users_Status CHECK (Status IN ('active', 'inactive', 'banned'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Sổ địa chỉ (Dành cho thành viên đã đăng nhập)
CREATE TABLE IF NOT EXISTS UserAddresses (
    AddressId INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    UserId INT NOT NULL,
    Label VARCHAR(60) NOT NULL,
    RecipientName VARCHAR(120) NOT NULL,
    Phone VARCHAR(20) NOT NULL,
    FullAddress VARCHAR(300) NOT NULL,
    IsDefault TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT FK_UserAddresses_Users FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Danh mục sản phẩm
CREATE TABLE IF NOT EXISTS Categories (
    CategoryCode VARCHAR(30) NOT NULL PRIMARY KEY, -- food, hygiene, bed, backpack, spa
    Name VARCHAR(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Sản phẩm
CREATE TABLE IF NOT EXISTS Products (
    ProductId VARCHAR(60) NOT NULL PRIMARY KEY,
    Brand VARCHAR(100) NOT NULL,
    Name VARCHAR(200) NOT NULL,
    ShortDesc VARCHAR(400) NULL,
    CategoryCode VARCHAR(30) NOT NULL,
    SubType VARCHAR(100) NULL,
    PetType VARCHAR(10) NOT NULL DEFAULT 'both',
    Sizes VARCHAR(200) NULL,
    Price DECIMAL(18,0) NOT NULL,
    OriginalPrice DECIMAL(18,0) NULL,
    PrimaryImage VARCHAR(500) NOT NULL,
    StockCount INT NOT NULL DEFAULT 0,
    IsFeatured TINYINT NOT NULL DEFAULT 0,
    IsActive TINYINT NOT NULL DEFAULT 1,
    CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT FK_Products_Categories FOREIGN KEY (CategoryCode) REFERENCES Categories(CategoryCode),
    CONSTRAINT CK_Products_PetType CHECK (PetType IN ('dog', 'cat', 'both')),
    CONSTRAINT CK_Products_Price CHECK (Price >= 0),
    CONSTRAINT CK_Products_StockCount CHECK (StockCount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Đánh giá sản phẩm
CREATE TABLE IF NOT EXISTS ProductReviews (
    ReviewId INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ProductId VARCHAR(60) NOT NULL,
    UserId INT NULL,
    AuthorName VARCHAR(120) NOT NULL,
    PetTag VARCHAR(100) NULL,
    Rating TINYINT NOT NULL,
    Comment VARCHAR(1000) NOT NULL,
    CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT FK_ProductReviews_Products FOREIGN KEY (ProductId) REFERENCES Products(ProductId) ON DELETE CASCADE,
    CONSTRAINT FK_ProductReviews_Users FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE SET NULL,
    CONSTRAINT CK_ProductReviews_Rating CHECK (Rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Đơn hàng (UserId = NULL cho Khách vãng lai không cần đăng nhập)
CREATE TABLE IF NOT EXISTS Orders (
    OrderId INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    OrderCode VARCHAR(20) NOT NULL UNIQUE,
    UserId INT NULL,
    IsGuest TINYINT NOT NULL DEFAULT 1,
    CustomerName VARCHAR(120) NOT NULL,
    CustomerPhone VARCHAR(20) NOT NULL,
    CustomerEmail VARCHAR(150) NULL,
    DeliveryMethod VARCHAR(20) NOT NULL,
    ShippingAddress VARCHAR(350) NOT NULL,
    PaymentMethod VARCHAR(20) NOT NULL,
    -- Trạng thái thanh toán: unpaid (chưa thu tiền), paid (đã thu), failed (thất bại), refunded (hoàn tiền)
    PaymentStatus VARCHAR(20) NOT NULL DEFAULT 'unpaid',
    PaidAt DATETIME NULL,
    OrderStatus VARCHAR(20) NOT NULL DEFAULT 'pending',
    OrderSource VARCHAR(20) NOT NULL DEFAULT 'online',
    TotalAmount DECIMAL(18,0) NOT NULL,
    StaffName VARCHAR(120) NULL,
    CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX IX_Orders_Lookup (OrderCode, CustomerPhone),
    CONSTRAINT FK_Orders_Users FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE SET NULL,
    CONSTRAINT CK_Orders_DeliveryMethod CHECK (DeliveryMethod IN ('delivery', 'pickup')),
    CONSTRAINT CK_Orders_PaymentMethod CHECK (PaymentMethod IN ('vnpay', 'momo', 'cod')),
    CONSTRAINT CK_Orders_PaymentStatus CHECK (PaymentStatus IN ('unpaid', 'paid', 'failed', 'refunded')),
    CONSTRAINT CK_Orders_OrderStatus CHECK (OrderStatus IN ('pending', 'shipping', 'completed', 'cancelled')),
    CONSTRAINT CK_Orders_OrderSource CHECK (OrderSource IN ('online', 'pos')),
    CONSTRAINT CK_Orders_TotalAmount CHECK (TotalAmount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Chi tiết đơn hàng (Lưu snapshot tên & giá tại thời điểm mua)
CREATE TABLE IF NOT EXISTS OrderItems (
    OrderItemId INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    OrderId INT NOT NULL,
    ProductId VARCHAR(60) NULL,
    ProductName VARCHAR(200) NOT NULL,
    ProductImage VARCHAR(500) NOT NULL,
    VariantLabel VARCHAR(100) NULL,
    UnitPrice DECIMAL(18,0) NOT NULL,
    Quantity INT NOT NULL,
    CONSTRAINT FK_OrderItems_Orders FOREIGN KEY (OrderId) REFERENCES Orders(OrderId) ON DELETE CASCADE,
    CONSTRAINT FK_OrderItems_Products FOREIGN KEY (ProductId) REFERENCES Products(ProductId) ON DELETE SET NULL,
    CONSTRAINT CK_OrderItems_UnitPrice CHECK (UnitPrice >= 0),
    CONSTRAINT CK_OrderItems_Quantity CHECK (Quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Gói dịch vụ Spa
CREATE TABLE IF NOT EXISTS SpaPackages (
    PackageId VARCHAR(30) NOT NULL PRIMARY KEY,
    Name VARCHAR(150) NOT NULL,
    Description VARCHAR(400) NULL,
    Price DECIMAL(18,0) NOT NULL,
    DurationLabel VARCHAR(50) NOT NULL,
    CONSTRAINT CK_SpaPackages_Price CHECK (Price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Đặt lịch Spa (UserId = NULL cho Khách vãng lai)
CREATE TABLE IF NOT EXISTS ServiceBookings (
    BookingId INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    BookingCode VARCHAR(20) NOT NULL UNIQUE,
    UserId INT NULL,
    PackageId VARCHAR(30) NULL,
    ServiceName VARCHAR(150) NOT NULL,
    PetNameOrType VARCHAR(120) NOT NULL,
    BookingDate DATE NOT NULL,
    TimeSlot VARCHAR(40) NOT NULL,
    Price DECIMAL(18,0) NOT NULL,
    Status VARCHAR(20) NOT NULL DEFAULT 'upcoming',
    CustomerName VARCHAR(120) NOT NULL,
    CustomerPhone VARCHAR(20) NOT NULL,
    StaffName VARCHAR(120) NULL,
    Note VARCHAR(400) NULL,
    CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT FK_ServiceBookings_Users FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE SET NULL,
    CONSTRAINT FK_ServiceBookings_SpaPackages FOREIGN KEY (PackageId) REFERENCES SpaPackages(PackageId) ON DELETE SET NULL,
    CONSTRAINT CK_ServiceBookings_Price CHECK (Price >= 0),
    CONSTRAINT CK_ServiceBookings_Status CHECK (Status IN ('upcoming', 'completed', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Tin nhắn liên hệ (Không cần đăng nhập)
CREATE TABLE IF NOT EXISTS ContactMessages (
    MessageId INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    SenderName VARCHAR(120) NOT NULL,
    SenderPhone VARCHAR(20) NOT NULL,
    Topic VARCHAR(150) NOT NULL,
    Message VARCHAR(1000) NOT NULL,
    Status VARCHAR(20) NOT NULL DEFAULT 'new',
    CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT CK_ContactMessages_Status CHECK (Status IN ('new', 'replied', 'closed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Sản phẩm yêu thích của hội viên (Wishlist)
CREATE TABLE IF NOT EXISTS UserWishlists (
    UserId INT NOT NULL,
    ProductId VARCHAR(60) NOT NULL,
    CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (UserId, ProductId),
    CONSTRAINT FK_UserWishlists_Users FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE CASCADE,
    CONSTRAINT FK_UserWishlists_Products FOREIGN KEY (ProductId) REFERENCES Products(ProductId) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. Danh sách nhân viên trực ca (dùng chung tài khoản staff)
CREATE TABLE IF NOT EXISTS StaffRoster (
    StaffId INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    StaffName VARCHAR(120) NOT NULL UNIQUE,
    CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. Ma trận phân quyền tài khoản staff dùng chung
CREATE TABLE IF NOT EXISTS StaffPermissions (
    PermKey VARCHAR(50) NOT NULL PRIMARY KEY,
    IsAllowed TINYINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. Cấu hình cổng thanh toán (COD / VNPay / MoMo)
CREATE TABLE IF NOT EXISTS PaymentGatewayConfigs (
    Gateway VARCHAR(20) NOT NULL PRIMARY KEY,
    DisplayName VARCHAR(100) NOT NULL,
    IsEnabled TINYINT NOT NULL DEFAULT 1,
    Environment VARCHAR(20) NOT NULL DEFAULT 'sandbox',
    MerchantCode VARCHAR(100) NULL,  -- VNPay: vnp_TmnCode | MoMo: partnerCode
    AccessKey VARCHAR(200) NULL,     -- MoMo: accessKey
    SecretKey VARCHAR(300) NULL,     -- VNPay: vnp_HashSecret | MoMo: secretKey
    Note VARCHAR(400) NULL,
    UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT CK_PaymentGatewayConfigs_Gateway CHECK (Gateway IN ('cod', 'vnpay', 'momo')),
    CONSTRAINT CK_PaymentGatewayConfigs_Env CHECK (Environment IN ('sandbox', 'production'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 15. Lịch sử giao dịch thanh toán của đơn hàng
CREATE TABLE IF NOT EXISTS PaymentTransactions (
    TransactionId INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    OrderId INT NOT NULL,
    TxnRef VARCHAR(60) NOT NULL UNIQUE,  -- Mã tham chiếu gửi sang cổng (vnp_TxnRef / MoMo orderId)
    Gateway VARCHAR(20) NOT NULL,
    Amount DECIMAL(18,0) NOT NULL,
    Status VARCHAR(20) NOT NULL DEFAULT 'pending',
    BankCode VARCHAR(30) NULL,
    GatewayTransNo VARCHAR(60) NULL,   -- vnp_TransactionNo / MoMo transId
    ResponseCode VARCHAR(20) NULL,     -- vnp_ResponseCode / MoMo resultCode
    PayUrl VARCHAR(2000) NULL,
    Note VARCHAR(400) NULL,
    RawData LONGTEXT NULL,
    CreatedBy VARCHAR(120) NULL,
    CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX IX_PaymentTransactions_Order (OrderId, CreatedAt),
    CONSTRAINT FK_PaymentTransactions_Orders FOREIGN KEY (OrderId) REFERENCES Orders(OrderId) ON DELETE CASCADE,
    CONSTRAINT CK_PaymentTransactions_Gateway CHECK (Gateway IN ('vnpay', 'momo', 'cod', 'cash', 'manual')),
    CONSTRAINT CK_PaymentTransactions_Amount CHECK (Amount >= 0),
    CONSTRAINT CK_PaymentTransactions_Status CHECK (Status IN ('pending', 'success', 'failed', 'refunded'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Dữ liệu mẫu (Seed Data)
-- ============================================================================

-- 1. Tài khoản mẫu (Admin, Staff, Customer)
--    Mật khẩu mẫu dạng văn bản: Backend tự động băm lại sang Bcrypt ở lần đăng nhập đầu tiên.
INSERT INTO Users (Username, FullName, Email, Phone, PasswordHash, Role, Gender, Status)
SELECT 'admin', 'Trịnh Anh Khoa', 'admin@pethub.vn', '0909 123 456', 'Admin@123', 'admin', 'Nam', 'active'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Users WHERE Email = 'admin@pethub.vn');

INSERT INTO Users (Username, FullName, Email, Phone, PasswordHash, Role, Gender, Status)
SELECT 'staff', 'Linh Phạm', 'staff@pethub.vn', '0909 686 868', 'Staff@123', 'staff', 'Nữ', 'active'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Users WHERE Email = 'staff@pethub.vn');

INSERT INTO Users (Username, FullName, Email, Phone, PasswordHash, Role, Gender, Status)
SELECT NULL, 'Trịnh Anh Khoa', 'khoa.trinh@pethub.vn', '0909 123 456', '123456', 'customer', 'Nam', 'active'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Users WHERE Email = 'khoa.trinh@pethub.vn');

-- 2. Địa chỉ mặc định cho tài khoản Customer
INSERT INTO UserAddresses (UserId, Label, RecipientName, Phone, FullAddress, IsDefault)
SELECT u.UserId, 'Nhà riêng', u.FullName, u.Phone, '128 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh', 1
FROM Users u
WHERE u.Email = 'khoa.trinh@pethub.vn'
  AND NOT EXISTS (SELECT 1 FROM UserAddresses a WHERE a.UserId = u.UserId);

-- 3. Danh mục sản phẩm
INSERT INTO Categories (CategoryCode, Name) VALUES
    ('food',     'Dinh dưỡng & Pate'),
    ('hygiene',  'Thuốc & Làm đẹp'),
    ('bed',      'Nệm & Không gian nghỉ'),
    ('backpack', 'Balo & Phụ kiện'),
    ('spa',      'Dịch vụ chăm sóc')
ON DUPLICATE KEY UPDATE CategoryCode = CategoryCode;

-- 4. Sản phẩm mẫu
INSERT INTO Products (ProductId, Brand, Name, ShortDesc, CategoryCode, SubType, PetType, Sizes, Price, OriginalPrice, PrimaryImage, StockCount, IsFeatured) VALUES
    ('prod-rc-mini',              'ROYAL CANIN',        'Hạt dinh dưỡng cho chó giống nhỏ Mini Adult', 'Hỗ trợ tiêu hóa và lông mượt.',   'food',     'Dinh dưỡng & Hạt khô', 'dog',  '2 kg, 4 kg, 8 kg',    389000, 489000, 'https://images.unsplash.com/photo-1589924691995-400dc9ecc119?auto=format&fit=crop&w=900&q=85', 22, 0),
    ('prod-gourmet-chicken-pate', 'PETSFRIEND GOURMET', 'Pate ức gà tươi & bí đỏ hầm nhuyễn',          'Giàu đạm dễ tiêu hóa.',           'food',     'Pate & Bánh thưởng',   'both', 'Lon 160g, Lốc 6 lon',  45000,   NULL, '/images/prod-chicken-pate.jpg', 65, 1),
    ('prod-dog-shampoo',          'PETSFRIEND CARE',    'Sữa tắm thảo mộc dịu nhẹ cho chó',            'Chiết xuất hoa cúc và yến mạch.', 'hygiene',  'Sữa tắm & Dưỡng lông', 'dog',  'Chai 500ml',          165000,   NULL, '/images/prod-dog-shampoo.jpg',  44, 1),
    ('prod-ceramic-bowl-dog',     'PETSFRIEND HOME',    'Bát ăn gốm sứ chân gỗ chống trượt',           'Gốm sứ nung cao cấp dễ vệ sinh.', 'backpack', 'Dụng cụ ăn uống',      'both', 'Trắng kem',           100000,   NULL, '/images/prod-ceramic-bowl.jpg', 38, 1)
ON DUPLICATE KEY UPDATE ProductId = ProductId;

-- 5. Gói dịch vụ Spa
INSERT INTO SpaPackages (PackageId, Name, Description, Price, DurationLabel) VALUES
    ('pkg-1', 'Tắm thảo mộc & Thư giãn',         'Tắm sạch sâu 2 lần bằng sữa tắm hữu cơ.',   180000, '45 phút'),
    ('pkg-2', 'Cắt tỉa & Tạo phom lông thẩm mỹ', 'Tỉa gọn khuôn mặt và tạo phom tự nhiên.',   280000, '60 phút'),
    ('pkg-3', 'Chăm sóc Toàn diện 7 Bước',       'Trọn gói tắm, massage, cắt tỉa, cắt móng.', 390000, '90 phút'),
    ('pkg-4', 'Khách sạn thú cưng 5 sao',        'Phòng riêng điều hòa, camera 24/7.',        150000, '24 giờ')
ON DUPLICATE KEY UPDATE PackageId = PackageId;

-- 6. Đơn hàng mẫu của Khách vãng lai mua tại quầy POS (UserId = NULL, IsGuest = 1)
INSERT INTO Orders (OrderCode, UserId, IsGuest, CustomerName, CustomerPhone, CustomerEmail, DeliveryMethod, ShippingAddress, PaymentMethod, PaymentStatus, PaidAt, OrderStatus, OrderSource, TotalAmount, StaffName)
SELECT 'PH261116', NULL, 1, 'Hồ Minh Tuấn', '0907345112', NULL, 'pickup', '128 Nguyễn Trãi, Quận 1, TP.HCM', 'cod', 'paid', UTC_TIMESTAMP(), 'completed', 'pos', 489000, 'Hà Lê'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM Orders WHERE OrderCode = 'PH261116');

INSERT INTO OrderItems (OrderId, ProductId, ProductName, ProductImage, VariantLabel, UnitPrice, Quantity)
SELECT o.OrderId, p.ProductId, p.Name, p.PrimaryImage, '2 kg', p.Price, 1
FROM Orders o
CROSS JOIN Products p
WHERE o.OrderCode = 'PH261116'
  AND p.ProductId = 'prod-rc-mini'
  AND NOT EXISTS (
      SELECT 1 FROM OrderItems oi WHERE oi.OrderId = o.OrderId AND oi.ProductId = 'prod-rc-mini'
  );

INSERT INTO OrderItems (OrderId, ProductId, ProductName, ProductImage, VariantLabel, UnitPrice, Quantity)
SELECT o.OrderId, p.ProductId, p.Name, p.PrimaryImage, 'Trắng kem', p.Price, 1
FROM Orders o
CROSS JOIN Products p
WHERE o.OrderCode = 'PH261116'
  AND p.ProductId = 'prod-ceramic-bowl-dog'
  AND NOT EXISTS (
      SELECT 1 FROM OrderItems oi WHERE oi.OrderId = o.OrderId AND oi.ProductId = 'prod-ceramic-bowl-dog'
  );

INSERT INTO PaymentTransactions (OrderId, TxnRef, Gateway, Amount, Status, ResponseCode, Note, CreatedBy)
SELECT o.OrderId, 'PH261116-POS', 'cash', o.TotalAmount, 'success', '00', 'Thu tiền mặt tại quầy POS', 'Hà Lê'
FROM Orders o
WHERE o.OrderCode = 'PH261116'
  AND NOT EXISTS (
      SELECT 1 FROM PaymentTransactions pt WHERE pt.TxnRef = 'PH261116-POS'
  );

-- 7. Lịch hẹn Spa mẫu của Khách vãng lai (UserId = NULL)
INSERT INTO ServiceBookings (BookingCode, UserId, PackageId, ServiceName, PetNameOrType, BookingDate, TimeSlot, Price, Status, CustomerName, CustomerPhone, StaffName, Note)
SELECT 'BK261116', NULL, 'pkg-1', 'Tắm thảo mộc & Thư giãn', 'Coco (Pomeranian)', '2026-11-16', '09:00 Sáng', 180000, 'upcoming', 'Lê Thảo Vy', '0935678920', 'Linh Phạm', 'Bé hơi nhát máy sấy.'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM ServiceBookings WHERE BookingCode = 'BK261116');

-- 8. Danh sách nhân viên trực ca
INSERT INTO StaffRoster (StaffName) VALUES
    ('Linh Phạm'),
    ('Hà Lê'),
    ('Mai Nguyễn'),
    ('An Trần')
ON DUPLICATE KEY UPDATE StaffName = StaffName;

-- 9. Ma trận phân quyền mặc định cho tài khoản Staff
INSERT INTO StaffPermissions (PermKey, IsAllowed) VALUES
    ('ordersManage',   1),
    ('ordersInvoices', 1),
    ('pos',            1),
    ('appointments',   1),
    ('inventoryView',  1),
    ('inventoryEdit',  0),
    ('analytics',      0),
    ('settings',       0)
ON DUPLICATE KEY UPDATE PermKey = PermKey;

-- 10. Cấu hình cổng thanh toán (Sandbox)
INSERT INTO PaymentGatewayConfigs (Gateway, DisplayName, IsEnabled, Environment, MerchantCode, AccessKey, SecretKey, Note) VALUES
    ('cod',   'Thanh toán khi nhận hàng (COD)', 1, 'production', NULL,       NULL,             NULL,
        'Khách kiểm tra hàng trước khi thanh toán trực tiếp cho shipper hoặc tại quầy PetsFriend.'),
    ('vnpay', 'VNPay QR / ATM nội địa',         1, 'sandbox',    'PETHUB01', NULL,             'PETSFRIENDVNPAYSANDBOXSECRETKEY2026',
        'Cổng VNPay Sandbox - thẻ test NCB 9704198526191432198, tên NGUYEN VAN A, ngày phát hành 07/15, OTP 123456.'),
    ('momo',  'Ví điện tử MoMo',                1, 'sandbox',    'MOMO',     'F8BBA842ECF85',  'K951B6PE1waDMi640xX08PD3vg6EkVlz',
        'Cổng MoMo Test (captureWallet) - quét bằng ứng dụng MoMo Test.')
ON DUPLICATE KEY UPDATE Gateway = Gateway;

-- 11. Đồng bộ trạng thái thanh toán cho đơn hàng cũ (nếu nâng cấp từ DB cũ)
UPDATE Orders
SET PaymentStatus = 'paid', PaidAt = COALESCE(PaidAt, CreatedAt)
WHERE OrderId > 0
  AND PaymentStatus = 'unpaid'
  AND PaidAt IS NULL
  AND (OrderSource = 'pos' OR OrderStatus = 'completed');

-- 12. Bảng dịch vụ & lịch hẹn mở rộng (bổ sung từ khanh-backend)
CREATE TABLE IF NOT EXISTS Services (
    Id          VARCHAR(30)  NOT NULL PRIMARY KEY,
    Name        VARCHAR(150) NOT NULL,
    Description VARCHAR(500) NULL,
    Price       INT          NOT NULL,
    Duration    VARCHAR(30)  NULL,
    IsPopular   TINYINT   NOT NULL DEFAULT 0,
    CONSTRAINT CK_Services_Price CHECK (Price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Bookings (
    Id            VARCHAR(30)  NOT NULL PRIMARY KEY,
    ServiceId     VARCHAR(30)  NULL,
    ServiceName   VARCHAR(150) NOT NULL,
    PetName       VARCHAR(100) NOT NULL,
    BookingDate   DATE         NOT NULL,
    TimeSlot      VARCHAR(30)  NOT NULL,
    Price         INT          NOT NULL,
    Status        VARCHAR(20)  NOT NULL DEFAULT 'upcoming',
    Note          VARCHAR(500) NULL,
    CustomerName  VARCHAR(100) NULL,
    CustomerPhone VARCHAR(30)  NULL,
    StaffName     VARCHAR(100) NULL,
    CreatedAt     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT FK_Bookings_Services FOREIGN KEY (ServiceId) REFERENCES Services(Id) ON DELETE SET NULL,
    CONSTRAINT CK_Bookings_Price CHECK (Price >= 0),
    CONSTRAINT CK_Bookings_Status CHECK (Status IN ('upcoming', 'completed', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO Services (Id, Name, Description, Price, Duration, IsPopular) VALUES
    ('pkg-1', 'Tắm thảo mộc & Thư giãn',         'Tắm sạch sâu 2 lần, sấy ấm ion âm, vệ sinh tuyến hôi, xịt dưỡng mượt lông.', 180000, '45 phút', 0),
    ('pkg-2', 'Cắt tỉa & Tạo phom lông thẩm mỹ', 'Tỉa gọn khuôn mặt, tạo phom lông bồng bềnh, vệ sinh bàn chân và bụng.',     280000, '60 phút', 0),
    ('pkg-3', 'Chăm sóc Toàn diện 7 Bước',       'Tắm thảo mộc, massage, sấy tạo phom, cắt tỉa, dũa móng, vệ sinh tai.',       390000, '90 phút', 1),
    ('pkg-4', 'Khách sạn thú cưng 5 sao',        'Phòng riêng điều hòa, camera 24/7, 3 bữa dinh dưỡng, dạo chơi hằng ngày.',   150000, '24 giờ',  0)
ON DUPLICATE KEY UPDATE Id = Id;

INSERT INTO Bookings (Id, ServiceId, ServiceName, PetName, BookingDate, TimeSlot, Price, Status, Note, CustomerName, CustomerPhone, StaffName) VALUES
    ('BK261115', 'pkg-3', 'Chăm sóc Toàn diện 7 Bước',       'Milo (Corgi 2 tuổi)',      '2026-11-18', '10:30 Sáng',  390000, 'upcoming',  'Tỉa gọn lông bàn chân và bụng, bé hiền.',  'Trịnh Anh Khoa', '0909 123 456', NULL),
    ('BK261116', 'pkg-1', 'Tắm thảo mộc & Thư giãn',         'Coco (Pomeranian)',        '2026-11-16', '09:00 Sáng',  180000, 'upcoming',  'Bé hơi nhát máy sấy, sấy nhẹ gió ấm.',     'Lê Thảo Vy',     '0935 678 920', 'Linh Phạm'),
    ('BK261117', 'pkg-2', 'Cắt tỉa & Tạo phom lông thẩm mỹ', 'Teddy (Poodle nâu)',       '2026-11-17', '14:00 Chiều', 280000, 'upcoming',  'Tỉa kiểu gấu bông tròn mặt.',              'Võ Ngọc Linh',   '0908 765 421', 'Mai Nguyễn'),
    ('BK261119', 'pkg-2', 'Cắt tỉa & Tạo phom lông thẩm mỹ', 'Choco (Poodle đen)',       '2026-11-19', '16:00 Chiều', 280000, 'upcoming',  NULL,                                        'Ngô Bảo Ngọc',   '0987 555 013', 'Mai Nguyễn'),
    ('BK261114', 'pkg-4', 'Khách sạn thú cưng 5 sao',        'Mochi (Samoyed)',          '2026-11-14', '10:30 Sáng',  150000, 'completed', 'Lưu trú 2 ngày kèm khẩu phần hạt riêng.', 'Đặng Gia Bảo',   '0973 345 890', 'An Trần'),
    ('BK261113', 'pkg-3', 'Chăm sóc Toàn diện 7 Bước',       'Bông (Mèo Anh lông ngắn)', '2026-11-13', '16:00 Chiều', 390000, 'completed', 'Vệ sinh tai & cắt móng định kỳ.',          'Trịnh Anh Khoa', '0909 123 456', 'Linh Phạm')
ON DUPLICATE KEY UPDATE Id = Id;

-- 13. Bảng cấu hình thông tin cửa hàng (bổ sung từ khanh-backend)
CREATE TABLE IF NOT EXISTS StoreSettings (
    Id            INT NOT NULL PRIMARY KEY,
    StoreName     VARCHAR(200) NOT NULL,
    StreetAddress VARCHAR(200) NULL,
    District      VARCHAR(100) NULL,
    City          VARCHAR(100) NULL,
    Hotline       VARCHAR(30)  NULL,
    Phone         VARCHAR(30)  NULL,
    Email         VARCHAR(150) NULL,
    ZaloUrl       VARCHAR(300) NULL,
    FacebookUrl   VARCHAR(300) NULL,
    Hours         VARCHAR(100) NULL,
    Timezone      VARCHAR(100) NULL,
    Currency      VARCHAR(30)  NULL,
    CONSTRAINT CK_StoreSettings_Id CHECK (Id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO StoreSettings (Id, StoreName, StreetAddress, District, City, Hotline, Phone, Email, ZaloUrl, FacebookUrl, Hours, Timezone, Currency)
VALUES (
    1,
    'PetsFriend Flagship — Chi nhánh Quận 1',
    '128 Nguyễn Trãi, P. Bến Thành',
    'Quận 1',
    'TP. Hồ Chí Minh',
    '1900 6868',
    '0909 686 868',
    'chamsoc@pethub.vn',
    'https://zalo.me/0909686868',
    'https://www.facebook.com/pethub.vn',
    '08:00 – 21:00 mỗi ngày',
    'Asia/Ho_Chi_Minh (UTC+07:00)',
    'VND (₫)'
)
ON DUPLICATE KEY UPDATE Id = Id;

SET SQL_SAFE_UPDATES = @OLD_SQL_SAFE_UPDATES;
