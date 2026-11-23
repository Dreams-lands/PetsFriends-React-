USE QLThuCung;
GO
IF OBJECT_ID('dbo.Orders', 'U') IS NULL
CREATE TABLE dbo.Orders (
  Id              NVARCHAR(30)  NOT NULL PRIMARY KEY,
  CreatedAt       DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
  Status          NVARCHAR(20)  NOT NULL DEFAULT 'pending'
                  CHECK (Status IN ('pending','shipping','completed','cancelled')),
  TotalAmount     INT           NOT NULL CHECK (TotalAmount >= 0),
  ShippingAddress NVARCHAR(500) NULL,
  PaymentMethod   NVARCHAR(100) NOT NULL,
  DeliveryMethod  NVARCHAR(10)  NOT NULL DEFAULT 'pickup' CHECK (DeliveryMethod IN ('delivery','pickup')),
  CustomerName    NVARCHAR(100) NOT NULL,
  CustomerPhone   NVARCHAR(30)  NULL,
  CustomerEmail   NVARCHAR(150) NULL,
  StaffName       NVARCHAR(100) NULL,
  IsGuest         BIT           NOT NULL DEFAULT 1,
  StockDeducted   BIT           NOT NULL DEFAULT 0
);
GO
IF OBJECT_ID('dbo.OrderItems', 'U') IS NULL
CREATE TABLE dbo.OrderItems (
  Id        INT IDENTITY(1,1) PRIMARY KEY,
  OrderId   NVARCHAR(30)  NOT NULL REFERENCES dbo.Orders(Id) ON DELETE CASCADE,
  ProductId NVARCHAR(60)  NULL,
  Name      NVARCHAR(200) NOT NULL,
  Image     NVARCHAR(500) NULL,
  Price     INT           NOT NULL,
  Quantity  INT           NOT NULL CHECK (Quantity > 0),
  Variant   NVARCHAR(100) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM Orders WHERE Id = 'PH261115')
BEGIN
  INSERT INTO Orders (Id, CreatedAt, Status, TotalAmount, ShippingAddress, PaymentMethod, DeliveryMethod, CustomerName, CustomerPhone, CustomerEmail, StaffName, IsGuest, StockDeducted) VALUES
  ('PH261115','2026-11-15T16:45:00','pending',985000,N'Nhận tại cửa hàng: 128 Nguyễn Trãi, P. Bến Thành, Quận 1','VNPay','pickup',N'Nguyễn Minh Anh','0903 456 781','minhanh.nguyen@gmail.com',N'Mai Nguyễn',1,0),
  ('PH261114','2026-11-15T11:20:00','pending',790000,N'45 Lê Lợi, P. Bến Nghé, Quận 1','MoMo','delivery',N'Trần Hoàng Nam','0918 222 645','hoangnam.tran@gmail.com',N'Hà Lê',1,0),
  ('PH261116','2026-11-16T09:30:00','completed',489000,N'Thanh toán tại quầy: 128 Nguyễn Trãi, P. Bến Thành, Quận 1',N'Thanh toán khi nhận hàng (COD)','pickup',N'Hồ Minh Tuấn','0907 345 112',NULL,N'Hà Lê',1,1),
  ('PH261112','2026-11-14T19:05:00','completed',1250000,N'215 Hai Bà Trưng, P. Võ Thị Sáu, Quận 3','VNPay','delivery',N'Lê Thảo Vy','0935 678 920','thaovy.le@gmail.com',N'Linh Phạm',0,1),
  ('PH261110','2026-11-13T15:30:00','completed',440000,N'88 Phan Xích Long, Q. Phú Nhuận','MoMo','delivery',N'Phạm Đức Huy','0987 123 456',NULL,N'An Trần',0,1),
  ('PH261105','2026-11-10T10:15:00','cancelled',520000,N'19 Nguyễn Thị Minh Khai, Quận 1',N'Thanh toán khi nhận hàng (COD)','delivery',N'Đặng Gia Bảo','0973 345 890',NULL,N'Hà Lê',1,0);

  INSERT INTO OrderItems (OrderId, ProductId, Name, Image, Price, Quantity, Variant) VALUES
  ('PH261115','prod-cat-litter-box',N'Hộp cát vệ sinh khử mùi có nắp & xẻng xúc cho mèo','/images/prod-cat-litter-box.jpg',440000,1,N'Size Tiêu chuẩn'),
  ('PH261115','prod-yu-shampoo',N'Sữa tắm thảo mộc dịu nhẹ dưỡng lông cho mèo (400ml)',NULL,265000,1,N'Chai 400ml'),
  ('PH261115','prod-collar-cat',N'Vòng cổ lục lạc & Dây dắt mềm an toàn cho mèo','/images/prod-collar-leash.jpg',135000,2,N'Size S'),
  ('PH261114','prod-dog-orthopedic-bed',N'Giường nệm chữ nhật memory foam nâng đỡ xương cho chó','/images/prod-dog-bed.jpg',790000,1,N'Size M'),
  ('PH261116','prod-rc-mini',N'Hạt dinh dưỡng cho chó giống nhỏ Mini Adult (2 kg)','/images/prod-rc-mini.jpg',389000,1,N'Túi 2 kg'),
  ('PH261116','prod-ceramic-bowl',N'Bát ăn gốm sứ chân gỗ chống trượt cho chó mèo','/images/prod-ceramic-bowl.jpg',100000,1,N'Trắng kem'),
  ('PH261112','prod-cat-cage',N'Chuồng mèo biệt thự nhiều tầng sơn tĩnh điện kèm võng','/images/prod-cat-cage.jpg',1250000,1,N'Biệt thự 3 tầng'),
  ('PH261110','prod-vet-antifungal-spray',N'Xịt đặc trị nấm da & viêm da cho chó (100ml)','/images/prod-antifungal-spray.jpg',195000,1,N'Chai 100ml'),
  ('PH261110','prod-dog-shampoo',N'Sữa tắm yến mạch & lô hội dịu nhẹ cho chó (500ml)','/images/prod-dog-shampoo.jpg',245000,1,N'Chai 500ml'),
  ('PH261105','prod-travel-bag',N'Balo phi hành gia vận chuyển mèo chống sốc',NULL,520000,1,N'Cam đất');
END
GO