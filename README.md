# Tạo Câu Hỏi Và Ôn tập

Ứng dụng web **tự tạo câu hỏi và ôn tập nhiều môn học**: mỗi môn học là một option, trong mỗi môn có các chủ đề (chương). Hỗ trợ trắc nghiệm a/b/c/d, đúng/sai, kéo thả, chọn nhiều đáp án — kèm giải thích, chấm điểm, làm lại câu sai, đánh dấu câu khó.

## Cấu trúc thư mục

```
tao-cau-hoi-va-on-tap/
├── frontend/                 # Mã nguồn giao diện (browser chạy)
│   ├── index.html            # Trang chính
│   ├── css/                  # CSS tách theo chức năng
│   │   ├── variables.css     #   biến màu + theme sáng/tối
│   │   ├── base.css          #   reset, nút bấm, toast
│   │   ├── layout.css        #   sidebar, bố cục, thanh mobile
│   │   ├── components.css    #   modal, bảng điều hướng câu hỏi
│   │   ├── quiz.css          #   giao diện làm bài, đáp án, kết quả
│   │   └── manage.css        #   quản lý môn học + câu hỏi
│   ├── js/
│   │   ├── questions.js      #   dữ liệu gốc (SEED_SUBJECTS: theo môn học)
│   │   └── app.js            #   logic ứng dụng
│   └── assets/               # manifest + icon (PWA)
├── backend/
│   └── server.js             # Server tĩnh Node (chạy local/LAN)
├── tools/
│   ├── build-single.js       # Gộp frontend -> dist/app-single.html
│   └── apk-build/            # Bộ công cụ build APK (Android SDK)
├── dist/                     # Kết quả build: app-single.html, .apk
└── source/                   # Nguyên liệu gốc: ảnh đề, OCR, bản cũ
```

## Dữ liệu (cấu trúc môn học)

Dữ liệu tổ chức theo môn học trong `frontend/js/questions.js`:

```js
window.SEED_SUBJECTS = [
  { id: "cnxhkh", name: "Chủ nghĩa xã hội khoa học", icon: "✶", questions: [ ... ] },
  { id: "triet-hoc", name: "Triết học Mác - Lênin", icon: "🧭", questions: [] },
  // ...
];
```

Mỗi câu hỏi có `topic` (chương/bài trong môn). Các dạng: `mcq`, `multi`, `tf`, `drag`.

## Các lệnh thường dùng

| Việc cần làm | Lệnh |
|---|---|
| Chạy đầy đủ (frontend + API đăng nhập/lưu dữ liệu) | `npm run serve` → http://localhost:8080 (cần `DATABASE_URL`) |
| Chỉ sửa giao diện (hot-reload, không có API) | `npm start` (Vite) |
| Gộp thành 1 file HTML | `npm run build` → `dist/app-single.html` |
| Đăng lên Netlify | `npm run deploy` |
| Build APK Android | xem mục bên dưới |

> **Backend** (`backend/server.js`) vừa phục vụ tĩnh `frontend/`, vừa cung cấp API xác thực (email/mật khẩu) và lưu dữ liệu theo từng tài khoản vào Postgres (Neon). Không còn dùng Supabase.
>
> **Biến môi trường:** `DATABASE_URL` = connection string Postgres (Neon), ví dụ `postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require`.
>
> - **Local (Windows):** `set DATABASE_URL=...` rồi `npm run serve`
> - **Render:** đặt `DATABASE_URL` trong dashboard (xem `render.yaml`).

## Build APK Android

Cần **Git Bash** và **JDK 17** (đã cài sẵn trên máy):

```bash
node tools/build-single.js
cp dist/app-single.html tools/apk-build/app/assets/index.html
bash tools/apk-build/build-apk.sh
# -> dist/OnThiCNXHKH.apk
```

## Chỉnh sửa nội dung

- **Thêm / sửa môn học**: dùng tab "Quản lý câu hỏi" (＋ Môn mới, ✎ Đổi tên, 🗑 Xóa môn).
- **Thêm / sửa câu hỏi**: dùng tab "Quản lý câu hỏi" (＋ Thêm câu hỏi) hoặc sửa `frontend/js/questions.js` rồi xuất/nhập JSON.
- **Đổi màu / theme**: sửa `frontend/css/variables.css`.
- **Đổi bố cục / sidebar**: sửa `frontend/css/layout.css`.
- **Đổi giao diện làm bài**: sửa `frontend/css/quiz.css`.

## Link online

https://quiz-on-tap.netlify.app
