-- ============================================================================
-- Dự án: PetsFriend (QLThuCung) - Dữ liệu mẫu để test
-- Thứ tự chạy: FILE 2 / 2 (Chạy sau 01_create_database_and_schema.sql)
-- Script viết dạng IDEMPOTENT: chạy lại nhiều lần không bị nhân đôi dữ liệu.
-- ============================================================================

USE QLThuCung;
GO

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

-- 2. Địa chỉ cho tài khoản Customer
INSERT INTO dbo.UserAddresses (UserId, Label, RecipientName, Phone, FullAddress, IsDefault)
SELECT u.UserId, N'Nhà riêng', u.FullName, u.Phone, N'128 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh', 1
FROM dbo.Users u
WHERE u.Email = N'khoa.trinh@pethub.vn'
  AND NOT EXISTS (SELECT 1 FROM dbo.UserAddresses a WHERE a.UserId = u.UserId);
GO

-- 3. Danh mục sản phẩm
MERGE dbo.Categories AS t
USING (VALUES
    (N'food', N'Dinh dưỡng & Pate'),
    (N'hygiene', N'Thuốc & Làm đẹp'),
    (N'bed', N'Nệm & Không gian nghỉ'),
    (N'backpack', N'Balo & Phụ kiện'),
    (N'spa', N'Dịch vụ chăm sóc')
) AS s (CategoryCode, Name)
ON t.CategoryCode = s.CategoryCode
WHEN NOT MATCHED THEN INSERT (CategoryCode, Name) VALUES (s.CategoryCode, s.Name);
GO

-- 4. Sản phẩm mẫu
MERGE dbo.Products AS t
USING (VALUES
    (N'prod-rc-mini', N'ROYAL CANIN', N'Hạt dinh dưỡng cho chó giống nhỏ Mini Adult', N'Hỗ trợ tiêu hóa và lông mượt.', N'food', N'Dinh dưỡng & Hạt khô', N'dog', N'2 kg, 4 kg, 8 kg', 389000, 489000, N'https://images.unsplash.com/photo-1589924691995-400dc9ecc119?auto=format&fit=crop&w=900&q=85', 22, 0),
    (N'prod-gourmet-chicken-pate', N'PETSFRIEND GOURMET', N'Pate ức gà tươi & bí đỏ hầm nhuyễn', N'Giàu đạm dễ tiêu hóa.', N'food', N'Pate & Bánh thưởng', N'both', N'Lon 160g, Lốc 6 lon', 45000, NULL, N'/images/prod-chicken-pate.jpg', 65, 1),
    (N'prod-dog-shampoo', N'PETSFRIEND CARE', N'Sữa tắm thảo mộc dịu nhẹ cho chó', N'Chiết xuất hoa cúc và yến mạch.', N'hygiene', N'Sữa tắm & Dưỡng lông', N'dog', N'Chai 500ml', 165000, NULL, N'/images/prod-dog-shampoo.jpg', 44, 1),
    (N'prod-ceramic-bowl-dog', N'PETSFRIEND HOME', N'Bát ăn gốm sứ chân gỗ chống trượt', N'Gốm sứ nung cao cấp dễ vệ sinh.', N'backpack', N'Dụng cụ ăn uống', N'both', N'Trắng kem', 100000, NULL, N'/images/prod-ceramic-bowl.jpg', 38, 1)
) AS s (ProductId, Brand, Name, ShortDesc, CategoryCode, SubType, PetType, Sizes, Price, OriginalPrice, PrimaryImage, StockCount, IsFeatured)
ON t.ProductId = s.ProductId
WHEN NOT MATCHED THEN
    INSERT (ProductId, Brand, Name, ShortDesc, CategoryCode, SubType, PetType, Sizes, Price, OriginalPrice, PrimaryImage, StockCount, IsFeatured)
    VALUES (s.ProductId, s.Brand, s.Name, s.ShortDesc, s.CategoryCode, s.SubType, s.PetType, s.Sizes, s.Price, s.OriginalPrice, s.PrimaryImage, s.StockCount, s.IsFeatured);
GO

-- 5. Gói dịch vụ Spa
MERGE dbo.SpaPackages AS t
USING (VALUES
    (N'pkg-1', N'Tắm thảo mộc & Thư giãn', N'Tắm sạch sâu 2 lần bằng sữa tắm hữu cơ.', 180000, N'45 phút'),
    (N'pkg-2', N'Cắt tỉa & Tạo phom lông thẩm mỹ', N'Tỉa gọn khuôn mặt và tạo phom tự nhiên.', 280000, N'60 phút'),
    (N'pkg-3', N'Chăm sóc Toàn diện 7 Bước', N'Trọn gói tắm, massage, cắt tỉa, cắt móng.', 390000, N'90 phút'),
    (N'pkg-4', N'Khách sạn thú cưng 5 sao', N'Phòng riêng điều hòa, camera 24/7.', 150000, N'24 giờ')
) AS s (PackageId, Name, Description, Price, DurationLabel)
ON t.PackageId = s.PackageId
WHEN NOT MATCHED THEN
    INSERT (PackageId, Name, Description, Price, DurationLabel)
    VALUES (s.PackageId, s.Name, s.Description, s.Price, s.DurationLabel);
GO

-- 6. Đơn hàng mẫu của Khách vãng lai mua tại quầy POS (UserId = NULL, IsGuest = 1, đã thu tiền)
IF NOT EXISTS (SELECT 1 FROM dbo.Orders WHERE OrderCode = N'PH261116')
BEGIN
    INSERT INTO dbo.Orders (OrderCode, UserId, IsGuest, CustomerName, CustomerPhone, CustomerEmail, DeliveryMethod, ShippingAddress, PaymentMethod, OrderStatus, OrderSource, TotalAmount, StaffName, PaymentStatus, PaidAt)
    VALUES (N'PH261116', NULL, 1, N'Hồ Minh Tuấn', N'0907345112', NULL, N'pickup', N'128 Nguyễn Trãi, Quận 1, TP.HCM', N'cod', N'completed', N'pos', 489000, N'Hà Lê', N'paid', SYSUTCDATETIME());

    INSERT INTO dbo.OrderItems (OrderId, ProductId, ProductName, ProductImage, VariantLabel, UnitPrice, Quantity)
    SELECT o.OrderId, p.ProductId, p.Name, p.PrimaryImage, N'2 kg', p.Price, 1
    FROM dbo.Orders o, dbo.Products p
    WHERE o.OrderCode = N'PH261116' AND p.ProductId = N'prod-rc-mini';

    INSERT INTO dbo.OrderItems (OrderId, ProductId, ProductName, ProductImage, VariantLabel, UnitPrice, Quantity)
    SELECT o.OrderId, p.ProductId, p.Name, p.PrimaryImage, N'Trắng kem', p.Price, 1
    FROM dbo.Orders o, dbo.Products p
    WHERE o.OrderCode = N'PH261116' AND p.ProductId = N'prod-ceramic-bowl-dog';

    INSERT INTO dbo.PaymentTransactions (OrderId, TxnRef, Gateway, Amount, Status, ResponseCode, Note, CreatedBy)
    SELECT o.OrderId, N'PH261116-POS', N'cash', o.TotalAmount, N'success', N'00', N'Thu tiền mặt tại quầy POS', N'Hà Lê'
    FROM dbo.Orders o WHERE o.OrderCode = N'PH261116';
END
GO

-- 7. Lịch hẹn Spa mẫu của Khách vãng lai (UserId = NULL)
IF NOT EXISTS (SELECT 1 FROM dbo.ServiceBookings WHERE BookingCode = N'BK261116')
    INSERT INTO dbo.ServiceBookings (BookingCode, UserId, PackageId, ServiceName, PetNameOrType, BookingDate, TimeSlot, Price, Status, CustomerName, CustomerPhone, StaffName, Note)
    VALUES (N'BK261116', NULL, N'pkg-1', N'Tắm thảo mộc & Thư giãn', N'Coco (Pomeranian)', '2026-11-16', N'09:00 Sáng', 180000, N'upcoming', N'Lê Thảo Vy', N'0935678920', N'Linh Phạm', N'Bé hơi nhát máy sấy.');
GO

-- 8. Danh sách nhân viên trực ca dùng chung tài khoản staff
MERGE dbo.StaffRoster AS t
USING (VALUES (N'Linh Phạm'), (N'Hà Lê'), (N'Mai Nguyễn'), (N'An Trần')) AS s (StaffName)
ON t.StaffName = s.StaffName
WHEN NOT MATCHED THEN INSERT (StaffName) VALUES (s.StaffName);
GO

-- 9. Ma trận phân quyền mặc định của tài khoản staff
MERGE dbo.StaffPermissions AS t
USING (VALUES
    (N'ordersManage', 1), (N'ordersInvoices', 1), (N'pos', 1), (N'appointments', 1),
    (N'inventoryView', 1), (N'inventoryEdit', 0), (N'analytics', 0), (N'settings', 0)
) AS s (PermKey, IsAllowed)
ON t.PermKey = s.PermKey
WHEN NOT MATCHED THEN INSERT (PermKey, IsAllowed) VALUES (s.PermKey, s.IsAllowed);
GO

-- 10. Cấu hình cổng thanh toán (Sandbox dùng cho đồ án)
--     VNPay Sandbox: đăng ký miễn phí tại https://sandbox.vnpayment.vn/devreg/ để lấy vnp_TmnCode & vnp_HashSecret
--     MoMo Test: bộ khóa công khai dành cho môi trường test của MoMo Developers
MERGE dbo.PaymentGatewayConfigs AS t
USING (VALUES
    (N'cod',   N'Thanh toán khi nhận hàng (COD)', 1, N'production', NULL, NULL, NULL,
        N'Khách kiểm tra hàng trước khi thanh toán trực tiếp cho shipper hoặc tại quầy PetsFriend.'),
    (N'vnpay', N'VNPay QR / ATM nội địa', 1, N'sandbox', N'PETHUB01', NULL, N'PETSFRIENDVNPAYSANDBOXSECRETKEY2026',
        N'Cổng VNPay Sandbox - thẻ test NCB 9704198526191432198, tên NGUYEN VAN A, ngày phát hành 07/15, OTP 123456.'),
    (N'momo',  N'Ví điện tử MoMo', 1, N'sandbox', N'MOMO', N'F8BBA842ECF85', N'K951B6PE1waDMi640xX08PD3vg6EkVlz',
        N'Cổng MoMo Test (captureWallet) - quét bằng ứng dụng MoMo Test.')
) AS s (Gateway, DisplayName, IsEnabled, Environment, MerchantCode, AccessKey, SecretKey, Note)
ON t.Gateway = s.Gateway
WHEN NOT MATCHED THEN
    INSERT (Gateway, DisplayName, IsEnabled, Environment, MerchantCode, AccessKey, SecretKey, Note)
    VALUES (s.Gateway, s.DisplayName, s.IsEnabled, s.Environment, s.MerchantCode, s.AccessKey, s.SecretKey, s.Note);
GO

-- 11. Đồng bộ trạng thái thanh toán cho các đơn hàng cũ (trước khi có cột PaymentStatus)
--     - Đơn bán tại quầy POS hoặc đơn đã hoàn thành: coi như đã thu tiền.
UPDATE dbo.Orders
SET PaymentStatus = N'paid', PaidAt = COALESCE(PaidAt, CreatedAt)
WHERE PaymentStatus = N'unpaid'
  AND PaidAt IS NULL
  AND (OrderSource = N'pos' OR OrderStatus = N'completed');
GO
