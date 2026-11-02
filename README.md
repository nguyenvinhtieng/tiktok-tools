# TikKit

Nuxt 3 + Nitro: frontend và API chạy chung một Node process. Node 22+.

```sh
npm install
npm run dev
```

Mở http://localhost:3000. Production:

```sh
npm ci
npm test
npm run build
HOST=0.0.0.0 PORT=3000 npm start
```

Docker:

```sh
docker build -t tikkit .
docker run -d --restart unless-stopped -p 3000:3000 --name tikkit tikkit
```

Không cần database hoặc backend riêng. Đặt reverse proxy HTTPS trước cổng 3000 khi public.

## Tools

- Fetch comments: URL video/short link → phân trang 30 comment, tìm trong dữ liệu đã tải, xuất CSV.
- Download video: xem metadata/preview rồi tải MP4 qua backend.
- Live → Live Inspector: nhập https://www.tiktok.com/@username/live để nhận sự kiện thời gian thực qua SSE; mở/đóng từng action và JSON. Giữ 500 sự kiện mới nhất; xóa log không ngắt kết nối. Test 2/3 vẫn là placeholder.
- LIVE dùng tiktok-live-connector (không chính thức), bao gồm dịch vụ ký kết nối bên thứ ba; không cần nhập cookie. Không đảm bảo mọi phòng công khai đều kết nối được; không lấy lịch sử trước lúc kết nối. Payload là toàn bộ dữ liệu sự kiện thư viện giải mã, không phải dữ liệu bị TikTok ẩn.
- Reverse proxy phải tắt buffering cho /api/live và cho phép kết nối SSE dài (ví dụ Nginx: proxy_buffering off; proxy_read_timeout 1h;). Đóng trang/ngắt kết nối sẽ dọn kết nối upstream.

Dữ liệu qua TikWM (https://www.tikwm.com), dịch vụ bên thứ ba không chính thức; URL video được gửi tới TikWM. Không cần API key cho cấu hình này. Khả dụng, quota, nội dung và quyền tải phụ thuộc provider; lỗi upstream trả HTTP 502, không tạo dữ liệu giả. Chỉ tải nội dung bạn có quyền sử dụng. Provider có thể thay đổi endpoint hoặc chặn yêu cầu. Test tự động kiểm tra input/CSV; cần video công khai còn hoạt động để kiểm tra dữ liệu thật. Nếu public cho nhiều người dùng, bổ sung rate limit ở reverse proxy.
