# Cơ sở dữ liệu SQL Server — PetsFriend (`QLThuCung`)

Toàn bộ script tạo database (`QLThuCung`), **15 bảng** và dữ liệu mẫu đã được gộp vào **1 file duy nhất** ở thư mục gốc của repo:

- [PetsFriend.sql](../PetsFriend.sql)

## 1. Danh sách 15 bảng

| Bảng | Mục đích |
| :--- | :--- |
| `Users` | Tài khoản `customer`, `staff`, `admin` |
| `UserAddresses` | Sổ địa chỉ nhận hàng cho thành viên đã đăng nhập |
| `Categories` | Danh mục sản phẩm (`food`, `hygiene`, `bed`, `backpack`, `spa`) |
| `Products` | Thông tin sản phẩm, giá, tồn kho, ảnh chính |
| `ProductReviews` | Đánh giá sản phẩm |
| `Orders` | Đơn hàng online & POS (`UserId = NULL`, `IsGuest = 1` cho khách vãng lai) |
| `OrderItems` | Chi tiết sản phẩm đã mua trong đơn (lưu snapshot tên, ảnh, giá) |
| `SpaPackages` | Các gói dịch vụ Spa |
| `ServiceBookings` | Lịch hẹn Spa (`UserId = NULL` cho khách vãng lai) |
| `ContactMessages` | Tin nhắn liên hệ (không cần đăng nhập) |
| `UserWishlists` | Danh sách sản phẩm yêu thích của hội viên |
| `StaffRoster` | Danh sách nhân viên trực ca dùng chung tài khoản `staff` |
| `StaffPermissions` | Ma trận phân quyền cho tài khoản `staff` |
| `PaymentGatewayConfigs` | Cấu hình cổng thanh toán (`cod`, `vnpay`, `momo`) |
| `PaymentTransactions` | Lịch sử giao dịch thanh toán của đơn hàng |

## 2. Cách chạy

Mở [PetsFriend.sql](../PetsFriend.sql) trong SSMS (hoặc Azure Data Studio) và nhấn `F5` để thực thi toàn bộ file, hoặc chạy bằng dòng lệnh:

```powershell
# Windows Auth
sqlcmd -S localhost -E -C -f 65001 -i PetsFriend.sql

# Hoặc SQL Auth (sa)
sqlcmd -S localhost -U sa -P <mat_khau> -C -f 65001 -i PetsFriend.sql
```

Script đã viết dạng **idempotent** (`IF DB_ID(...) IS NULL`, `IF OBJECT_ID(...) IS NULL`, `MERGE`), có thể chạy lại nhiều lần mà không làm mất dữ liệu hiện có. Nếu muốn reset sạch DB về ban đầu thì drop DB cũ trước rồi chạy lại `PetsFriend.sql`:

```sql
USE master;
GO
ALTER DATABASE QLThuCung SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
DROP DATABASE QLThuCung;
GO
```
