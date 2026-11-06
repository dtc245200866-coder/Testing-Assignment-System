import { defineConfig } from 'vite';

// Dev server có hot-reload: tự cập nhật trình duyệt mỗi khi bạn lưu file trong frontend/.
// Chạy:  npm start  (hoặc npm run dev)  ->  http://localhost:8080
export default defineConfig({
  root: 'frontend',
  server: {
    host: true,  // cho phép truy cập từ điện thoại cùng WiFi
    port: 8080,
  },
});
