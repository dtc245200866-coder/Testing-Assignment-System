// Máy chủ tĩnh (backend) — phục vụ thư mục frontend/ qua mạng nội bộ.
// Chạy:  npm start   hoặc   node backend/server.js     (dừng: Ctrl+C)
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.join(__dirname, "..", "frontend");
const PORT = parseInt(process.env.PORT || "8080", 10);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = http.createServer(function (req, res) {
  try {
    var urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";
    var filePath = path.normalize(path.join(ROOT, urlPath));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }
    fs.readFile(filePath, function (err, data) {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("404 Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream"
      });
      res.end(data);
    });
  } catch (e) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
  }
});

function lanIPs() {
  var ips = [];
  var ifs = os.networkInterfaces();
  Object.keys(ifs).forEach(function (name) {
    ifs[name].forEach(function (it) {
      if (it.family === "IPv4" && !it.internal) ips.push(it.address);
    });
  });
  return ips;
}

server.listen(PORT, "0.0.0.0", function () {
  console.log("=== Máy chủ Tạo Câu Hỏi Và Ôn tập đang chạy ===");
  console.log("Máy này  : http://localhost:" + PORT);
  var ips = lanIPs();
  if (ips.length) {
    ips.forEach(function (ip) {
      console.log("Điện thoại (cùng WiFi): http://" + ip + ":" + PORT);
    });
  } else {
    console.log("(Không tìm thấy địa chỉ mạng LAN — kiểm tra kết nối WiFi)");
  }
});
