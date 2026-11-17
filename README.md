# QLThuCung

Dự án Quản lý Thú Cưng xây dựng bằng **React** (Frontend), **Node.js** (Backend), **SQL Server** (Database) và **RESTful API**.

## Cấu trúc thư mục

```text
QLThuCung/
├── api/                    # Nơi lưu trữ đặc tả & tài liệu RESTful API làm cầu nối giữa Backend và Frontend
│   ├── collections/        # File collection (Postman / Insomnia) để kiểm thử API
│   ├── docs/               # Tài liệu mô tả chi tiết các endpoint API
│   └── specs/              # File đặc tả API (OpenAPI / Swagger)
│
├── backend/                # Xử lý logic nghiệp vụ (Node.js) và lấy dữ liệu từ SQL Server
│   └── src/
│       ├── config/         # Cấu hình hệ thống, chuỗi kết nối SQL Server, biến môi trường
│       ├── controllers/    # Tiếp nhận request và trả về response
│       ├── middlewares/    # Xử lý trung gian (xác thực, phân quyền, bắt lỗi...)
│       ├── models/         # Định nghĩa cấu trúc dữ liệu / truy vấn database
│       ├── routes/         # Khai báo các tuyến đường (routes) của Backend
│       ├── services/       # Xử lý logic nghiệp vụ chính
│       └── utils/          # Các hàm tiện ích dùng chung
│
├── database/               # Lưu trữ mã nguồn & tài nguyên cơ sở dữ liệu (SQL Server)
│   ├── backups/            # Thư mục chứa file backup (file .bak được ignore trong .gitignore)
│   ├── migrations/         # Các script thay đổi/cập nhật cấu trúc bảng theo từng phiên bản
│   ├── scripts/            # Script SQL tạo database, bảng, view, stored procedure...
│   └── seeds/              # Dữ liệu mẫu khởi tạo cho database
│
├── frontend/               # Hiển thị giao diện người dùng (React)
│   ├── public/             # Tài nguyên tĩnh công khai (favicon, ảnh tĩnh...)
│   └── src/
│       ├── assets/         # Hình ảnh, font chữ, file CSS/SCSS
│       ├── components/     # Các thành phần giao diện (UI components) tái sử dụng
│       ├── context/        # Quản lý trạng thái toàn cục (React Context / Store)
│       ├── hooks/          # Custom React hooks
│       ├── pages/          # Các trang màn hình chính của ứng dụng
│       ├── services/       # Các hàm gọi RESTful API tới Backend
│       └── utils/          # Các hàm tiện ích phía Frontend
│
├── .gitignore              # Danh sách file/thư mục bỏ qua khi đẩy lên GitHub
└── README.md               # Tài liệu tổng quan dự án
```

> **Lưu ý:** Trong mỗi thư mục trống có chứa file `.gitkeep` để Git có thể theo dõi và đẩy cấu trúc thư mục rỗng lên GitHub. Sau này khi bạn thêm file code vào thư mục nào thì có thể xóa file `.gitkeep` trong thư mục đó.

## Đẩy cấu trúc lên GitHub

```bash
git init
git add .
git commit -m "chore: init project directory structure"
git branch -M main
git remote add origin <URL_REPO_GITHUB_CUA_BAN>
git push -u origin main
```
