const { db, auth } = require("../config/firebase");
const {
  COLLECTIONS,
  ACCOUNT_STATUS,
  ACCOUNT_ROLE,
  ROLE_TO_GROUP,
} = require("../utils/constants");
const {
  normalizeTagName,
  isValidTagName,
  isReservedTagName,
} = require("../utils/helpers");

/**
 * POST /api/auth/register
 * body: { fullName, displayName, tagName, birthday, gender, country, email, password }
 *
 * Tạo user trong Firebase Auth (enabled, emailVerified=false) + doc Firestore (status=PENDING).
 * Email xác minh được gửi từ Frontend bằng Firebase Client SDK (sendEmailVerification)
 * — không còn dùng Resend / mã kích hoạt tùy chỉnh.
 */
async function register(req, res) {
  try {
    const {
      fullName,
      displayName,
      tagName: rawTagName,
      birthday,
      gender,
      country,
      email,
      password,
    } = req.body;

    if (!fullName || !displayName || !rawTagName || !birthday || !gender || !country || !email || !password) {
      return res.status(400).json({ error: "Vui lòng điền đầy đủ thông tin đăng ký." });
    }

    if (!isValidTagName(rawTagName)) {
      return res.status(400).json({
        error: "Tag Name Search không hợp lệ. Chỉ dùng chữ thường, số, gạch dưới, 3-20 ký tự.",
      });
    }

    // v1.1 [A-04 — vá từ 2.2.1]: tag dành riêng (admin/twelve/support…) không đăng ký được — chặn mạo danh quản trị.
    if (isReservedTagName(rawTagName)) {
      return res.status(409).json({ error: "Tag Name Search này được dành riêng, vui lòng chọn tên khác." });
    }

    const tagName = normalizeTagName(rawTagName);
    const tagRef = db.collection(COLLECTIONS.TAGNAMES).doc(tagName);

    // v1.1 [vá từ 2.0.5]: kiểm tra tagName TRƯỚC khi tạo user Firebase. Trước đây luôn tạo user rồi mới phát hiện tag đã
    // dùng và phải xoá user vừa tạo (tốn 2 lệnh Auth, và để lại user mồ côi nếu tiến trình chết giữa chừng).
    // Giao dịch bên dưới vẫn là chốt chặn cuối cùng chống race.
    if ((await tagRef.get()).exists) {
      return res.status(409).json({ error: "Tag Name Search này đã được sử dụng." });
    }

    // Tạo user trong Firebase Auth — enabled để client có thể gọi sendEmailVerification
    let userRecord;
    try {
      userRecord = await auth.createUser({
        email,
        password,
        displayName,
        emailVerified: false,
        disabled: false,
      });
    } catch (err) {
      if (err.code === "auth/email-already-exists") {
        return res.status(409).json({ error: "Email này đã được đăng ký." });
      }
      throw err;
    }

    try {
      // Giao dịch: đảm bảo tagName chưa tồn tại rồi mới ghi user
      await db.runTransaction(async (tx) => {
        const tagSnap = await tx.get(tagRef);
        if (tagSnap.exists) {
          throw Object.assign(new Error("TAGNAME_TAKEN"), { code: "TAGNAME_TAKEN" });
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userRecord.uid);
        tx.set(userRef, {
          uid: userRecord.uid,
          fullName, // chỉ dùng nội bộ để xác minh, không public
          displayName,
          tagName,
          birthday,
          gender,
          country,
          email,
          avatarUrl: null,
          accountRole: ACCOUNT_ROLE.USER,
          accountGroup: ROLE_TO_GROUP[ACCOUNT_ROLE.USER],
          status: ACCOUNT_STATUS.PENDING,
          isFirstLogin: true,
          // postsScoreSum chỉ là CACHE (xem utils/helpers.js#postsScoreSumWrite)
          // — khởi tạo 0 cho nhất quán, không phải nguồn sự thật. KHÔNG hiển
          // thị trên UI frontend ở thời điểm hiện tại (v0.8.8).
          postsScoreSum: 0,
          // positiveScore (v0.8.17): NGƯỢC LẠI với postsScoreSum — đây LÀ
          // nguồn sự thật (cộng/trừ thuần túy, không tính lại từ đâu cả). Xem
          // utils/helpers.js#positiveScoreWrite để biết đầy đủ ngữ nghĩa
          // (có thể âm, không hồi tố hành động trước v0.8.17).
          positiveScore: 0,
          // accountScore (v0.8.23) = postsScoreSum + positiveScore — CŨNG
          // chỉ là cache (giống postsScoreSum), tự đối soát ở
          // utils/helpers.js#syncAccountScore (đăng nhập/truy cập) và ngay
          // tại mọi nơi ghi postsScoreSum/positiveScore (cộng cùng delta).
          // Hiển thị trên UI frontend (Menu > card info user), bấm vào xem
          // chi tiết nguồn gốc.
          accountScore: 0,
          // weeklySnapshot (v0.10.0) — mốc accountScore đầu tuần hiện tại,
          // dùng để tính "Điểm tăng trong tuần" ở trang Xu hướng (xem
          // trending.controller.js). null = chưa có mốc nào (sẽ tự khởi tạo
          // ở lần tính bảng xếp hạng tuần đầu tiên chạm tới tài khoản này).
          weeklySnapshot: null,
          createdAt: new Date().toISOString(),
        });
        tx.set(tagRef, { uid: userRecord.uid });
      });
    } catch (err) {
      // rollback: xoá user vừa tạo trong Firebase Auth nếu ghi Firestore thất bại
      await auth.deleteUser(userRecord.uid).catch(() => {});
      if (err.code === "TAGNAME_TAKEN") {
        return res.status(409).json({ error: "Tag Name Search này đã có người dùng." });
      }
      throw err;
    }

    return res.status(201).json({
      message:
        "Đăng ký thành công. Vui lòng đăng nhập và xác minh email (Firebase sẽ gửi link xác minh) để kích hoạt tài khoản.",
      uid: userRecord.uid,
    });
  } catch (err) {
    console.error("register error:", err);
    return res.status(500).json({ error: "Đăng ký thất bại, vui lòng thử lại." });
  }
}

/**
 * GET /api/auth/check-tagname?tag=abc
 */
async function checkTagName(req, res) {
  const raw = req.query.tag || "";
  if (!isValidTagName(raw)) {
    return res.status(400).json({ available: false, error: "Tag Name Search không hợp lệ." });
  }
  // v1.1 [A-04]: tag dành riêng báo "không dùng được" (frontend hiển thị như tag đã có người dùng).
  if (isReservedTagName(raw)) return res.json({ available: false, reserved: true });
  const tagName = normalizeTagName(raw);
  const snap = await db.collection(COLLECTIONS.TAGNAMES).doc(tagName).get();
  return res.json({ available: !snap.exists });
}

/**
 * POST /api/auth/activation/sync
 * body: {} (dùng token Authorization)
 *
 * Frontend gọi sau khi phát hiện emailVerified=true (từ Firebase Auth).
 * Đồng bộ status Firestore từ PENDING → ACTIVE.
 */
async function syncActivation(req, res) {
  try {
    const uid = req.authUid;
    if (!uid) {
      return res.status(401).json({ error: "Chưa đăng nhập." });
    }

    // Kiểm tra emailVerified từ token đã decode (middleware đã verify)
    // req.authUser lấy từ Firestore; email_verified nằm trên decoded token.
    // Để chắc chắn, lấy lại userRecord từ Auth.
    const userRecord = await auth.getUser(uid);
    if (!userRecord.emailVerified) {
      return res.status(400).json({
        error: "Email chưa được xác minh. Vui lòng bấm link trong email Firebase gửi.",
        emailVerified: false,
      });
    }

    const userRef = db.collection(COLLECTIONS.USERS).doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Không tìm thấy hồ sơ người dùng." });
    }

    const data = snap.data();
    if (data.status === ACCOUNT_STATUS.ACTIVE) {
      return res.json({ message: "Tài khoản đã active.", status: ACCOUNT_STATUS.ACTIVE });
    }

    await userRef.update({ status: ACCOUNT_STATUS.ACTIVE });
    return res.json({
      message: "Kích hoạt tài khoản thành công.",
      status: ACCOUNT_STATUS.ACTIVE,
    });
  } catch (err) {
    console.error("syncActivation error:", err);
    return res.status(500).json({ error: "Đồng bộ trạng thái thất bại." });
  }
}

/**
 * (Legacy / optional) POST /api/auth/activation/send
 * Giữ endpoint để tương thích tạm thời, nhưng chỉ trả về hướng dẫn dùng Firebase.
 * Không còn gửi mã tùy chỉnh.
 */
async function sendActivation(req, res) {
  return res.status(410).json({
    error:
      "Tính năng mã kích hoạt tùy chỉnh đã được thay bằng Firebase Email Verification. " +
      "Hãy đăng nhập rồi dùng nút 'Gửi lại email xác minh' trên giao diện (Firebase Client SDK).",
    code: "USE_FIREBASE_EMAIL_VERIFICATION",
  });
}

/**
 * (Legacy) POST /api/auth/activation/verify
 * Không còn hỗ trợ mã 6 số.
 */
async function verifyActivation(req, res) {
  return res.status(410).json({
    error:
      "Tính năng mã kích hoạt tùy chỉnh đã bị gỡ. Vui lòng xác minh qua link email do Firebase gửi.",
    code: "USE_FIREBASE_EMAIL_VERIFICATION",
  });
}

module.exports = {
  register,
  checkTagName,
  syncActivation,
  sendActivation,
  verifyActivation,
};
