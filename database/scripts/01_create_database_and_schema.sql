-- ============================================================================
-- Dự án: PetsFriend (QLThuCung) - SQL Server (T-SQL)
-- Thứ tự chạy: FILE 1 / 2 (Tạo Database & Các bảng cốt lõi)
-- ============================================================================

IF DB_ID(N'QLThuCung') IS NULL
    CREATE DATABASE QLThuCung;
GO

USE QLThuCung;
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
