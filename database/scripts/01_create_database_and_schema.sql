-- ============================================================================
-- Dự án: PetsFriend (QLThuCung) - SQL Server (T-SQL)
-- Thứ tự chạy: FILE 1 / 2 (Tạo Database & Các bảng cốt lõi)
-- Script viết dạng IDEMPOTENT: chạy lại nhiều lần an toàn, tự bổ sung cột / bảng
-- còn thiếu trên DB cũ mà KHÔNG xóa dữ liệu hiện có.
-- ============================================================================

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
        PasswordHash NVARCHAR(255) NOT NULL,
        Role NVARCHAR(20) NOT NULL DEFAULT N'customer' CHECK (Role IN (N'customer', N'staff', N'admin')),
        CreatedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

-- 1.1 Bổ sung Giới tính & Trạng thái tài khoản (phân hệ User)
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
        OrderStatus NVARCHAR(20) NOT NULL DEFAULT N'pending' CHECK (OrderStatus IN (N'pending', N'shipping', N'completed', N'cancelled')),
        OrderSource NVARCHAR(20) NOT NULL DEFAULT N'online' CHECK (OrderSource IN (N'online', N'pos')),
        TotalAmount DECIMAL(18,0) NOT NULL CHECK (TotalAmount >= 0),
        StaffName NVARCHAR(120) NULL,
        CreatedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Orders_Lookup' AND object_id = OBJECT_ID(N'dbo.Orders'))
    CREATE INDEX IX_Orders_Lookup ON dbo.Orders (OrderCode, CustomerPhone);
GO

-- 6.1 Bổ sung Trạng thái thanh toán của đơn hàng (phân hệ Thanh toán)
--     unpaid   : chưa thu tiền (COD chưa giao / chưa quét VNPay - MoMo)
--     paid     : đã thu tiền (POS tại quầy, COD đã giao, cổng online báo thành công)
--     failed   : giao dịch online thất bại / khách hủy trên cổng thanh toán
--     refunded : đã hoàn tiền (đơn đã thu tiền nhưng bị hủy)
IF COL_LENGTH(N'dbo.Orders', N'PaymentStatus') IS NULL
    ALTER TABLE dbo.Orders ADD
        PaymentStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_Orders_PaymentStatus DEFAULT N'unpaid',
        CONSTRAINT CK_Orders_PaymentStatus CHECK (PaymentStatus IN (N'unpaid', N'paid', N'failed', N'refunded'));
GO

IF COL_LENGTH(N'dbo.Orders', N'PaidAt') IS NULL
    ALTER TABLE dbo.Orders ADD PaidAt DATETIME2(0) NULL;
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
