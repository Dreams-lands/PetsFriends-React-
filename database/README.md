# Cơ sở dữ liệu SQL Server — PetsFriend (QLThuCung)

Phiên bản gọn nhẹ gồm **10 bảng cốt lõi**, hỗ trợ đầy đủ luồng **Khách vãng lai mua hàng / đặt lịch / liên hệ không cần đăng nhập**, đồng thời có tài khoản **Admin / Staff / Customer**.

## 1. Danh sách bảng

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

## 2. Thứ tự chạy trong SSMS

Nếu đã chạy bản cũ trước đó, xóa DB cũ trước:
```sql
USE master;
GO
ALTER DATABASE QLThuCung SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
DROP DATABASE QLThuCung;
GO
```

Sau đó copy hết (`Ctrl+A` -> `Ctrl+C`) và nhấn `F5` lần lượt **2 file**:
1. [01_create_database_and_schema.sql](file:///d:/Project/QLThuCung/database/scripts/01_create_database_and_schema.sql) — Tạo DB & 10 bảng.
2. [01_seed_initial_data.sql](file:///d:/Project/QLThuCung/database/seeds/01_seed_initial_data.sql) — Nạp dữ liệu mẫu để test (gồm tài khoản `admin`, `staff`, `customer`, sản phẩm, gói Spa, đơn hàng & lịch hẹn khách vãng lai).
