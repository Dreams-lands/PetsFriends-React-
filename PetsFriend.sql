IF DB_ID(N'QLThuCung') IS NULL
    CREATE DATABASE QLThuCung;
GO

USE QLThuCung;
GO

-- 1. Người dùng (Customer, Staff, Admin)
IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        UserId INT IDENTITY(1,1) PRIMARY KEY,
        Username NVARCHAR(50) NULL,
        FullName NVARCHAR(120) NOT NULL,
        Email NVARCHAR(150) NOT NULL UNIQUE,
        Phone NVARCHAR(20) NULL,
        Gender NVARCHAR(15) NULL,
        PasswordHash NVARCHAR(255) NOT NULL,
        Role NVARCHAR(20) NOT NULL DEFAULT N'customer' CHECK (Role IN (N'customer', N'staff', N'admin')),
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_Users_Status DEFAULT N'active'
            CONSTRAINT CK_Users_Status CHECK (Status IN (N'active', N'inactive', N'banned')),
        CreatedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF COL_LENGTH(N'dbo.Users', N'Gender') IS NULL
    ALTER TABLE dbo.Users ADD Gender NVARCHAR(15) NULL;
GO

IF COL_LENGTH(N'dbo.Users', N'Status') IS NULL
    ALTER TABLE dbo.Users ADD
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_Users_Status DEFAULT N'active',
        CONSTRAINT CK_Users_Status CHECK (Status IN (N'active', N'inactive', N'banned'));
GO

-- 2. Sổ địa chỉ (Dành cho thành viên đã đăng nhập)
IF OBJECT_ID(N'dbo.UserAddresses', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserAddresses (
        AddressId INT IDENTITY(1,1) PRIMARY KEY,
        UserId INT NOT NULL FOREIGN KEY REFERENCES dbo.Users(UserId) ON DELETE CASCADE,
        Label NVARCHAR(60) NOT NULL,
        RecipientName NVARCHAR(120) NOT NULL,
        Phone NVARCHAR(20) NOT NULL,
        FullAddress NVARCHAR(300) NOT NULL,
        IsDefault BIT NOT NULL DEFAULT 0
    );
END
GO

-- 3. Danh mục sản phẩm
IF OBJECT_ID(N'dbo.Categories', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Categories (
        CategoryCode NVARCHAR(30) PRIMARY KEY, -- food, hygiene, bed, backpack, spa
        Name NVARCHAR(100) NOT NULL
    );
END
GO

-- 4. Sản phẩm
IF OBJECT_ID(N'dbo.Products', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Products (
        ProductId NVARCHAR(60) PRIMARY KEY,
        Brand NVARCHAR(100) NOT NULL,
        Name NVARCHAR(200) NOT NULL,
        ShortDesc NVARCHAR(400) NULL,
        CategoryCode NVARCHAR(30) NOT NULL FOREIGN KEY REFERENCES dbo.Categories(CategoryCode),
        SubType NVARCHAR(100) NULL,
        PetType NVARCHAR(10) NOT NULL DEFAULT N'both' CHECK (PetType IN (N'dog', N'cat', N'both')),
        Sizes NVARCHAR(200) NULL,
        Price DECIMAL(18,0) NOT NULL CHECK (Price >= 0),
        OriginalPrice DECIMAL(18,0) NULL,
        PrimaryImage NVARCHAR(500) NOT NULL,
        StockCount INT NOT NULL DEFAULT 0 CHECK (StockCount >= 0),
        IsFeatured BIT NOT NULL DEFAULT 0,
        IsActive BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

-- 5. Đánh giá sản phẩm
IF OBJECT_ID(N'dbo.ProductReviews', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProductReviews (
        ReviewId INT IDENTITY(1,1) PRIMARY KEY,
        ProductId NVARCHAR(60) NOT NULL FOREIGN KEY REFERENCES dbo.Products(ProductId) ON DELETE CASCADE,
        UserId INT NULL FOREIGN KEY REFERENCES dbo.Users(UserId) ON DELETE SET NULL,
        AuthorName NVARCHAR(120) NOT NULL,
        PetTag NVARCHAR(100) NULL,
        Rating TINYINT NOT NULL CHECK (Rating BETWEEN 1 AND 5),
        Comment NVARCHAR(1000) NOT NULL,
        CreatedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

-- 6. Đơn hàng (UserId = NULL cho Khách vãng lai không cần đăng nhập)
IF OBJECT_ID(N'dbo.Orders', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Orders (
        OrderId INT IDENTITY(1,1) PRIMARY KEY,
        OrderCode NVARCHAR(20) NOT NULL UNIQUE,
        UserId INT NULL FOREIGN KEY REFERENCES dbo.Users(UserId) ON DELETE SET NULL,
        IsGuest BIT NOT NULL DEFAULT 1,
        CustomerName NVARCHAR(120) NOT NULL,
        CustomerPhone NVARCHAR(20) NOT NULL,
        CustomerEmail NVARCHAR(150) NULL,
        DeliveryMethod NVARCHAR(20) NOT NULL CHECK (DeliveryMethod IN (N'delivery', N'pickup')),
        ShippingAddress NVARCHAR(350) NOT NULL,
        PaymentMethod NVARCHAR(20) NOT NULL CHECK (PaymentMethod IN (N'vnpay', N'momo', N'cod')),
        -- Trạng thái thanh toán: unpaid (chưa thu tiền), paid (đã thu), failed (thất bại), refunded (hoàn tiền)
        PaymentStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_Orders_PaymentStatus DEFAULT N'unpaid'
            CONSTRAINT CK_Orders_PaymentStatus CHECK (PaymentStatus IN (N'unpaid', N'paid', N'failed', N'refunded')),
        PaidAt DATETIME2(0) NULL,
        OrderStatus NVARCHAR(20) NOT NULL DEFAULT N'pending' CHECK (OrderStatus IN (N'pending', N'shipping', N'completed', N'cancelled')),
        OrderSource NVARCHAR(20) NOT NULL DEFAULT N'online' CHECK (OrderSource IN (N'online', N'pos')),
        TotalAmount DECIMAL(18,0) NOT NULL CHECK (TotalAmount >= 0),
        StaffName NVARCHAR(120) NULL,
        CreatedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF COL_LENGTH(N'dbo.Orders', N'PaymentStatus') IS NULL
    ALTER TABLE dbo.Orders ADD
        PaymentStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_Orders_PaymentStatus DEFAULT N'unpaid',
        CONSTRAINT CK_Orders_PaymentStatus CHECK (PaymentStatus IN (N'unpaid', N'paid', N'failed', N'refunded'));
GO

IF COL_LENGTH(N'dbo.Orders', N'PaidAt') IS NULL
    ALTER TABLE dbo.Orders ADD PaidAt DATETIME2(0) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Orders_Lookup' AND object_id = OBJECT_ID(N'dbo.Orders'))
    CREATE INDEX IX_Orders_Lookup ON dbo.Orders (OrderCode, CustomerPhone);
GO

-- 7. Chi tiết đơn hàng (Lưu snapshot tên & giá tại thời điểm mua)
IF OBJECT_ID(N'dbo.OrderItems', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.OrderItems (
        OrderItemId INT IDENTITY(1,1) PRIMARY KEY,
        OrderId INT NOT NULL FOREIGN KEY REFERENCES dbo.Orders(OrderId) ON DELETE CASCADE,
        ProductId NVARCHAR(60) NULL FOREIGN KEY REFERENCES dbo.Products(ProductId) ON DELETE SET NULL,
        ProductName NVARCHAR(200) NOT NULL,
        ProductImage NVARCHAR(500) NOT NULL,
        VariantLabel NVARCHAR(100) NULL,
        UnitPrice DECIMAL(18,0) NOT NULL CHECK (UnitPrice >= 0),
        Quantity INT NOT NULL CHECK (Quantity > 0)
    );
END
GO

-- 8. Gói dịch vụ Spa
IF OBJECT_ID(N'dbo.SpaPackages', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SpaPackages (
        PackageId NVARCHAR(30) PRIMARY KEY,
        Name NVARCHAR(150) NOT NULL,
        Description NVARCHAR(400) NULL,
        Price DECIMAL(18,0) NOT NULL CHECK (Price >= 0),
        DurationLabel NVARCHAR(50) NOT NULL
    );
END
GO

-- 9. Đặt lịch Spa (UserId = NULL cho Khách vãng lai)
IF OBJECT_ID(N'dbo.ServiceBookings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ServiceBookings (
        BookingId INT IDENTITY(1,1) PRIMARY KEY,
        BookingCode NVARCHAR(20) NOT NULL UNIQUE,
        UserId INT NULL FOREIGN KEY REFERENCES dbo.Users(UserId) ON DELETE SET NULL,
        PackageId NVARCHAR(30) NULL FOREIGN KEY REFERENCES dbo.SpaPackages(PackageId) ON DELETE SET NULL,
        ServiceName NVARCHAR(150) NOT NULL,
        PetNameOrType NVARCHAR(120) NOT NULL,
        BookingDate DATE NOT NULL,
        TimeSlot NVARCHAR(40) NOT NULL,
        Price DECIMAL(18,0) NOT NULL CHECK (Price >= 0),
        Status NVARCHAR(20) NOT NULL DEFAULT N'upcoming' CHECK (Status IN (N'upcoming', N'completed', N'cancelled')),
        CustomerName NVARCHAR(120) NOT NULL,
        CustomerPhone NVARCHAR(20) NOT NULL,
        StaffName NVARCHAR(120) NULL,
        Note NVARCHAR(400) NULL,
        CreatedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

-- 10. Tin nhắn liên hệ (Không cần đăng nhập)
IF OBJECT_ID(N'dbo.ContactMessages', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ContactMessages (
        MessageId INT IDENTITY(1,1) PRIMARY KEY,
        SenderName NVARCHAR(120) NOT NULL,
        SenderPhone NVARCHAR(20) NOT NULL,
        Topic NVARCHAR(150) NOT NULL,
        Message NVARCHAR(1000) NOT NULL,
        Status NVARCHAR(20) NOT NULL DEFAULT N'new' CHECK (Status IN (N'new', N'replied', N'closed')),
        CreatedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

-- 11. Sản phẩm yêu thích của hội viên (Wishlist)
IF OBJECT_ID(N'dbo.UserWishlists', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserWishlists (
        UserId INT NOT NULL FOREIGN KEY REFERENCES dbo.Users(UserId) ON DELETE CASCADE,
        ProductId NVARCHAR(60) NOT NULL FOREIGN KEY REFERENCES dbo.Products(ProductId) ON DELETE CASCADE,
        CreatedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_UserWishlists PRIMARY KEY (UserId, ProductId)
    );
END
GO

-- 12. Danh sách nhân viên trực ca (dùng chung tài khoản staff)
IF OBJECT_ID(N'dbo.StaffRoster', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.StaffRoster (
        StaffId INT IDENTITY(1,1) PRIMARY KEY,
        StaffName NVARCHAR(120) NOT NULL UNIQUE,
        CreatedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

-- 13. Ma trận phân quyền tài khoản staff dùng chung
IF OBJECT_ID(N'dbo.StaffPermissions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.StaffPermissions (
        PermKey NVARCHAR(50) PRIMARY KEY,
        IsAllowed BIT NOT NULL
    );
END
GO

-- 14. Cấu hình cổng thanh toán (COD / VNPay / MoMo)
IF OBJECT_ID(N'dbo.PaymentGatewayConfigs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PaymentGatewayConfigs (
        Gateway NVARCHAR(20) PRIMARY KEY CHECK (Gateway IN (N'cod', N'vnpay', N'momo')),
        DisplayName NVARCHAR(100) NOT NULL,
        IsEnabled BIT NOT NULL DEFAULT 1,
        Environment NVARCHAR(20) NOT NULL DEFAULT N'sandbox' CHECK (Environment IN (N'sandbox', N'production')),
        MerchantCode NVARCHAR(100) NULL,  -- VNPay: vnp_TmnCode | MoMo: partnerCode
        AccessKey NVARCHAR(200) NULL,     -- MoMo: accessKey
        SecretKey NVARCHAR(300) NULL,     -- VNPay: vnp_HashSecret | MoMo: secretKey
        Note NVARCHAR(400) NULL,
        UpdatedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

-- 15. Lịch sử giao dịch thanh toán của đơn hàng
IF OBJECT_ID(N'dbo.PaymentTransactions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PaymentTransactions (
        TransactionId INT IDENTITY(1,1) PRIMARY KEY,
        OrderId INT NOT NULL FOREIGN KEY REFERENCES dbo.Orders(OrderId) ON DELETE CASCADE,
        TxnRef NVARCHAR(60) NOT NULL UNIQUE,  -- Mã tham chiếu gửi sang cổng (vnp_TxnRef / MoMo orderId)
        Gateway NVARCHAR(20) NOT NULL CHECK (Gateway IN (N'vnpay', N'momo', N'cod', N'cash', N'manual')),
        Amount DECIMAL(18,0) NOT NULL CHECK (Amount >= 0),
        Status NVARCHAR(20) NOT NULL DEFAULT N'pending' CHECK (Status IN (N'pending', N'success', N'failed', N'refunded')),
        BankCode NVARCHAR(30) NULL,
        GatewayTransNo NVARCHAR(60) NULL,   -- vnp_TransactionNo / MoMo transId
        ResponseCode NVARCHAR(20) NULL,     -- vnp_ResponseCode / MoMo resultCode
        PayUrl NVARCHAR(2000) NULL,
        Note NVARCHAR(400) NULL,
        RawData NVARCHAR(MAX) NULL,
        CreatedBy NVARCHAR(120) NULL,
        CreatedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_PaymentTransactions_Order' AND object_id = OBJECT_ID(N'dbo.PaymentTransactions'))
    CREATE INDEX IX_PaymentTransactions_Order ON dbo.PaymentTransactions (OrderId, CreatedAt);
GO

-- ============================================================================
-- Dữ liệu mẫu (Seed Data)
-- ============================================================================

-- 1. Tài khoản mẫu (Admin, Staff, Customer)
--    Mật khẩu mẫu dạng văn bản: Backend tự động băm lại sang Bcrypt ở lần đăng nhập đầu tiên.
IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE Email = N'admin@pethub.vn')
    INSERT INTO dbo.Users (Username, FullName, Email, Phone, PasswordHash, Role, Gender, Status)
    VALUES (N'admin', N'Trịnh Anh Khoa', N'admin@pethub.vn', N'0909 123 456', N'Admin@123', N'admin', N'Nam', N'active');

IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE Email = N'staff@pethub.vn')
    INSERT INTO dbo.Users (Username, FullName, Email, Phone, PasswordHash, Role, Gender, Status)
    VALUES (N'staff', N'Linh Phạm', N'staff@pethub.vn', N'0909 686 868', N'Staff@123', N'staff', N'Nữ', N'active');

IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE Email = N'khoa.trinh@pethub.vn')
    INSERT INTO dbo.Users (Username, FullName, Email, Phone, PasswordHash, Role, Gender, Status)
    VALUES (NULL, N'Trịnh Anh Khoa', N'khoa.trinh@pethub.vn', N'0909 123 456', N'123456', N'customer', N'Nam', N'active');
GO

-- 2. Địa chỉ mặc định cho tài khoản Customer
INSERT INTO dbo.UserAddresses (UserId, Label, RecipientName, Phone, FullAddress, IsDefault)
SELECT u.UserId, N'Nhà riêng', u.FullName, u.Phone, N'128 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh', 1
FROM dbo.Users u
WHERE u.Email = N'khoa.trinh@pethub.vn'
  AND NOT EXISTS (SELECT 1 FROM dbo.UserAddresses a WHERE a.UserId = u.UserId);
GO

-- 3. Danh mục sản phẩm
MERGE dbo.Categories AS t
USING (VALUES
    (N'food',     N'Dinh dưỡng & Pate'),
    (N'hygiene',  N'Thuốc & Làm đẹp'),
    (N'bed',      N'Nệm & Không gian nghỉ'),
    (N'backpack', N'Balo & Phụ kiện'),
    (N'spa',      N'Dịch vụ chăm sóc')
) AS s (CategoryCode, Name)
ON t.CategoryCode = s.CategoryCode
WHEN NOT MATCHED THEN
    INSERT (CategoryCode, Name) VALUES (s.CategoryCode, s.Name);
GO

-- 4. Sản phẩm mẫu
MERGE dbo.Products AS t
USING (VALUES
    (N'prod-rc-mini',             N'ROYAL CANIN',        N'Hạt dinh dưỡng cho chó giống nhỏ Mini Adult', N'Hỗ trợ tiêu hóa và lông mượt.',   N'food',     N'Dinh dưỡng & Hạt khô', N'dog',  N'2 kg, 4 kg, 8 kg',    389000, 489000, N'https://images.unsplash.com/photo-1589924691995-400dc9ecc119?auto=format&fit=crop&w=900&q=85', 22, 0),
    (N'prod-gourmet-chicken-pate', N'PETSFRIEND GOURMET', N'Pate ức gà tươi & bí đỏ hầm nhuyễn',          N'Giàu đạm dễ tiêu hóa.',           N'food',     N'Pate & Bánh thưởng',   N'both', N'Lon 160g, Lốc 6 lon',  45000,   NULL, N'/images/prod-chicken-pate.jpg', 65, 1),
    (N'prod-dog-shampoo',          N'PETSFRIEND CARE',    N'Sữa tắm thảo mộc dịu nhẹ cho chó',          N'Chiết xuất hoa cúc và yến mạch.', N'hygiene',  N'Sữa tắm & Dưỡng lông', N'dog',  N'Chai 500ml',          165000,   NULL, N'/images/prod-dog-shampoo.jpg',  44, 1),
    (N'prod-ceramic-bowl-dog',     N'PETSFRIEND HOME',    N'Bát ăn gốm sứ chân gỗ chống trượt',         N'Gốm sứ nung cao cấp dễ vệ sinh.', N'backpack', N'Dụng cụ ăn uống',      N'both', N'Trắng kem',           100000,   NULL, N'/images/prod-ceramic-bowl.jpg', 38, 1)
) AS s (ProductId, Brand, Name, ShortDesc, CategoryCode, SubType, PetType, Sizes, Price, OriginalPrice, PrimaryImage, StockCount, IsFeatured)
ON t.ProductId = s.ProductId
WHEN NOT MATCHED THEN
    INSERT (ProductId, Brand, Name, ShortDesc, CategoryCode, SubType, PetType, Sizes, Price, OriginalPrice, PrimaryImage, StockCount, IsFeatured)
    VALUES (s.ProductId, s.Brand, s.Name, s.ShortDesc, s.CategoryCode, s.SubType, s.PetType, s.Sizes, s.Price, s.OriginalPrice, s.PrimaryImage, s.StockCount, s.IsFeatured);
GO

-- 5. Gói dịch vụ Spa
MERGE dbo.SpaPackages AS t
USING (VALUES
    (N'pkg-1', N'Tắm thảo mộc & Thư giãn',          N'Tắm sạch sâu 2 lần bằng sữa tắm hữu cơ.',   180000, N'45 phút'),
    (N'pkg-2', N'Cắt tỉa & Tạo phom lông thẩm mỹ',  N'Tỉa gọn khuôn mặt và tạo phom tự nhiên.',   280000, N'60 phút'),
    (N'pkg-3', N'Chăm sóc Toàn diện 7 Bước',        N'Trọn gói tắm, massage, cắt tỉa, cắt móng.', 390000, N'90 phút'),
    (N'pkg-4', N'Khách sạn thú cưng 5 sao',         N'Phòng riêng điều hòa, camera 24/7.',        150000, N'24 giờ')
) AS s (PackageId, Name, Description, Price, DurationLabel)
ON t.PackageId = s.PackageId
WHEN NOT MATCHED THEN
    INSERT (PackageId, Name, Description, Price, DurationLabel)
    VALUES (s.PackageId, s.Name, s.Description, s.Price, s.DurationLabel);
GO

-- 6. Đơn hàng mẫu của Khách vãng lai mua tại quầy POS (UserId = NULL, IsGuest = 1)
IF NOT EXISTS (SELECT 1 FROM dbo.Orders WHERE OrderCode = N'PH261116')
BEGIN
    INSERT INTO dbo.Orders (OrderCode, UserId, IsGuest, CustomerName, CustomerPhone, CustomerEmail, DeliveryMethod, ShippingAddress, PaymentMethod, PaymentStatus, PaidAt, OrderStatus, OrderSource, TotalAmount, StaffName)
    VALUES (N'PH261116', NULL, 1, N'Hồ Minh Tuấn', N'0907345112', NULL, N'pickup', N'128 Nguyễn Trãi, Quận 1, TP.HCM', N'cod', N'paid', SYSUTCDATETIME(), N'completed', N'pos', 489000, N'Hà Lê');

    INSERT INTO dbo.OrderItems (OrderId, ProductId, ProductName, ProductImage, VariantLabel, UnitPrice, Quantity)
    SELECT o.OrderId, p.ProductId, p.Name, p.PrimaryImage, N'2 kg', p.Price, 1
    FROM dbo.Orders o
    CROSS JOIN dbo.Products p
    WHERE o.OrderCode = N'PH261116' AND p.ProductId = N'prod-rc-mini';

    INSERT INTO dbo.OrderItems (OrderId, ProductId, ProductName, ProductImage, VariantLabel, UnitPrice, Quantity)
    SELECT o.OrderId, p.ProductId, p.Name, p.PrimaryImage, N'Trắng kem', p.Price, 1
    FROM dbo.Orders o
    CROSS JOIN dbo.Products p
    WHERE o.OrderCode = N'PH261116' AND p.ProductId = N'prod-ceramic-bowl-dog';

    INSERT INTO dbo.PaymentTransactions (OrderId, TxnRef, Gateway, Amount, Status, ResponseCode, Note, CreatedBy)
    SELECT o.OrderId, N'PH261116-POS', N'cash', o.TotalAmount, N'success', N'00', N'Thu tiền mặt tại quầy POS', N'Hà Lê'
    FROM dbo.Orders o
    WHERE o.OrderCode = N'PH261116';
END
GO

-- 7. Lịch hẹn Spa mẫu của Khách vãng lai (UserId = NULL)
IF NOT EXISTS (SELECT 1 FROM dbo.ServiceBookings WHERE BookingCode = N'BK261116')
    INSERT INTO dbo.ServiceBookings (BookingCode, UserId, PackageId, ServiceName, PetNameOrType, BookingDate, TimeSlot, Price, Status, CustomerName, CustomerPhone, StaffName, Note)
    VALUES (N'BK261116', NULL, N'pkg-1', N'Tắm thảo mộc & Thư giãn', N'Coco (Pomeranian)', '2026-11-16', N'09:00 Sáng', 180000, N'upcoming', N'Lê Thảo Vy', N'0935678920', N'Linh Phạm', N'Bé hơi nhát máy sấy.');
GO

-- 8. Danh sách nhân viên trực ca
MERGE dbo.StaffRoster AS t
USING (VALUES
    (N'Linh Phạm'),
    (N'Hà Lê'),
    (N'Mai Nguyễn'),
    (N'An Trần')
) AS s (StaffName)
ON t.StaffName = s.StaffName
WHEN NOT MATCHED THEN
    INSERT (StaffName) VALUES (s.StaffName);
GO

-- 9. Ma trận phân quyền mặc định cho tài khoản Staff
MERGE dbo.StaffPermissions AS t
USING (VALUES
    (N'ordersManage',   1),
    (N'ordersInvoices', 1),
    (N'pos',            1),
    (N'appointments',   1),
    (N'inventoryView',  1),
    (N'inventoryEdit',  0),
    (N'analytics',      0),
    (N'settings',       0)
) AS s (PermKey, IsAllowed)
ON t.PermKey = s.PermKey
WHEN NOT MATCHED THEN
    INSERT (PermKey, IsAllowed) VALUES (s.PermKey, s.IsAllowed);
GO

-- 10. Cấu hình cổng thanh toán (Sandbox)
MERGE dbo.PaymentGatewayConfigs AS t
USING (VALUES
    (N'cod',   N'Thanh toán khi nhận hàng (COD)', 1, N'production', NULL,        NULL,              NULL,
        N'Khách kiểm tra hàng trước khi thanh toán trực tiếp cho shipper hoặc tại quầy PetsFriend.'),
    (N'vnpay', N'VNPay QR / ATM nội địa',         1, N'sandbox',    N'PETHUB01',  NULL,              N'PETSFRIENDVNPAYSANDBOXSECRETKEY2026',
        N'Cổng VNPay Sandbox - thẻ test NCB 9704198526191432198, tên NGUYEN VAN A, ngày phát hành 07/15, OTP 123456.'),
    (N'momo',  N'Ví điện tử MoMo',                1, N'sandbox',    N'MOMO',      N'F8BBA842ECF85',  N'K951B6PE1waDMi640xX08PD3vg6EkVlz',
        N'Cổng MoMo Test (captureWallet) - quét bằng ứng dụng MoMo Test.')
) AS s (Gateway, DisplayName, IsEnabled, Environment, MerchantCode, AccessKey, SecretKey, Note)
ON t.Gateway = s.Gateway
WHEN NOT MATCHED THEN
    INSERT (Gateway, DisplayName, IsEnabled, Environment, MerchantCode, AccessKey, SecretKey, Note)
    VALUES (s.Gateway, s.DisplayName, s.IsEnabled, s.Environment, s.MerchantCode, s.AccessKey, s.SecretKey, s.Note);
GO

-- 11. Đồng bộ trạng thái thanh toán cho đơn hàng cũ (nếu nâng cấp từ DB cũ)
UPDATE dbo.Orders
SET PaymentStatus = N'paid', PaidAt = COALESCE(PaidAt, CreatedAt)
WHERE PaymentStatus = N'unpaid'
  AND PaidAt IS NULL
  AND (OrderSource = N'pos' OR OrderStatus = N'completed');
GO


-- 12. Bảng dịch vụ & lịch hẹn mở rộng (bổ sung từ khanh-backend)
IF OBJECT_ID('dbo.Services', 'U') IS NULL
CREATE TABLE dbo.Services (
  Id          NVARCHAR(30)  NOT NULL PRIMARY KEY,
  Name        NVARCHAR(150) NOT NULL,
  Description NVARCHAR(500) NULL,
  Price       INT           NOT NULL CHECK (Price >= 0),
  Duration    NVARCHAR(30)  NULL,
  IsPopular   BIT           NOT NULL DEFAULT 0
);
GO
IF OBJECT_ID('dbo.Bookings', 'U') IS NULL
CREATE TABLE dbo.Bookings (
  Id            NVARCHAR(30)  NOT NULL PRIMARY KEY,
  ServiceId     NVARCHAR(30)  NULL REFERENCES dbo.Services(Id),
  ServiceName   NVARCHAR(150) NOT NULL,
  PetName       NVARCHAR(100) NOT NULL,
  BookingDate   DATE          NOT NULL,
  TimeSlot      NVARCHAR(30)  NOT NULL,
  Price         INT           NOT NULL CHECK (Price >= 0),
  Status        NVARCHAR(20)  NOT NULL DEFAULT 'upcoming'
                CHECK (Status IN ('upcoming','completed','cancelled')),
  Note          NVARCHAR(500) NULL,
  CustomerName  NVARCHAR(100) NULL,
  CustomerPhone NVARCHAR(30)  NULL,
  StaffName     NVARCHAR(100) NULL,
  CreatedAt     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM dbo.Services)
INSERT INTO dbo.Services (Id, Name, Description, Price, Duration, IsPopular) VALUES
('pkg-1', N'Tắm thảo mộc & Thư giãn', N'Tắm sạch sâu 2 lần, sấy ấm ion âm, vệ sinh tuyến hôi, xịt dưỡng mượt lông.', 180000, N'45 phút', 0),
('pkg-2', N'Cắt tỉa & Tạo phom lông thẩm mỹ', N'Tỉa gọn khuôn mặt, tạo phom lông bồng bềnh, vệ sinh bàn chân và bụng.', 280000, N'60 phút', 0),
('pkg-3', N'Chăm sóc Toàn diện 7 Bước', N'Tắm thảo mộc, massage, sấy tạo phom, cắt tỉa, dũa móng, vệ sinh tai.', 390000, N'90 phút', 1),
('pkg-4', N'Khách sạn thú cưng 5 sao', N'Phòng riêng điều hòa, camera 24/7, 3 bữa dinh dưỡng, dạo chơi hằng ngày.', 150000, N'24 giờ', 0);
GO
IF NOT EXISTS (SELECT 1 FROM dbo.Bookings)
INSERT INTO dbo.Bookings (Id, ServiceId, ServiceName, PetName, BookingDate, TimeSlot, Price, Status, Note, CustomerName, CustomerPhone, StaffName) VALUES
('BK261115','pkg-3',N'Chăm sóc Toàn diện 7 Bước',N'Milo (Corgi 2 tuổi)','2026-11-18',N'10:30 Sáng',390000,'upcoming',N'Tỉa gọn lông bàn chân và bụng, bé hiền.',N'Trịnh Anh Khoa','0909 123 456',NULL),
('BK261116','pkg-1',N'Tắm thảo mộc & Thư giãn',N'Coco (Pomeranian)','2026-11-16',N'09:00 Sáng',180000,'upcoming',N'Bé hơi nhát máy sấy, sấy nhẹ gió ấm.',N'Lê Thảo Vy','0935 678 920',N'Linh Phạm'),
('BK261117','pkg-2',N'Cắt tỉa & Tạo phom lông thẩm mỹ',N'Teddy (Poodle nâu)','2026-11-17',N'14:00 Chiều',280000,'upcoming',N'Tỉa kiểu gấu bông tròn mặt.',N'Võ Ngọc Linh','0908 765 421',N'Mai Nguyễn'),
('BK261119','pkg-2',N'Cắt tỉa & Tạo phom lông thẩm mỹ',N'Choco (Poodle đen)','2026-11-19',N'16:00 Chiều',280000,'upcoming',NULL,N'Ngô Bảo Ngọc','0987 555 013',N'Mai Nguyễn'),
('BK261114','pkg-4',N'Khách sạn thú cưng 5 sao',N'Mochi (Samoyed)','2026-11-14',N'10:30 Sáng',150000,'completed',N'Lưu trú 2 ngày kèm khẩu phần hạt riêng.',N'Đặng Gia Bảo','0973 345 890',N'An Trần'),
('BK261113','pkg-3',N'Chăm sóc Toàn diện 7 Bước',N'Bông (Mèo Anh lông ngắn)','2026-11-13',N'16:00 Chiều',390000,'completed',N'Vệ sinh tai & cắt móng định kỳ.',N'Trịnh Anh Khoa','0909 123 456',N'Linh Phạm');
GO

-- 13. Bảng cấu hình thông tin cửa hàng (bổ sung từ khanh-backend)
IF OBJECT_ID('dbo.StoreSettings', 'U') IS NULL
CREATE TABLE dbo.StoreSettings (
  Id            INT NOT NULL PRIMARY KEY CHECK (Id = 1),
  StoreName     NVARCHAR(200) NOT NULL,
  StreetAddress NVARCHAR(200) NULL,
  District      NVARCHAR(100) NULL,
  City          NVARCHAR(100) NULL,
  Hotline       NVARCHAR(30)  NULL,
  Phone         NVARCHAR(30)  NULL,
  Email         NVARCHAR(150) NULL,
  ZaloUrl       NVARCHAR(300) NULL,
  FacebookUrl   NVARCHAR(300) NULL,
  Hours         NVARCHAR(100) NULL,
  Timezone      NVARCHAR(100) NULL,
  Currency      NVARCHAR(30)  NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM dbo.StoreSettings)
INSERT INTO dbo.StoreSettings VALUES (1, N'PetsFriend Flagship — Chi nhánh Quận 1', N'128 Nguyễn Trãi, P. Bến Thành', N'Quận 1', N'TP. Hồ Chí Minh',
  N'1900 6868', N'0909 686 868', N'chamsoc@pethub.vn', N'https://zalo.me/0909686868', N'https://www.facebook.com/pethub.vn',
  N'08:00 – 21:00 mỗi ngày', N'Asia/Ho_Chi_Minh (UTC+07:00)', N'VND (₫)');
GO
