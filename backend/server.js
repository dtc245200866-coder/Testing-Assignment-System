// Backend — vừa phục vụ tĩnh frontend/, vừa cung cấp API xác thực + lưu dữ liệu.
// Chạy:  node backend/server.js   (cần DATABASE_URL — Neon Postgres)
//
// API:
//   POST /api/signup  {email, password}            -> {token, userId, email}
//   POST /api/login   {email, password}            -> {token, userId, email}
//   POST /api/logout  (Bearer token)
//   GET  /api/me      (Bearer token)               -> {userId, email}
//   GET  /api/data    (Bearer token)               -> {data: array|null}
//   PUT  /api/data    (Bearer token) {data: array} -> {ok:true}
//   GET  /api/health                              -> {ok, db}
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { Pool } = require("pg");

const ROOT = path.join(__dirname, "..", "frontend");
const PORT = parseInt(process.env.PORT || "8080", 10);
const DATABASE_URL = process.env.DATABASE_URL || "";
const TOKEN_TTL_DAYS = 30;
const MAX_BODY = 5 * 1024 * 1024; // 5 MB

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

const isLocalDb = /localhost|127\.0\.0\.1|::1/i.test(DATABASE_URL);
const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: isLocalDb ? false : { rejectUnauthorized: false } })
  : null;
if (pool) {
  pool.on("error", function (err) { console.error("Lỗi kết nối database:", err.message); });
}

/* ---------------- Mật khẩu & phiên ---------------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}
function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split(":");
    if (parts.length !== 2) return false;
    const target = Buffer.from(parts[1], "hex");
    const check = crypto.scryptSync(password, parts[0], 64);
    return check.length === target.length && crypto.timingSafeEqual(check, target);
  } catch (e) { return false; }
}
function newToken() { return crypto.randomBytes(32).toString("hex"); }
function hashToken(token) { return crypto.createHash("sha256").update(token).digest("hex"); }

/* ---------------- Migrate (tạo bảng nếu chưa có) ---------------- */
async function migrate() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY,
      email text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_data (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

/* ---------------- Tiện ích HTTP ---------------- */
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
}
function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
function readJson(req) {
  return new Promise(function (resolve, reject) {
    let raw = "";
    let size = 0;
    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error("Payload quá lớn")); req.destroy(); return; }
      raw += chunk;
    });
    req.on("end", function () {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(new Error("JSON không hợp lệ")); }
    });
    req.on("error", reject);
  });
}
function bearerToken(req) {
  const h = req.headers["authorization"] || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}
async function userFromRequest(req) {
  const token = bearerToken(req);
  if (!token || !pool) return null;
  const { rows } = await pool.query(
    "SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()",
    [hashToken(token)]
  );
  return rows[0] || null;
}
async function issueSession(res, userId, email) {
  const token = newToken();
  const expires = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 3600 * 1000);
  await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [hashToken(token), userId, expires.toISOString()]);
  return sendJson(res, 200, { token: token, userId: userId, email: email });
}

/* ---------------- Xử lý API ---------------- */
async function handleApi(req, res, urlPath) {
  const method = req.method;

  if (urlPath === "/api/health") {
    let dbOk = false;
    if (pool) { try { await pool.query("SELECT 1"); dbOk = true; } catch (e) { /* DB chưa sẵn sàng */ } }
    return sendJson(res, 200, { ok: true, db: dbOk });
  }

  // Đăng ký / đăng nhập (không cần token)
  if (method === "POST" && (urlPath === "/api/signup" || urlPath === "/api/login")) {
    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) return sendJson(res, 400, { error: "Vui lòng nhập email và mật khẩu." });
    if (password.length < 6) return sendJson(res, 400, { error: "Mật khẩu tối thiểu 6 ký tự." });
    if (!pool) return sendJson(res, 503, { error: "Chưa cấu hình DATABASE_URL trên máy chủ." });
    try {
      if (urlPath === "/api/signup") {
        const id = crypto.randomUUID();
        await pool.query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)",
          [id, email, hashPassword(password)]);
        return await issueSession(res, id, email);
      } else {
        const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        const user = rows[0];
        if (!user || !verifyPassword(password, user.password_hash))
          return sendJson(res, 401, { error: "Email hoặc mật khẩu không đúng." });
        return await issueSession(res, user.id, user.email);
      }
    } catch (e) {
      if (e.code === "23505") return sendJson(res, 409, { error: "Email này đã được đăng ký." });
      console.error("Lỗi auth:", e.message);
      return sendJson(res, 500, { error: "Lỗi máy chủ." });
    }
  }

  // Các route còn lại cần đăng nhập
  const user = await userFromRequest(req);
  if (!user) return sendJson(res, 401, { error: "Chưa đăng nhập hoặc phiên đã hết hạn." });

  if (method === "POST" && urlPath === "/api/logout") {
    const token = bearerToken(req);
    if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && urlPath === "/api/me") {
    return sendJson(res, 200, { userId: user.id, email: user.email });
  }

  if (method === "GET" && urlPath === "/api/data") {
    const { rows } = await pool.query("SELECT data FROM app_data WHERE user_id = $1", [user.id]);
    return sendJson(res, 200, { data: rows[0] ? rows[0].data : null });
  }

  if (method === "PUT" && urlPath === "/api/data") {
    const body = await readJson(req);
    if (!Array.isArray(body.data)) return sendJson(res, 400, { error: "Dữ liệu không hợp lệ." });
    await pool.query(
      "INSERT INTO app_data (user_id, data, updated_at) VALUES ($1, $2, now()) " +
      "ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()",
      [user.id, JSON.stringify(body.data)]
    );
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: "Không tìm thấy." });
}

/* ---------------- Phục vụ tĩnh ---------------- */
function serveStatic(req, res, urlPath) {
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.normalize(path.join(ROOT, urlPath));
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
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(function (req, res) {
  setCors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  try {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (urlPath === "/api" || urlPath.startsWith("/api/")) {
      handleApi(req, res, urlPath).catch(function (e) {
        console.error("Lỗi API:", e.message);
        if (!res.headersSent) sendJson(res, 500, { error: "Lỗi máy chủ." });
      });
      return;
    }
    serveStatic(req, res, urlPath);
  } catch (e) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
  }
});

function lanIPs() {
  const ips = [];
  const ifs = os.networkInterfaces();
  Object.keys(ifs).forEach(function (name) {
    ifs[name].forEach(function (it) { if (it.family === "IPv4" && !it.internal) ips.push(it.address); });
  });
  return ips;
}

migrate().then(function () {
  console.log(pool
    ? "Database sẵn sàng (Neon/Postgres)."
    : "Chưa đặt DATABASE_URL — API sẽ báo lỗi, chỉ phục vụ tĩnh.");
}).catch(function (e) {
  console.error("Không kết nối được database:", e.message);
});

server.listen(PORT, "0.0.0.0", function () {
  console.log("=== Máy chủ Tạo Câu Hỏi Và Ôn tập đang chạy ===");
  console.log("Máy này  : http://localhost:" + PORT);
  const ips = lanIPs();
  if (ips.length) {
    ips.forEach(function (ip) { console.log("Điện thoại (cùng WiFi): http://" + ip + ":" + PORT); });
  } else {
    console.log("(Không tìm thấy địa chỉ mạng LAN — kiểm tra kết nối WiFi)");
  }
});
