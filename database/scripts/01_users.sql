IF DB_ID('QLThuCung') IS NULL CREATE DATABASE QLThuCung;
GO
USE QLThuCung;
GO
IF OBJECT_ID('dbo.Users', 'U') IS NULL
CREATE TABLE dbo.Users (
  Id           INT IDENTITY(1,1) PRIMARY KEY,
  Name         NVARCHAR(100) NOT NULL,
  Email        NVARCHAR(150) NOT NULL UNIQUE,
  PasswordHash NVARCHAR(255) NOT NULL,
  Role         NVARCHAR(20)  NOT NULL DEFAULT 'user',
  CreatedAt    DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
  CONSTRAINT CK_Users_Role CHECK (Role IN ('admin', 'staff', 'user'))
);
GO