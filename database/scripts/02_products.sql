USE QLThuCung;
GO
IF OBJECT_ID('dbo.Products', 'U') IS NULL
CREATE TABLE dbo.Products (
  Id                NVARCHAR(60)  NOT NULL PRIMARY KEY,
  Brand             NVARCHAR(100) NOT NULL DEFAULT N'',
  Name              NVARCHAR(200) NOT NULL,
  ShortDesc         NVARCHAR(500) NULL,
  Description       NVARCHAR(MAX) NULL,
  PackSize          NVARCHAR(100) NULL,
  Sizes             NVARCHAR(MAX) NULL,
  Gallery           NVARCHAR(MAX) NULL,
  Highlights        NVARCHAR(MAX) NULL,
  PriceNum          INT NOT NULL CHECK (PriceNum >= 0),
  OriginalPrice     INT NULL,
  Badge             NVARCHAR(100) NULL,
  Category          NVARCHAR(20)  NOT NULL CHECK (Category IN ('food','hygiene','bed','backpack')),
  SubType           NVARCHAR(100) NULL,
  PetType           NVARCHAR(10)  NULL CHECK (PetType IN ('dog','cat','both')),
  Image             NVARCHAR(500) NULL,
  StockCount        INT NOT NULL DEFAULT 0 CHECK (StockCount >= 0),
  LowStockThreshold INT NOT NULL DEFAULT 15,
  IsFeatured        BIT NOT NULL DEFAULT 0,
  IsFlashSale       BIT NOT NULL DEFAULT 0,
  CreatedAt         DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
GO
INSERT INTO Products (Id, Brand, Name, PriceNum, OriginalPrice, Category, SubType, PetType, Image, StockCount, IsFlashSale)
SELECT * FROM (VALUES
 (N'prod-rc-mini', N'ROYAL CANIN', N'Hạt dinh dưỡng cho chó giống nhỏ Mini Adult', 389000, 489000, 'food', N'Dinh dưỡng & Hạt khô', 'dog', N'/images/prod-rc-mini.jpg', 22, 1),
 (N'prod-dentastix', N'DENTASTIX', N'Thanh gặm sạch răng cho chó giống nhỏ', 85000, 115000, 'food', N'Pate & Bánh thưởng', 'dog', N'/images/prod-dentastix.jpg', 8, 1),
 (N'prod-travel-bag', N'PET TRAVEL', N'Balo phi hành gia vận chuyển mèo chống sốc', 520000, 580000, 'backpack', N'Địu - Balo - Túi xách', 'cat', N'/images/prod-travel-bag.jpg', 12, 1),
 (N'prod-cat-cage', N'PETSFRIEND HOME', N'Chuồng mèo biệt thự nhiều tầng sơn tĩnh điện kèm võng', 1250000, 1490000, 'bed', N'Lồng - Chuồng', 'cat', N'/images/prod-cat-cage.jpg', 11, 1),
 (N'prod-dog-shampoo', N'BOTANICAL PAW', N'Sữa tắm yến mạch & lô hội dịu nhẹ cho chó (500ml)', 245000, NULL, 'hygiene', N'Sữa tắm & Dưỡng lông', 'dog', N'/images/prod-dog-shampoo.jpg', 38, 0),
 (N'prod-cat-litter-box', N'PETSFRIEND HOME', N'Hộp cát vệ sinh khử mùi có nắp & xẻng xúc cho mèo', 440000, NULL, 'backpack', N'Hộp cát & Vệ sinh', 'cat', N'/images/prod-cat-litter-box.jpg', 24, 0)
) AS v(Id, Brand, Name, PriceNum, OriginalPrice, Category, SubType, PetType, Image, StockCount, IsFlashSale)
WHERE NOT EXISTS (SELECT 1 FROM Products p WHERE p.Id = v.Id);
GO