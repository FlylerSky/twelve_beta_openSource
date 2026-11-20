#!/usr/bin/env node
/**
 * migrate-legacy-data.js
 * ============================================================================
 * Chuyển đổi dữ liệu Firestore hiện có (schema Twelve Old) sang schema mà
 * mã nguồn Twelve Beta yêu cầu — CHẠY 1 LẦN, ngay trước khi Beta thay thế
 * Old trên cùng một Firebase project (KHÔNG có di chuyển Firebase Auth,
 * vì đây là cùng một project — Auth giữ nguyên).
 *
 * AN TOÀN / IDEMPOTENT:
 *  - Mỗi user/post sau khi migrate được đánh dấu `legacyMigratedAt`. Lần
 *    chạy sau sẽ tự bỏ qua các doc đã có field này.
 *  - Mặc định LUÔN chạy dry-run (chỉ in log, KHÔNG ghi Firestore). Phải
 *    truyền `--apply` mới thực sự ghi dữ liệu.
 *
 * CÁCH DÙNG:
 *   node backend/scripts/migrate-legacy-data.js                # dry-run
 *   node backend/scripts/migrate-legacy-data.js --limit=20      # dry-run, thử 20 đầu
 *   node backend/scripts/migrate-legacy-data.js --apply
 *   node backend/scripts/migrate-legacy-data.js --apply --limit=20
 *
 * ============================================================================
 * BẢN SỬA LỖI (v2) SAU KHI RÀ SOÁT KỸ TRƯỚC NGÀY CUTOVER — 3 vấn đề đã tìm
 * thấy và sửa so với bản đầu tiên:
 *
 * 1) [NGHIÊM TRỌNG] Old lưu `tagName` KÈM dấu "@" (vd: "@johndoe"), có thể
 *    lẫn chữ hoa. Beta lưu tagName KHÔNG có "@", luôn chữ thường, và mọi nơi
 *    hiển thị tự thêm "@" vào (`toPublicUser`, trending.controller.js). Nếu
 *    không chuẩn hoá lại, user cũ sẽ hiện tagName dạng "@@johndoe" (lỗi hiển
 *    thị), đồng thời doc `tagNames/{tagName}` bị tạo sai id — user mới có
 *    thể đăng ký trùng tagName mà user cũ tưởng như đã sở hữu. Bản này:
 *    normalize (bỏ "@", lowercase) TRƯỚC khi ghi `tagName` và tạo doc
 *    `tagNames/{...}`, đồng thời phát hiện và CẢNH BÁO (không ghi đè) nếu
 *    2 user cũ trùng tagName sau khi chuẩn hoá (vd "@JohnDoe" và "@johndoe").
 *
 * 2) [QUAN TRỌNG] Old lưu `content` bài viết là PLAIN TEXT thô (không có
 *    thẻ HTML nào, kể cả xuống dòng). Nếu chỉ đưa thẳng qua `sanitizeHtml`
 *    (dùng cho HTML từ Quill), 2 vấn đề xảy ra: (a) xuống dòng gốc bị HTML
 *    "nuốt mất" — bài nhiều đoạn dồn thành 1 dòng dài khi hiển thị; (b) một
 *    số ký tự người dùng gõ tình cờ giống cú pháp HTML (`<`, `>`, `&`...) có
 *    thể bị parser HTML hiểu sai / mất nội dung. Bản này escape HTML entities
 *    trước, rồi bọc đoạn văn bằng `<p>`/`<br>` mới đưa qua `sanitizeHtml` —
 *    vừa an toàn vừa giữ đúng format nhiều đoạn.
 *
 * 3) [CẦN HIỂU RÕ — không phải bug, nhưng ảnh hưởng đến kỳ vọng] Twelve Beta
 *    tính `postScore` HIỂN THỊ TRÊN UI theo công thức LUÔN TÍNH LẠI SỐNG từ
 *    likeCount/dislikeCount/viewCount/commentCount/shareCount MỖI LẦN tải
 *    bài (xem `computePostScore` trong posts.controller.js#formatCardPost
 *    và #formatFullPost) — KHÔNG đọc field `postScore` lưu sẵn để hiển thị.
 *    Nghĩa là: nếu giữ nguyên các chỉ số bài viết (như bạn yêu cầu) thì
 *    postScore hiển thị của bài cũ SẼ KHÔNG BAO GIỜ là 0 — nó phản ánh đúng
 *    tương tác thật đã có. KHÔNG THỂ vừa giữ chỉ số vừa hiện postScore = 0
 *    cho từng bài — 2 yêu cầu này loại trừ nhau ở tầng dữ liệu của Beta.
 *    Cái THỰC SỰ được đảm bảo công bằng (và vẫn đúng như bạn muốn) là
 *    XẾP HẠNG/ĐIỂM TÀI KHOẢN (accountScore, postsScoreSum, trang Xu hướng)
 *    — vì các giá trị này CHỈ cộng dồn qua `externalPostScore` (được reset
 *    về 0, KHÔNG tính lại sống từ counts), nên mọi tài khoản cũ đều xuất
 *    phát lại từ 0 trên bảng xếp hạng, chỉ tăng khi có tương tác MỚI sau
 *    ngày cutover. Bản này ghi `postScore` = giá trị tính đúng từ counts
 *    hiện có (thay vì ghi 0 giả) để Firestore nhất quán ngay từ đầu, tránh
 *    hiểu lầm khi xem trực tiếp trong Console.
 * ============================================================================
 */

require("dotenv").config();
const path = require("path");

const { db, auth, admin } = require(path.join(__dirname, "..", "src", "config", "firebase"));
const {
  COLLECTIONS,
  SUBCOLLECTIONS,
  ACCOUNT_ROLE,
  ACCOUNT_GROUP,
  ACCOUNT_STATUS,
} = require(path.join(__dirname, "..", "src", "utils", "constants"));
const { sanitizeHtml, htmlToExcerpt, escapeHtml } = require(path.join(
  __dirname, "..", "src", "services", "sanitize.service"
));
const { computePostScore } = require(path.join(__dirname, "..", "src", "utils", "helpers"));

const FieldValue = admin.firestore.FieldValue;

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : null;

const stats = {
  users: { total: 0, updated: 0, skippedAlready: 0, legacyPrivilegeGranted: 0, uidPatched: 0, errors: 0 },
  tagNames: { created: 0, skipped: 0, collisions: 0 },
  posts: { total: 0, updated: 0, errors: 0 },
  reactionsRenamed: 0,
  commentsNormalized: 0,
};

function log(...args) {
  console.log(...args);
}

/**
 * Old cho phép "@TênCóHoa" — chuẩn hoá về đúng quy tắc Beta: bỏ "@", lowercase.
 * (Beta: utils/helpers.js#normalizeTagName)
 */
function normalizeLegacyTagName(raw) {
  if (!raw || typeof raw !== "string") return "";
  let t = raw.trim().toLowerCase();
  if (t.startsWith("@")) t = t.slice(1);
  return t;
}

/**
 * Old lưu content bài viết dạng plain text thô (không HTML). Escape trước
 * để không vỡ ký tự đặc biệt, rồi bọc <p>/<br> để giữ đúng xuống dòng khi
 * hiển thị dưới dạng HTML (Beta luôn render nội dung post là HTML).
 */
function legacyPlainTextToHtml(raw) {
  if (!raw || typeof raw !== "string") return "";
  const escaped = escapeHtml(raw);
  const paragraphs = escaped
    .split(/\n{2,}/) // 2+ dòng trống = ngắt đoạn
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return paragraphs || `<p>${escaped}</p>`;
}

async function migrateUsers() {
  log("\n=== USERS ===");
  let query = db.collection(COLLECTIONS.USERS);
  if (LIMIT) query = query.limit(LIMIT);
  const snap = await query.get();
  stats.users.total = snap.size;

  // Tra trước toàn bộ tagNames đã tồn tại trong lần chạy này để phát hiện
  // trùng lặp NGAY TRONG CHÍNH tệp user Old (vd "@JohnDoe" và "@johndoe"),
  // không chỉ trùng với dữ liệu đã có sẵn trên Firestore.
  const seenTagNames = new Map(); // normalizedTag -> uid

  for (const doc of snap.docs) {
    const uid = doc.id;
    const data = doc.data();

    const update = {};
    const wasActivated = data.isActivated === true;

    // ---- [v3 — vá lỗi] Old KHÔNG lưu field `uid` bên trong chính document
    // user (chỉ dựa vào doc ID). Beta lưu `uid` ngay trong document lúc
    // đăng ký và `toPublicUser()` đọc field này để ghép tác giả cho danh
    // sách bài viết — thiếu field này khiến `post.author.uid` luôn
    // undefined, làm click vào thông tin tác giả trên card bài viết (Index/
    // Blog/Post) không có tác dụng (trang Xu hướng không bị ảnh hưởng vì
    // nó lấy uid từ doc.id riêng, không qua field này).
    // Chạy TRƯỚC bước bỏ qua user đã migrate, để tự sửa được cả những user
    // đã lỡ apply bằng bản script cũ (v1/v2) còn thiếu field này. ----
    if (data.uid === undefined) {
      update.uid = uid;
    }

    if (data.legacyMigratedAt) {
      if (Object.keys(update).length > 0) {
        log(`[user] ${uid} — vá field \`uid\` còn thiếu (user đã migrate trước đó bằng bản script cũ)`);
        if (APPLY) {
          try {
            await doc.ref.update(update);
            stats.users.uidPatched++;
          } catch (err) {
            console.error(`  ! Lỗi vá uid cho user ${uid}:`, err.message);
            stats.users.errors++;
          }
        }
      }
      stats.users.skippedAlready++;
      continue;
    }

    if (data.fullName === undefined && data.realName !== undefined) {
      update.fullName = data.realName;
    }
    if (data.status === undefined) {
      update.status = wasActivated ? ACCOUNT_STATUS.ACTIVE : ACCOUNT_STATUS.PENDING;
    }
    if (data.avatarUrl === undefined) update.avatarUrl = null;
    if (data.isFirstLogin === undefined) update.isFirstLogin = false;

    // ---- tagName: chuẩn hoá bắt buộc (xem mục 1 ở đầu file) ----
    const normalizedTagName = normalizeLegacyTagName(data.tagName);
    if (normalizedTagName) {
      update.tagName = normalizedTagName;
      if (normalizedTagName.length > 20) {
        log(
          `  ! [user ${uid}] Cảnh báo: tagName "${normalizedTagName}" dài ${normalizedTagName.length} ký tự ` +
          `(Beta chỉ cho phép tối đa 20 khi đổi tên sau này — KHÔNG chặn hiển thị hiện tại, chỉ ảnh hưởng nếu user tự đổi tag sau này).`
        );
      }
    }

    // ---- Đặc quyền user cũ: CHỈ cấp cho tài khoản đã từng được kích hoạt
    // thật (isActivated=true ở Old) — tài khoản pending/chưa từng dùng thì
    // không có gì để "công nhận là thành viên cũ". ----
    if (wasActivated) {
      update.isLegacyMember = true;
      update.legacySince = data.createdAt || null;
      update.accountRole = ACCOUNT_ROLE.PRO_USER;
      update.accountGroup = ACCOUNT_GROUP.RA;
      stats.users.legacyPrivilegeGranted++;
    }

    // Reset điểm số (áp dụng cho mọi user, kể cả pending, để đồng bộ schema)
    update.postsScoreSum = 0;
    update.positiveScore = 0;
    update.accountScore = 0;
    update.weeklySnapshot = null;

    // Dọn field cũ
    update.isActivated = FieldValue.delete();
    update.activationCode = FieldValue.delete();
    update.realName = FieldValue.delete();
    update.migrated = FieldValue.delete();

    update.legacyMigratedAt = FieldValue.serverTimestamp();

    log(`[user] ${uid} (@${normalizedTagName || data.tagName || "?"})${wasActivated ? " [legacy+pro_user]" : " [pending]"}`);

    if (APPLY) {
      try {
        await doc.ref.update(update);

        if (wasActivated) {
          await auth.updateUser(uid, { emailVerified: true }).catch((e) => {
            log(`  ! auth.updateUser lỗi cho ${uid}: ${e.message}`);
          });
        }

        if (normalizedTagName) {
          const priorOwner = seenTagNames.get(normalizedTagName);
          if (priorOwner && priorOwner !== uid) {
            console.error(
              `  ! TRÙNG TAGNAME sau chuẩn hoá: "${normalizedTagName}" thuộc cả ${priorOwner} và ${uid}. ` +
              `KHÔNG tự động xử lý — cần đổi tay 1 trong 2 tagName trước khi launch.`
            );
            stats.tagNames.collisions++;
          } else {
            seenTagNames.set(normalizedTagName, uid);
            const tagRef = db.collection(COLLECTIONS.TAGNAMES).doc(normalizedTagName);
            const tagSnap = await tagRef.get();
            if (!tagSnap.exists) {
              await tagRef.set({ uid });
              stats.tagNames.created++;
            } else if (tagSnap.data()?.uid !== uid) {
              console.error(
                `  ! TRÙNG TAGNAME với dữ liệu đã có sẵn trên Firestore: "${normalizedTagName}" ` +
                `(đang thuộc ${tagSnap.data()?.uid}, user hiện tại ${uid}). Cần xử lý tay.`
              );
              stats.tagNames.collisions++;
            } else {
              stats.tagNames.skipped++;
            }
          }
        }

        stats.users.updated++;
      } catch (err) {
        console.error(`  ! Lỗi user ${uid}:`, err.message);
        stats.users.errors++;
      }
    }
  }
}

async function migratePostSubcollections(postRef, postId) {
  // 1) "likes/{uid}" (schema Old) -> "reactions/{uid}" (schema Beta)
  const likesSnap = await postRef.collection("likes").get();
  for (const likeDoc of likesSnap.docs) {
    const d = likeDoc.data();
    const type = d.type || d.action;
    if (!["like", "dislike"].includes(type)) {
      await likeDoc.ref.delete();
      continue;
    }
    const newRef = postRef.collection(SUBCOLLECTIONS.REACTIONS).doc(likeDoc.id);
    const newSnap = await newRef.get();
    if (!newSnap.exists) {
      await newRef.set({
        uid: d.uid || likeDoc.id,
        type,
        createdAt: d.createdAt || FieldValue.serverTimestamp(),
      });
      stats.reactionsRenamed++;
    }
    await likeDoc.ref.delete();
  }

  // 2) comments đã ở đúng subcollection nhưng còn field cũ (uid/displayName/tagName)
  const commentsSnap = await postRef.collection(SUBCOLLECTIONS.COMMENTS).get();
  for (const cDoc of commentsSnap.docs) {
    const d = cDoc.data();
    if (d.authorUid) continue; // đã đúng chuẩn Beta
    await cDoc.ref.update({
      id: cDoc.id,
      authorUid: d.uid || null,
      updatedAt: d.updatedAt || d.createdAt || FieldValue.serverTimestamp(),
      isEdited: false,
      uid: FieldValue.delete(),
      displayName: FieldValue.delete(),
      tagName: FieldValue.delete(),
    });
    stats.commentsNormalized++;
  }

  // 3) data rác còn sót ở root collection "comments" (từ user chưa từng chạy
  //    /api/users/migrate nội bộ của Old trước đây)
  const orphanSnap = await db.collection("comments").where("postId", "==", postId).get();
  for (const oDoc of orphanSnap.docs) {
    const d = oDoc.data();
    const newRef = postRef.collection(SUBCOLLECTIONS.COMMENTS).doc(oDoc.id);
    const newSnap = await newRef.get();
    if (!newSnap.exists) {
      await newRef.set({
        id: oDoc.id,
        authorUid: d.uid || null,
        content: d.content || "",
        createdAt: d.createdAt || FieldValue.serverTimestamp(),
        updatedAt: d.createdAt || FieldValue.serverTimestamp(),
        isEdited: false,
      });
      stats.commentsNormalized++;
    }
    await oDoc.ref.delete();
  }
}

async function migratePosts() {
  log("\n=== POSTS ===");
  let query = db.collection(COLLECTIONS.POSTS);
  if (LIMIT) query = query.limit(LIMIT);
  const snap = await query.get();
  stats.posts.total = snap.size;

  for (const doc of snap.docs) {
    const postId = doc.id;
    const data = doc.data();

    if (data.legacyMigratedAt) continue;

    const update = {};

    if (data.authorUid === undefined && data.uid !== undefined) {
      update.authorUid = data.uid;
    }
    if (data.contentHtml === undefined && data.content !== undefined) {
      const html = legacyPlainTextToHtml(data.content);
      const clean = sanitizeHtml(html);
      update.contentHtml = clean;
      update.excerpt = htmlToExcerpt(clean);
    }
    if (data.coverImageUrl === undefined) update.coverImageUrl = null;
    if (data.aiViewCount === undefined) update.aiViewCount = 0;
    if (data.externalPostScore === undefined) update.externalPostScore = 0;

    // postScore: KHÔNG ghi 0 giả (xem mục 3 ở đầu file — Beta luôn tính lại
    // sống từ counts khi hiển thị, ghi 0 sẽ chỉ gây hiểu lầm tạm thời rồi tự
    // đổi ngay lần đầu ai đó xem bài). Ghi đúng giá trị tính từ counts hiện
    // có để Firestore nhất quán với những gì UI sẽ hiển thị ngay từ đầu.
    update.postScore = computePostScore({
      viewCount: data.viewCount || 0,
      likeCount: data.likeCount || 0,
      dislikeCount: data.dislikeCount || 0,
      commentCount: data.commentCount || 0,
      shareCount: data.shareCount || 0,
    });

    update.id = postId;
    update.legacyMigratedAt = FieldValue.serverTimestamp();

    log(`[post] ${postId} — "${(data.title || "").slice(0, 40)}"`);

    if (APPLY) {
      try {
        await doc.ref.update(update);
        stats.posts.updated++;
        await migratePostSubcollections(doc.ref, postId);
      } catch (err) {
        console.error(`  ! Lỗi post ${postId}:`, err.message);
        stats.posts.errors++;
      }
    }
  }
}

async function main() {
  log(
    `\n>>> Twelve — migrate legacy data (v2) — mode: ${
      APPLY ? "APPLY (SẼ GHI Firestore)" : "DRY-RUN (chỉ xem trước, chưa ghi gì)"
    }${LIMIT ? `, limit=${LIMIT}` : ""}\n`
  );

  await migrateUsers();
  await migratePosts();

  log("\n=== KẾT QUẢ ===");
  log(JSON.stringify(stats, null, 2));

  if (stats.tagNames.collisions > 0) {
    log(`\n>>> ⚠ CÓ ${stats.tagNames.collisions} TRÙNG TAGNAME CẦN XỬ LÝ TAY TRƯỚC KHI LAUNCH — xem log ở trên.`);
  }

  if (DRY_RUN) {
    log("\n>>> Đây là DRY-RUN — CHƯA có gì được ghi vào Firestore.");
    log(">>> Kiểm tra kỹ log ở trên (đặc biệt phần trùng tagName), rồi chạy lại kèm --apply:");
    log("    node backend/scripts/migrate-legacy-data.js --apply\n");
  } else {
    log("\n>>> Đã ghi xong vào Firestore. Có thể chạy lại script này an toàn");
    log(">>> (các doc đã có `legacyMigratedAt` sẽ tự động được bỏ qua).\n");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
