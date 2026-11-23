USE QLThuCung;
GO
IF OBJECT_ID('dbo.PaymentSettings', 'U') IS NULL
CREATE TABLE dbo.PaymentSettings (
  Id                INT NOT NULL PRIMARY KEY CHECK (Id = 1),
  CodEnabled        BIT NOT NULL DEFAULT 1,
  CodNote           NVARCHAR(500) NULL,
  VnpayEnabled      BIT NOT NULL DEFAULT 0,
  VnpayTmnCode      NVARCHAR(100) NULL,
  VnpayEnvironment  NVARCHAR(12) NOT NULL DEFAULT 'sandbox' CHECK (VnpayEnvironment IN ('sandbox','production')),
  VnpayHashSecret   NVARCHAR(200) NULL,
  MomoEnabled       BIT NOT NULL DEFAULT 0,
  MomoPartnerCode   NVARCHAR(100) NULL,
  MomoEnvironment   NVARCHAR(12) NOT NULL DEFAULT 'sandbox' CHECK (MomoEnvironment IN ('sandbox','production')),
  MomoAccessKey     NVARCHAR(200) NULL,
  MomoSecretKey     NVARCHAR(200) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM PaymentSettings)
INSERT INTO PaymentSettings (Id, CodEnabled, CodNote, VnpayEnabled, MomoEnabled)
VALUES (1, 1, N'Khách kiểm tra hàng trước khi thanh toán trực tiếp cho shipper hoặc tại quầy PetsFriend.', 1, 1);
GO
IF COL_LENGTH('dbo.Orders', 'PaymentStatus') IS NULL
ALTER TABLE dbo.Orders ADD PaymentStatus NVARCHAR(10) NOT NULL
  CONSTRAINT DF_Orders_PayStatus DEFAULT 'unpaid';
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Orders_PayStatus')
ALTER TABLE dbo.Orders ADD CONSTRAINT CK_Orders_PayStatus CHECK (PaymentStatus IN ('unpaid','paid','refunded'));
GO
-- Đơn đã hoàn thành coi như đã thu tiền
UPDATE Orders SET PaymentStatus = 'paid' WHERE Status = 'completed' AND PaymentStatus = 'unpaid';
GO