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

    const tagName = normalizeTagName(rawTagName);
    const tagRef = db.collection(COLLECTIONS.TAGNAMES).doc(tagName);

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
