// Gộp toàn bộ frontend/ thành một file HTML tự chứa (dùng cho APK / offline).
// Chạy:  node tools/build-single.js   ->  xuất ra dist/app-single.html
const fs = require("fs");
const path = require("path");

const FRONTEND = path.join(__dirname, "..", "frontend");
const DIST = path.join(__dirname, "..", "dist");

const read = (p) => fs.readFileSync(path.join(FRONTEND, p), "utf8");

let html = read("index.html");

// 1) Nhúng CSS (thay từng <link rel="stylesheet"> bằng <style>)
["variables.css", "base.css", "layout.css", "components.css", "quiz.css", "manage.css"].forEach((name) => {
  const css = fs.readFileSync(path.join(FRONTEND, "css", name), "utf8");
  const tag = '<link rel="stylesheet" href="css/' + name + '">';
  html = html.split(tag).join("<style>\n" + css + "\n</style>");
});

// 2) Bỏ manifest + apple-touch-icon (không cần trong file đơn lẻ)
html = html.split('<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">').join("");
html = html.split('<link rel="manifest" href="assets/manifest.json">').join("");

// 3) Nhúng JS (thay <script src> bằng <script> nội tuyến)
html = html.split('<script src="js/config.js"></script>').join("<script>\n" + read("js/config.js") + "\n</script>");
html = html.split('<script src="js/questions.js"></script>').join("<script>\n" + read("js/questions.js") + "\n</script>");
html = html.split('<script src="js/app.js"></script>').join("<script>\n" + read("js/app.js") + "\n</script>");
html = html.split('<script src="js/import.js"></script>').join("<script>\n" + read("js/import.js") + "\n</script>");

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, "app-single.html"), html, "utf8");
console.log("Đã tạo dist/app-single.html (" + html.length + " bytes)");
