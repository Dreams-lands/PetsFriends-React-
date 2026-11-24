USE QLThuCung;
GO
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
IF NOT EXISTS (SELECT 1 FROM StoreSettings)
INSERT INTO StoreSettings VALUES (1, N'PetsFriend Flagship — Chi nhánh Quận 1', N'128 Nguyễn Trãi, P. Bến Thành', N'Quận 1', N'TP. Hồ Chí Minh',
  N'1900 6868', N'0909 686 868', N'chamsoc@pethub.vn', N'https://zalo.me/0909686868', N'https://www.facebook.com/pethub.vn',
  N'08:00 – 21:00 mỗi ngày', N'Asia/Ho_Chi_Minh (UTC+07:00)', N'VND (₫)');
GO