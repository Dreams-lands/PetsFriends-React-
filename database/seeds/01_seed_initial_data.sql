-- ============================================================================
-- Dự án: PetsFriend (QLThuCung) - Dữ liệu mẫu để test
-- Thứ tự chạy: FILE 2 / 2 (Chạy sau 01_create_database_and_schema.sql)
-- ============================================================================

USE QLThuCung;
GO

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
