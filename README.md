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
- Live → Live Inspector: nhập https://www.tiktok.com/@username/live để nhận sự kiện thời gian thực qua SSE; mở/đóng từng action và JSON. Giữ 500 sự kiện mới nhất; xóa log không ngắt kết nối. Live / English Quiz (`?tool=live-2`): nghĩa Việt → comment tiếng Anh, countdown, fullscreen, bảng điểm theo band và diamond. Test 3 vẫn là placeholder.
- LIVE dùng tiktok-live-connector (không chính thức), bao gồm dịch vụ ký kết nối bên thứ ba; không cần nhập cookie. Không đảm bảo mọi phòng công khai đều kết nối được; không lấy lịch sử trước lúc kết nối. Payload là toàn bộ dữ liệu sự kiện thư viện giải mã, không phải dữ liệu bị TikTok ẩn.
- Reverse proxy phải tắt buffering cho /api/live và cho phép kết nối SSE dài (ví dụ Nginx: proxy_buffering off; proxy_read_timeout 1h;). Đóng trang/ngắt kết nối sẽ dọn kết nối upstream.

Dữ liệu qua TikWM (https://www.tikwm.com), dịch vụ bên thứ ba không chính thức; URL video được gửi tới TikWM. Không cần API key cho cấu hình này. Khả dụng, quota, nội dung và quyền tải phụ thuộc provider; lỗi upstream trả HTTP 502, không tạo dữ liệu giả. Chỉ tải nội dung bạn có quyền sử dụng. Provider có thể thay đổi endpoint hoặc chặn yêu cầu. Test tự động kiểm tra input/CSV; cần video công khai còn hoạt động để kiểm tra dữ liệu thật. Nếu public cho nhiều người dùng, bổ sung rate limit ở reverse proxy.

### English Quiz

- Kết nối LIVE, chọn band/thời gian rồi bấm Bắt đầu Quiz. Mỗi người được điểm một lần mỗi câu; hết giờ hiện đáp án 5 giây trước câu tiếp.
- A1/A2/B1/B2/C1/C2: 10/20/30/40/50/70 điểm. Random ưu tiên A2–C1 khi các band này còn từ.
- Nguồn: PDF song ngữ người dùng cung cấp (`public/quiz-vocabulary.pdf`), 107 trang; trích 1.760 mục trong bảng, gộp trùng còn 1.613 từ/cụm từ. Nghĩa Việt giữ từ nguồn, chuẩn hóa lỗi font và sửa một số lỗi rõ ràng; các bản sửa giữ `sourceAnswer`/`sourceVi`/`sourcePos`. Mỗi mục có trang và chủ đề để đối chiếu. Level A1–C2 là ước lượng biên tập cho Quiz, không phải chứng nhận CEFR của Oxford.
- Quà: diamond × repeatCount × hệ số (1/5/10); cộng phần tăng thêm theo user/gift/groupId, hoặc chống lặp bằng msgId. Thiếu diamond/mã sự kiện sẽ không cộng. Hệ số khóa khi đang kết nối.
- Điểm nằm trong bộ nhớ tab, mất khi reload/rời trang. Kết nối lại giữ điểm; đổi phòng dùng Phiên mới. Chỉ dùng một tab làm bảng điểm cho mỗi phiên.
- Kiểm tra thủ công với LIVE đang phát: hai tài khoản comment đúng/sai/lặp, hết giờ, chuỗi quà nhiều lần, ngắt/kết nối lại và fullscreen/Escape. Test tự động dùng payload mô phỏng; không cần LIVE thật.

- Rút không hoàn lại trên toàn bộ bộ từ; chuyển band/kết nối lại vẫn giữ danh sách đã rút. Hết riêng một band thì chọn band khác/Ngẫu nhiên; chỉ sau khi hết tất cả từ mới tự nạp lại, tăng số lượt và tránh lặp ngay từ cuối lượt trước khi có lựa chọn khác. Phiên mới xóa điểm và lịch sử rút.
- UI hiện lượt và số từ còn lại. Với 1.613 từ, 30 giây trả lời + 5 giây đáp án/câu: khoảng 15 giờ 41 phút cho một lượt đầy đủ.
