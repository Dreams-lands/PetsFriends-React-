# PetsFriend (`QLThuCung`)

Hệ thống cửa hàng & dịch vụ chăm sóc thú cưng sử dụng **React + TypeScript (Vite)**, **Node.js / Express**, và **SQL Server**.

## Hướng dẫn cài đặt & chạy khi mới clone/pull về

### 1. Khởi tạo Database trên SQL Server
Chạy **duy nhất 1 file** [PetsFriend.sql](./PetsFriend.sql) trong SSMS (mở file và nhấn `F5`) hoặc bằng `sqlcmd`:

```powershell
sqlcmd -S localhost -E -C -f 65001 -i PetsFriend.sql
```

Script sẽ tạo database `QLThuCung` (15 bảng) và nạp sẵn dữ liệu mẫu (tài khoản `admin@pethub.vn` / `Admin@123`, `staff@pethub.vn` / `Staff@123`, `khoa.trinh@pethub.vn` / `123456`, sản phẩm, gói Spa, cấu hình VNPay/MoMo sandbox).

### 2. Cấu hình biến môi trường Backend (`api/.env`)
Copy [api/.env.example](./api/.env.example) thành `api/.env` và chỉnh lại thông tin SQL Server của máy bạn:

```powershell
Copy-Item api\.env.example api\.env
```

- Nếu dùng **Windows Auth**: giữ `DB_AUTH=windows` (đổi `DB_SERVER=.\SQLEXPRESS` nếu dùng SQL Express; cần cài Node.js >= 22 và ODBC Driver 17/18 for SQL Server).
- Nếu dùng **SQL Auth (`sa`)**: đặt `DB_AUTH=sql`, điền `DB_USER` và `DB_PASSWORD`.

### 3. Cài dependencies và chạy Backend + Frontend

```powershell
# Cài msnodesqlv8 ở thư mục gốc (cần khi dùng Windows Auth)
npm install

# Cài dependencies cho backend và api
cd backend && npm install
cd ..\api && npm install

# Chạy Backend API (http://localhost:5000, Swagger: http://localhost:5000/api-docs)
npm start
```

Mở thêm 1 terminal khác để chạy Frontend:

```powershell
cd frontend
npm install
npm run dev
```

Frontend chạy tại `http://localhost:5173/`. Kiểm tra nhanh API + SQL tại `http://localhost:5000/api/health`.
