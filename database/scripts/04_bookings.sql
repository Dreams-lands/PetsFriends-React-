USE QLThuCung;
GO
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
IF NOT EXISTS (SELECT 1 FROM Services)
INSERT INTO Services (Id, Name, Description, Price, Duration, IsPopular) VALUES
('pkg-1', N'Tắm thảo mộc & Thư giãn', N'Tắm sạch sâu 2 lần, sấy ấm ion âm, vệ sinh tuyến hôi, xịt dưỡng mượt lông.', 180000, N'45 phút', 0),
('pkg-2', N'Cắt tỉa & Tạo phom lông thẩm mỹ', N'Tỉa gọn khuôn mặt, tạo phom lông bồng bềnh, vệ sinh bàn chân và bụng.', 280000, N'60 phút', 0),
('pkg-3', N'Chăm sóc Toàn diện 7 Bước', N'Tắm thảo mộc, massage, sấy tạo phom, cắt tỉa, dũa móng, vệ sinh tai.', 390000, N'90 phút', 1),
('pkg-4', N'Khách sạn thú cưng 5 sao', N'Phòng riêng điều hòa, camera 24/7, 3 bữa dinh dưỡng, dạo chơi hằng ngày.', 150000, N'24 giờ', 0);
GO
IF NOT EXISTS (SELECT 1 FROM Bookings)
INSERT INTO Bookings (Id, ServiceId, ServiceName, PetName, BookingDate, TimeSlot, Price, Status, Note, CustomerName, CustomerPhone, StaffName) VALUES
('BK261115','pkg-3',N'Chăm sóc Toàn diện 7 Bước',N'Milo (Corgi 2 tuổi)','2026-11-18',N'10:30 Sáng',390000,'upcoming',N'Tỉa gọn lông bàn chân và bụng, bé hiền.',N'Trịnh Anh Khoa','0909 123 456',NULL),
('BK261116','pkg-1',N'Tắm thảo mộc & Thư giãn',N'Coco (Pomeranian)','2026-11-16',N'09:00 Sáng',180000,'upcoming',N'Bé hơi nhát máy sấy, sấy nhẹ gió ấm.',N'Lê Thảo Vy','0935 678 920',N'Linh Phạm'),
('BK261117','pkg-2',N'Cắt tỉa & Tạo phom lông thẩm mỹ',N'Teddy (Poodle nâu)','2026-11-17',N'14:00 Chiều',280000,'upcoming',N'Tỉa kiểu gấu bông tròn mặt.',N'Võ Ngọc Linh','0908 765 421',N'Mai Nguyễn'),
('BK261119','pkg-2',N'Cắt tỉa & Tạo phom lông thẩm mỹ',N'Choco (Poodle đen)','2026-11-19',N'16:00 Chiều',280000,'upcoming',NULL,N'Ngô Bảo Ngọc','0987 555 013',N'Mai Nguyễn'),
('BK261114','pkg-4',N'Khách sạn thú cưng 5 sao',N'Mochi (Samoyed)','2026-11-14',N'10:30 Sáng',150000,'completed',N'Lưu trú 2 ngày kèm khẩu phần hạt riêng.',N'Đặng Gia Bảo','0973 345 890',N'An Trần'),
('BK261113','pkg-3',N'Chăm sóc Toàn diện 7 Bước',N'Bông (Mèo Anh lông ngắn)','2026-11-13',N'16:00 Chiều',390000,'completed',N'Vệ sinh tai & cắt móng định kỳ.',N'Trịnh Anh Khoa','0909 123 456',N'Linh Phạm');
GO