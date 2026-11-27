# PetsFriend (`QLThuCung`)

Hệ thống website **Cửa hàng thú cưng, Dịch vụ Spa & Quản lý bán hàng đa kênh (Online + POS)** dành cho thú cưng, xây dựng theo kiến trúc **Frontend React + TypeScript**, **Backend RESTful API Node.js/Express** và **MySQL (MySQL Workbench)**.

---

## Tổng quan dự án

**PetsFriend** giải quyết đồng thời hai luồng nghiệp vụ:
1. **Kênh khách hàng (Storefront):** Cho phép cả **khách vãng lai** (không cần đăng nhập) lẫn **hội viên** tìm kiếm sản phẩm, đặt hàng online, thanh toán qua COD / VNPay / MoMo, đặt lịch Spa và tra cứu trạng thái đơn hàng / lịch hẹn bằng mã đơn + số điện thoại.
2. **Kênh quản trị & tại quầy (Admin / Staff / POS):** Hỗ trợ nhân viên bán hàng trực tiếp tại quầy POS, quản lý đơn hàng, theo dõi lịch sử giao dịch thanh toán, điều phối lịch hẹn Spa theo ca trực, quản lý kho sản phẩm và thống kê doanh thu.

---

## Tính năng chính

### Khách hàng & Khách vãng lai
- **Mua sắm & Đánh giá:** Duyệt sản phẩm theo danh mục (`Dinh dưỡng & Pate`, `Thuốc & Làm đẹp`, `Nệm & Không gian nghỉ`, `Balo & Phụ kiện`), lọc sản phẩm nổi bật/khuyến mãi và gửi đánh giá sản phẩm.
- **Đặt hàng & Tra cứu linh hoạt:** Hỗ trợ đặt hàng không cần tài khoản; tra cứu và tự hủy đơn hàng bằng mã đơn (`OrderCode`) + SĐT; tự động kiểm tra và hoàn trả tồn kho khi hủy đơn.
- **Thanh toán đa cổng:** Hỗ trợ **COD**, **VNPay** (ký `HMAC-SHA512`, Return URL & IPN), **MoMo** (ký `HMAC-SHA256`, Return URL & IPN) và chế độ quét mã **QR Sandbox** phục vụ kiểm thử.
- **Đặt lịch Spa & Liên hệ:** Chọn gói dịch vụ Spa (`SpaPackages`), đặt lịch theo ngày/khung giờ, tra cứu/hủy lịch hẹn và gửi tin nhắn liên hệ.
- **Tài khoản hội viên:** Đăng ký/đăng nhập bảo mật (`JWT` + `Bcrypt`), quản lý hồ sơ cá nhân, sổ địa chỉ giao hàng (`UserAddresses`) và danh sách sản phẩm yêu thích (`UserWishlists`).

### Quản trị viên & Nhân viên (`Admin` / `Staff`)
- **Tổng quan & Thống kê (`Overview` / `Analytics`):** Theo dõi doanh thu theo ngày, theo tháng/năm, top sản phẩm bán chạy và cảnh báo sản phẩm sắp hết hàng.
- **Bán hàng tại quầy (`POS`):** Tạo đơn hàng trực tiếp tại cửa hàng, tra cứu nhanh hội viên qua SĐT, ghi nhận thu tiền mặt ngay.
- **Quản lý đơn hàng & Thanh toán:** Cập nhật trạng thái đơn (`pending` → `shipping` → `completed` / `cancelled`), xác nhận thu tiền thủ công, hoàn tiền và xem lịch sử giao dịch (`PaymentTransactions`).
- **Quản lý lịch hẹn Spa & Liên hệ:** Phân công nhân viên trực (`StaffRoster`), cập nhật trạng thái lịch hẹn và phản hồi tin nhắn liên hệ.
- **Quản lý kho & Sản phẩm:** CRUD danh mục, sản phẩm, điều chỉnh tồn kho, khôi phục sản phẩm đã ẩn và tải ảnh sản phẩm lên máy chủ (`/uploads`).
- **Quản trị hệ thống (`Settings`):** Quản lý tài khoản người dùng (`admin`, `staff`, `customer`), phân quyền tài khoản nhân viên (`StaffPermissions`) và cấu hình cổng thanh toán (`PaymentGatewayConfigs`).

---

## Công nghệ sử dụng

| Thành phần | Công nghệ chính |
| :--- | :--- |
| **Frontend** | React 19, TypeScript, Vite 6, Tailwind CSS v4, React Router v7, Axios, Framer Motion, Recharts, TanStack Table, Lucide React |
| **Backend API** | Node.js, Express 4, JWT (`jsonwebtoken`), `bcryptjs`, `cors`, `dotenv` |
| **API Docs** | OpenAPI 3.0.3 (`api/specs/openapi.yaml`), Swagger UI (`swagger-ui-express`) |
| **Database** | MySQL 8.0 / MySQL Workbench (`QLThuCung`), driver `mysql2/promise` |
| **Testing** | Node.js built-in test runner (`node --test`) với bộ integration test End-to-End |

---

## Cấu trúc thư mục

```text
PetsFriends-React-/
├── PetsFriend.sql          # File SQL chuẩn MySQL 8.0: tạo DB QLThuCung & seed dữ liệu mẫu
├── api/
│   ├── db.js               # Kết nối MySQL Pool (mysql2/promise)
│   ├── server.js           # Express server, Swagger UI (/api-docs), /api/health
│   ├── .env.example        # Mẫu biến môi trường kết nối MySQL
│   └── specs/openapi.yaml  # Tài liệu đặc tả OpenAPI 3.0.3
├── backend/
│   ├── src/
│   │   ├── controllers/    # Xử lý request/response cho từng phân hệ
│   │   ├── middlewares/    # Xác thực JWT, phân quyền RBAC, upload ảnh sản phẩm
│   │   ├── routes/         # Định tuyến RESTful API (/api/*)
│   │   ├── services/       # Nghiệp vụ & truy vấn MySQL
│   │   └── utils/          # Mapper dữ liệu, chuẩn hóa SĐT, Bcrypt & JWT
│   ├── tests/              # Integration tests (user, full backend, payment)
│   └── uploads/products/   # Thư mục lưu ảnh sản phẩm tải lên
└── frontend/               # Ứng dụng React + TypeScript (Vite)
```

---

## Hướng dẫn cài đặt & chạy với MySQL Workbench

### 1. Khởi tạo Database trên MySQL Workbench
- **Cách 1 (MySQL Workbench):** Mở MySQL Workbench, kết nối vào Local instance MySQL → chọn **File → Open SQL Script...** → mở file [PetsFriend.sql](./PetsFriend.sql) → nhấn biểu tượng tia sét ⚡ (**Execute** / `Ctrl + Shift + Enter`).
- **Cách 2 (Dòng lệnh CLI):**
  ```powershell
  & "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p --default-character-set=utf8mb4 -e "source PetsFriend.sql"
  ```

Script viết dạng idempotent (chạy lại không mất dữ liệu), tự động tạo database `QLThuCung` (`utf8mb4_unicode_ci`) và nạp sẵn dữ liệu mẫu.

### 2. Cấu hình biến môi trường Backend (`api/.env`)
Chỉnh thông tin kết nối MySQL trong file `api/.env` (hoặc copy từ [api/.env.example](./api/.env.example)):

```env
PORT=5000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=QLThuCung
DB_USER=root
DB_PASSWORD=mat_khau_mysql_cua_ban
```

### 3. Cài dependencies và chạy Backend + Frontend

```powershell
# Cài dependencies cho backend và api
cd backend && npm install
cd ..\api && npm install

# Chạy Backend API
npm start
```

Mở thêm một terminal khác để chạy Frontend:

```powershell
cd frontend
npm install
npm run dev
```
