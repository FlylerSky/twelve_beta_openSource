const { auth, db } = require("../config/firebase");
const { COLLECTIONS, ACCOUNT_STATUS } = require("../utils/constants");

/**
 * LƯU Ý KIẾN TRÚC:
 * Việc đăng nhập (kiểm tra email/password) được thực hiện ở FRONTEND bằng
 * Firebase Client SDK (signInWithEmailAndPassword), vì Admin SDK ở backend
 * không có khả năng kiểm tra mật khẩu. Sau khi đăng nhập thành công, frontend
 * lấy ID Token (JWT) từ Firebase và đính kèm vào header:
 *    Authorization: Bearer <idToken>
 * cho mọi request cần xác thực. Middleware dưới đây xác minh token đó.
 *
 * v0.5.2 — SIẾT CHẶT: sở hữu một ID token hợp lệ (tức "đã đăng nhập Firebase")
 * KHÔNG còn đồng nghĩa với việc được backend coi là "đã đăng nhập vào Twelve".
 * Mặc định (`requireAuth`) giờ đòi hỏi tài khoản ở Firestore phải
 * `status === "active"` — tài khoản `pending` (chưa xác minh email) hay
 * `suspended` đều bị chặn ngay tại cổng vào, cho MỌI endpoint, bất kể client
 * nào gọi (web, mobile, Postman...). Điều này không phụ thuộc UI/UX của bất kỳ
 * client nào — kể cả khi client có bug cho phép điều hướng vào app trước khi
 * xác minh, backend vẫn từ chối phục vụ.
 *
 * Chỉ có ĐÚNG 2 endpoint bắt buộc phải cho tài khoản `pending` đi qua, vì bản
 * thân chúng chính là một phần của quy trình kích hoạt / kiểm tra trạng thái:
 *   - POST /api/auth/activation/sync  (đồng bộ pending -> active)
 *   - GET  /api/users/me              (để client tự biết mình đang pending)
 * Hai endpoint này dùng `requireAuthAllowPending` — không làm gì khác ngoài
 * đọc/đồng bộ trạng thái của chính chủ tài khoản, không tạo/sửa/xoá nội dung,
 * nên an toàn khi cho phép tài khoản chưa kích hoạt gọi tới.
 *
 * v0.8.6 — GHI NHẬN: vì `GET /users/me` phải cho `pending` đi qua (điều kiện
 * cần để tự kích hoạt), frontend trước đây từng coi "có session Firebase" là
 * "đã đăng nhập vào Twelve" và hiển thị UI đầy đủ (Navbar, menu tạo bài...)
 * cho cả tài khoản `pending` — dù mọi request GHI vẫn bị chặn ở đây như thiết
 * kế, nên chưa có dữ liệu nào bị ảnh hưởng. Đã siết lại ở frontend
 * (AuthContext.isLoggedIn giờ đòi hỏi status === active, cộng thêm
 * PendingSessionGate chặn session pending ở MỌI route) để khớp đúng với ranh
 * giới mà middleware này đã enforce từ v0.5.2. Không có thay đổi nào ở lớp
 * backend vì phần này vốn đã đúng.
 */

async function verifyRequestToken(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    const err = new Error("Thiếu token xác thực.");
    err.status = 401;
    throw err;
  }

  const decoded = await auth.verifyIdToken(token);
  const userSnap = await db.collection(COLLECTIONS.USERS).doc(decoded.uid).get();

  if (!userSnap.exists) {
    const err = new Error("Tài khoản không tồn tại.");
    err.status = 401;
    throw err;
  }

  const userData = userSnap.data();
  if (userData.status === ACCOUNT_STATUS.SUSPENDED) {
    const err = new Error("Tài khoản đã bị tước quyền truy cập.");
    err.status = 403;
    throw err;
  }

  return {
    authUid: decoded.uid,
    authUser: { uid: userSnap.id, ...userData },
    emailVerified: !!decoded.email_verified,
  };
}

// Bắt buộc phải đăng nhập VÀ tài khoản đã kích hoạt (status === active).
// Đây là middleware mặc định cho mọi route cần xác thực trong toàn bộ API.
async function requireAuth(req, res, next) {
  try {
    const { authUid, authUser, emailVerified } = await verifyRequestToken(req);

    if (authUser.status !== ACCOUNT_STATUS.ACTIVE) {
      return res.status(403).json({
        error: "Tài khoản chưa được kích hoạt. Vui lòng xác minh email trước khi đăng nhập.",
        code: "ACCOUNT_NOT_ACTIVE",
        status: authUser.status,
      });
    }

    req.authUid = authUid;
    req.authUser = authUser;
    req.emailVerified = emailVerified;
    next();
  } catch (err) {
    if (err.status === 403) {
      return res.status(403).json({ error: err.message });
    }
    if (err.status !== 401) console.error("requireAuth error:", err.message);
    return res.status(401).json({ error: err.status === 401 ? err.message : "Token không hợp lệ hoặc đã hết hạn." });
  }
}

// Biến thể DUY NHẤT cho phép tài khoản `pending` đi qua (vẫn chặn `suspended`).
// CHỈ dùng cho 2 endpoint thuộc chính quy trình kích hoạt (xem ghi chú trên
// đầu file). Không gắn middleware này vào bất kỳ route ghi/tạo nội dung nào.
async function requireAuthAllowPending(req, res, next) {
  try {
    const { authUid, authUser, emailVerified } = await verifyRequestToken(req);
    req.authUid = authUid;
    req.authUser = authUser;
    req.emailVerified = emailVerified;
    next();
  } catch (err) {
    if (err.status === 403) {
      return res.status(403).json({ error: err.message });
    }
    console.error("requireAuthAllowPending error:", err.message);
    return res.status(401).json({ error: err.status === 401 ? err.message : "Token không hợp lệ hoặc đã hết hạn." });
  }
}

// Giữ lại để tương thích ngược / phòng thủ theo lớp (defense in depth): nếu
// route nào lỡ dùng requireAuthAllowPending mà quên siết trạng thái, middleware
// này vẫn chặn được ở lớp thứ hai. Với requireAuth (mặc định) thì đây là kiểm
// tra dư thừa vô hại vì req.authUser.status đã chắc chắn là ACTIVE.
function requireActive(req, res, next) {
  if (!req.authUser) {
    return res.status(401).json({ error: "Bạn cần đăng nhập." });
  }
  if (req.authUser.status !== ACCOUNT_STATUS.ACTIVE) {
    return res.status(403).json({
      error: "Tài khoản chưa được kích hoạt. Vui lòng xác minh email trước khi thực hiện thao tác này.",
      code: "ACCOUNT_NOT_ACTIVE",
      status: req.authUser.status,
    });
  }
  next();
}

// Không bắt buộc đăng nhập, nhưng nếu có token hợp lệ thì vẫn gắn user vào req
async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return next();

    const decoded = await auth.verifyIdToken(token);
    const userSnap = await db.collection(COLLECTIONS.USERS).doc(decoded.uid).get();
    if (userSnap.exists) {
      req.authUid = decoded.uid;
      req.authUser = { uid: userSnap.id, ...userSnap.data() };
      req.emailVerified = !!decoded.email_verified;
    }
  } catch (err) {
    // Token lỗi -> coi như khách vãng lai, không chặn request
  }
  next();
}

module.exports = { requireAuth, requireAuthAllowPending, requireActive, optionalAuth };
