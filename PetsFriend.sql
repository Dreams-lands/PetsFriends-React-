CREATE DATABASE PetsFriend;
GO

USE PetsFriend;
GO

-- 1. Người dùng (Customer, Staff, Admin)
CREATE TABLE dbo.Users (
    UserId INT IDENTITY(1,1) PRIMARY KEY,
    Username NVARCHAR(50) NULL,
    FullName NVARCHAR(120) NOT NULL,
    Email NVARCHAR(150) NOT NULL UNIQUE,
    Phone NVARCHAR(20) NULL,
    PasswordHash NVARCHAR(255) NOT NULL,
    Role NVARCHAR(20) NOT NULL DEFAULT N'customer' CHECK (Role IN (N'customer', N'staff', N'admin')),
    CreatedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- 2. Sổ địa chỉ (Dành cho thành viên đã đăng nhập)
CREATE TABLE dbo.UserAddresses (
    AddressId INT IDENTITY(1,1) PRIMARY KEY,
    UserId INT NOT NULL FOREIGN KEY REFERENCES dbo.Users(UserId) ON DELETE CASCADE,
    Label NVARCHAR(60) NOT NULL,
    RecipientName NVARCHAR(120) NOT NULL,
    Phone NVARCHAR(20) NOT NULL,
    FullAddress NVARCHAR(300) NOT NULL,
    IsDefault BIT NOT NULL DEFAULT 0
);
GO

-- 3. Danh mục sản phẩm
CREATE TABLE dbo.Categories (
    CategoryCode NVARCHAR(30) PRIMARY KEY, -- food, hygiene, bed, backpack, spa
    Name NVARCHAR(100) NOT NULL
);
GO

-- 4. Sản phẩm
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
GO

-- 5. Đánh giá sản phẩm
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
GO

-- 6. Đơn hàng (UserId = NULL cho Khách vãng lai không cần đăng nhập)
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
    OrderStatus NVARCHAR(20) NOT NULL DEFAULT N'pending' CHECK (OrderStatus IN (N'pending', N'shipping', N'completed', N'cancelled')),
    OrderSource NVARCHAR(20) NOT NULL DEFAULT N'online' CHECK (OrderSource IN (N'online', N'pos')),
    TotalAmount DECIMAL(18,0) NOT NULL CHECK (TotalAmount >= 0),
    StaffName NVARCHAR(120) NULL,
    CreatedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE INDEX IX_Orders_Lookup ON dbo.Orders (OrderCode, CustomerPhone);
GO

-- 7. Chi tiết đơn hàng (Lưu snapshot tên & giá tại thời điểm mua)
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
GO

-- 8. Gói dịch vụ Spa
CREATE TABLE dbo.SpaPackages (
    PackageId NVARCHAR(30) PRIMARY KEY,
    Name NVARCHAR(150) NOT NULL,
    Description NVARCHAR(400) NULL,
    Price DECIMAL(18,0) NOT NULL CHECK (Price >= 0),
    DurationLabel NVARCHAR(50) NOT NULL
);
GO

-- 9. Đặt lịch Spa (UserId = NULL cho Khách vãng lai)
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
GO

-- 10. Tin nhắn liên hệ (Không cần đăng nhập)
CREATE TABLE dbo.ContactMessages (
    MessageId INT IDENTITY(1,1) PRIMARY KEY,
    SenderName NVARCHAR(120) NOT NULL,
    SenderPhone NVARCHAR(20) NOT NULL,
    Topic NVARCHAR(150) NOT NULL,
    Message NVARCHAR(1000) NOT NULL,
    Status NVARCHAR(20) NOT NULL DEFAULT N'new' CHECK (Status IN (N'new', N'replied', N'closed')),
    CreatedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- Dữ liệu mẫu --
-- 1. Tài khoản mẫu (Admin, Staff, Customer)
INSERT INTO dbo.Users (Username, FullName, Email, Phone, PasswordHash, Role) VALUES
(N'admin', N'Trịnh Anh Khoa', N'admin@pethub.vn', N'0909 123 456', N'Admin@123', N'admin'),
(N'staff', N'Linh Phạm', N'staff@pethub.vn', N'0909 686 868', N'Staff@123', N'staff'),
(NULL, N'Trịnh Anh Khoa', N'khoa.trinh@pethub.vn', N'0909 123 456', N'123456', N'customer');
GO

-- 2. Địa chỉ cho tài khoản Customer
INSERT INTO dbo.UserAddresses (UserId, Label, RecipientName, Phone, FullAddress, IsDefault)
SELECT UserId, N'Nhà riêng', FullName, Phone, N'128 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh', 1
FROM dbo.Users WHERE Email = N'khoa.trinh@pethub.vn';
GO

-- 3. Danh mục sản phẩm
INSERT INTO dbo.Categories (CategoryCode, Name) VALUES
(N'food', N'Dinh dưỡng & Pate'),
(N'hygiene', N'Thuốc & Làm đẹp'),
(N'bed', N'Nệm & Không gian nghỉ'),
(N'backpack', N'Balo & Phụ kiện'),
(N'spa', N'Dịch vụ chăm sóc');
GO

-- 4. Sản phẩm mẫu
INSERT INTO dbo.Products (ProductId, Brand, Name, ShortDesc, CategoryCode, SubType, PetType, Sizes, Price, OriginalPrice, PrimaryImage, StockCount, IsFeatured) VALUES
(N'prod-rc-mini', N'ROYAL CANIN', N'Hạt dinh dưỡng cho chó giống nhỏ Mini Adult', N'Hỗ trợ tiêu hóa và lông mượt.', N'food', N'Dinh dưỡng & Hạt khô', N'dog', N'2 kg, 4 kg, 8 kg', 389000, 489000, N'https://images.unsplash.com/photo-1589924691995-400dc9ecc119?auto=format&fit=crop&w=900&q=85', 22, 0),
(N'prod-gourmet-chicken-pate', N'PETSFRIEND GOURMET', N'Pate ức gà tươi & bí đỏ hầm nhuyễn', N'Giàu đạm dễ tiêu hóa.', N'food', N'Pate & Bánh thưởng', N'both', N'Lon 160g, Lốc 6 lon', 45000, NULL, N'/images/prod-chicken-pate.jpg', 65, 1),
(N'prod-dog-shampoo', N'PETSFRIEND CARE', N'Sữa tắm thảo mộc dịu nhẹ cho chó', N'Chiết xuất hoa cúc và yến mạch.', N'hygiene', N'Sữa tắm & Dưỡng lông', N'dog', N'Chai 500ml', 165000, NULL, N'/images/prod-dog-shampoo.jpg', 44, 1),
(N'prod-ceramic-bowl-dog', N'PETSFRIEND HOME', N'Bát ăn gốm sứ chân gỗ chống trượt', N'Gốm sứ nung cao cấp dễ vệ sinh.', N'backpack', N'Dụng cụ ăn uống', N'both', N'Trắng kem', 100000, NULL, N'/images/prod-ceramic-bowl.jpg', 38, 1);
GO

-- 5. Gói dịch vụ Spa
INSERT INTO dbo.SpaPackages (PackageId, Name, Description, Price, DurationLabel) VALUES
(N'pkg-1', N'Tắm thảo mộc & Thư giãn', N'Tắm sạch sâu 2 lần bằng sữa tắm hữu cơ.', 180000, N'45 phút'),
(N'pkg-2', N'Cắt tỉa & Tạo phom lông thẩm mỹ', N'Tỉa gọn khuôn mặt và tạo phom tự nhiên.', 280000, N'60 phút'),
(N'pkg-3', N'Chăm sóc Toàn diện 7 Bước', N'Trọn gói tắm, massage, cắt tỉa, cắt móng.', 390000, N'90 phút'),
(N'pkg-4', N'Khách sạn thú cưng 5 sao', N'Phòng riêng điều hòa, camera 24/7.', 150000, N'24 giờ');
GO

-- 6. Đơn hàng mẫu của Khách vãng lai (UserId = NULL, IsGuest = 1)
INSERT INTO dbo.Orders (OrderCode, UserId, IsGuest, CustomerName, CustomerPhone, CustomerEmail, DeliveryMethod, ShippingAddress, PaymentMethod, OrderStatus, OrderSource, TotalAmount, StaffName)
VALUES (N'PH261116', NULL, 1, N'Hồ Minh Tuấn', N'0907345112', NULL, N'pickup', N'128 Nguyễn Trãi, Quận 1, TP.HCM', N'cod', N'completed', N'pos', 489000, N'Hà Lê');

INSERT INTO dbo.OrderItems (OrderId, ProductId, ProductName, ProductImage, VariantLabel, UnitPrice, Quantity)
SELECT o.OrderId, p.ProductId, p.Name, p.PrimaryImage, N'2 kg', p.Price, 1
FROM dbo.Orders o, dbo.Products p
WHERE o.OrderCode = N'PH261116' AND p.ProductId = N'prod-rc-mini';

INSERT INTO dbo.OrderItems (OrderId, ProductId, ProductName, ProductImage, VariantLabel, UnitPrice, Quantity)
SELECT o.OrderId, p.ProductId, p.Name, p.PrimaryImage, N'Trắng kem', p.Price, 1
FROM dbo.Orders o, dbo.Products p
WHERE o.OrderCode = N'PH261116' AND p.ProductId = N'prod-ceramic-bowl-dog';
GO

-- 7. Lịch hẹn Spa mẫu của Khách vãng lai (UserId = NULL)
INSERT INTO dbo.ServiceBookings (BookingCode, UserId, PackageId, ServiceName, PetNameOrType, BookingDate, TimeSlot, Price, Status, CustomerName, CustomerPhone, StaffName, Note)
VALUES (N'BK261116', NULL, N'pkg-1', N'Tắm thảo mộc & Thư giãn', N'Coco (Pomeranian)', '2026-11-16', N'09:00 Sáng', 180000, N'upcoming', N'Lê Thảo Vy', N'0935678920', N'Linh Phạm', N'Bé hơi nhát máy sấy.');
GO
