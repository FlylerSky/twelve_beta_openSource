const { db, admin } = require("../config/firebase");
const { COLLECTIONS, SUBCOLLECTIONS, ACCOUNT_GROUP, ACCOUNT_STATUS, TRENDING, SCORE_MODE } = require("../utils/constants");
const { getWeekInfo } = require("../utils/weekCode");
const { computePostScore } = require("../utils/helpers");
const { attachAuthors } = require("./posts.controller");

const FieldValue = admin.firestore.FieldValue;
const CONFIG_DOC_ID = "trendingState";
// Nếu 1 request đã "giành" quyền thực hiện rollover nhưng crash/treo quá
// lâu mà chưa hoàn tất, cho phép request SAU thử lại thay vì kẹt vĩnh viễn.
const STALE_CLAIM_MS = 2 * 60 * 1000;

function isEligibleForRanking(userData) {
  // Không đưa tài khoản thử nghiệm (LLA) hoặc chưa kích hoạt vào bảng xếp
  // hạng công khai — đây là bảng xếp hạng cộng đồng, không phải dữ liệu debug.
  if (!userData) return false;
  if (userData.accountGroup === ACCOUNT_GROUP.LLA) return false;
  if (userData.status !== ACCOUNT_STATUS.ACTIVE) return false;
  return true;
}

function toRankingEntry(uid, d, extra = {}) {
  return {
    uid,
    displayName: d.displayName || null,
    avatarUrl: d.avatarUrl || null,
    tagName: d.tagName ? `@${d.tagName}` : null,
    accountGroup: d.accountGroup || null,
    accountScore: d.accountScore || 0,
    ...extra,
  };
}

/**
 * ==== v0.10.0 — CHỐT TUẦN CŨ + RESET SNAPSHOT CHO TUẦN MỚI ====
 * Được gọi (lazy, không cần cron ngoài) mỗi khi có request tới bảng xếp
 * hạng "Tuần qua" — nếu mã tuần hiện tại CHƯA được đánh dấu đã xử lý trong
 * `config/trendingState`, đây là request ĐẦU TIÊN chạm vào tuần mới này:
 *   1. Đọc TOÀN BỘ user (kèm `weeklySnapshot` — điểm accountScore lúc tuần
 *      TRƯỚC bắt đầu).
 *   2. Với mỗi user, tính `growth = accountScore hiện tại - accountScoreAtStart`
 *      — đây chính là kết quả CUỐI CÙNG của tuần VỪA KẾT THÚC (mã tuần cũ
 *      lưu trong snapshot của họ).
 *   3. Sắp xếp theo growth, lưu VĨNH VIỄN top 10 vào
 *      `weeklyLeaderboards/{mãTuầnCũ}` — phục vụ tính năng thành tích/vinh
 *      danh sau này (KHÔNG BAO GIỜ ghi đè lại 1 mã tuần đã chốt).
 *   4. Reset `weeklySnapshot` của TOÀN BỘ user về
 *      `{ weekCode: mãTuầnMới, accountScoreAtStart: accountScore hiện tại }`
 *      — mốc khởi đầu cho việc tính growth của tuần MỚI.
 *
 * Dùng transaction trên 1 doc config để CHỈ 1 request được "giành quyền"
 * thực hiện — tránh 2 request cùng lúc (2 người mở trang Xu hướng đúng lúc
 * tuần vừa đổi) chạy trùng logic chốt tuần/reset 2 lần.
 */
async function ensureWeekRollover(currentWeekCode) {
  const configRef = db.collection(COLLECTIONS.CONFIG).doc(CONFIG_DOC_ID);
  const now = Date.now();

  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(configRef);
    const data = snap.exists ? snap.data() : {};
    if (data.lastFinalizedWeekCode === currentWeekCode) return false; // tuần này đã xử lý xong

    const claimIsFresh =
      data.rolloverInProgress === currentWeekCode &&
      data.rolloverClaimedAtMs &&
      now - data.rolloverClaimedAtMs < STALE_CLAIM_MS;
    if (claimIsFresh) return false; // có request khác đang làm, còn "tươi" -> không giành

    tx.set(configRef, { rolloverInProgress: currentWeekCode, rolloverClaimedAtMs: now }, { merge: true });
    return true;
  });

  if (!claimed) return;

  try {
    await performWeekRollover(currentWeekCode);
    await configRef.set(
      { lastFinalizedWeekCode: currentWeekCode, rolloverInProgress: null },
      { merge: true }
    );
  } catch (err) {
    // KHÔNG set lastFinalizedWeekCode nếu lỗi — request tiếp theo (sau khi
    // claim hết hạn STALE_CLAIM_MS) sẽ tự động thử lại từ đầu.
    console.error(`ensureWeekRollover(${currentWeekCode}) lỗi khi thực hiện:`, err.message);
  }
}

async function performWeekRollover(newWeekCode) {
  const snap = await db
    .collection(COLLECTIONS.USERS)
    .select("displayName", "avatarUrl", "tagName", "accountGroup", "status", "accountScore", "weeklySnapshot")
    .get();

  // Gom user theo mã tuần CŨ ghi trong snapshot của họ — thường tất cả sẽ
  // cùng 1 mã (mã tuần ngay trước newWeekCode), nhưng xử lý tổng quát cho
  // trường hợp có user "ngủ" nhiều tuần chưa từng được đọc lại (snapshot cũ
  // hơn 1 tuần) — mỗi mã tuần tồn đọng vẫn được chốt đúng của riêng nó.
  const growthByOldWeek = new Map();
  snap.docs.forEach((doc) => {
    const d = doc.data();
    const oldSnapshot = d.weeklySnapshot;
    if (!oldSnapshot || !oldSnapshot.weekCode) return; // chưa từng có snapshot -> chưa có tuần nào để chốt
    if (!isEligibleForRanking(d)) return; // không đưa LLA/tài khoản chưa active vào bảng đã chốt
    const growth = (d.accountScore || 0) - (oldSnapshot.accountScoreAtStart || 0);
    const list = growthByOldWeek.get(oldSnapshot.weekCode) || [];
    list.push(toRankingEntry(doc.id, d, { weeklyGrowth: growth }));
    growthByOldWeek.set(oldSnapshot.weekCode, list);
  });

  for (const [oldWeekCode, list] of growthByOldWeek.entries()) {
    list.sort((a, b) => b.weeklyGrowth - a.weeklyGrowth);
    const top10 = list.slice(0, TRENDING.TOP_TIER_SIZE).map((u, i) => ({ rank: i + 1, ...u }));
    // set() KHÔNG merge — đây là bản ghi lịch sử CỐ ĐỊNH, mỗi mã tuần chỉ
    // được ghi ĐÚNG 1 LẦN DUY NHẤT khi tuần đó vừa kết thúc.
    await db.collection(COLLECTIONS.WEEKLY_LEADERBOARDS).doc(oldWeekCode).set({
      weekCode: oldWeekCode,
      top10,
      totalParticipants: list.length,
      finalizedAt: FieldValue.serverTimestamp(),
    });
  }

  // Reset snapshot của TOÀN BỘ user (kể cả LLA/pending — họ vẫn cần mốc
  // khởi đầu đúng cho tuần mới, dù không xuất hiện trong bảng xếp hạng công
  // khai) về tuần MỚI. Firestore giới hạn 500 write/batch -> chia nhỏ.
  const BATCH_SIZE = 450;
  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    snap.docs.slice(i, i + BATCH_SIZE).forEach((doc) => {
      const d = doc.data();
      batch.set(
        doc.ref,
        { weeklySnapshot: { weekCode: newWeekCode, accountScoreAtStart: d.accountScore || 0 } },
        { merge: true }
      );
    });
    await batch.commit();
  }
}

/**
 * GET /api/trending/users/weekly
 * Bảng xếp hạng người dùng theo mức TĂNG accountScore trong tuần hiện tại
 * (đang diễn ra, cập nhật liên tục cho tới khi tuần kết thúc).
 */
async function getWeeklyRanking(req, res) {
  try {
    const weekInfo = getWeekInfo();
    await ensureWeekRollover(weekInfo.code);

    const snap = await db
      .collection(COLLECTIONS.USERS)
      .select("displayName", "avatarUrl", "tagName", "accountGroup", "status", "accountScore", "weeklySnapshot")
      .get();

    const ranked = [];
    const staleFixes = []; // user thiếu/lệch snapshot tuần hiện tại (vd. mới đăng ký giữa tuần) -> tự sửa, không chặn response

    snap.docs.forEach((doc) => {
      const d = doc.data();
      if (!isEligibleForRanking(d)) return;

      let startScore;
      if (d.weeklySnapshot && d.weeklySnapshot.weekCode === weekInfo.code) {
        startScore = d.weeklySnapshot.accountScoreAtStart || 0;
      } else {
        // Chưa có snapshot cho tuần hiện tại -> coi mốc khởi đầu = điểm hiện
        // tại (growth = 0 cho tới khi điểm họ đổi tiếp) + tự sửa lại.
        startScore = d.accountScore || 0;
        staleFixes.push({ ref: doc.ref, accountScore: d.accountScore || 0 });
      }

      ranked.push(toRankingEntry(doc.id, d, { weeklyGrowth: (d.accountScore || 0) - startScore }));
    });

    if (staleFixes.length) {
      const batch = db.batch();
      staleFixes.forEach((f) => {
        batch.set(
          f.ref,
          { weeklySnapshot: { weekCode: weekInfo.code, accountScoreAtStart: f.accountScore } },
          { merge: true }
        );
      });
      batch.commit().catch((err) => console.error("getWeeklyRanking: lỗi tự sửa snapshot:", err.message));
    }

    ranked.sort((a, b) => b.weeklyGrowth - a.weeklyGrowth);
    const ranking = ranked.slice(0, TRENDING.RANKING_LIMIT).map((u, i) => ({ rank: i + 1, ...u }));

    return res.json({ weekCode: weekInfo.code, weekInfo, ranking });
  } catch (err) {
    console.error("getWeeklyRanking error:", err);
    return res.status(500).json({ error: "Không tải được bảng xếp hạng tuần." });
  }
}

/**
 * GET /api/trending/users/alltime
 * Bảng xếp hạng người dùng theo accountScore toàn thời gian — cập nhật liên
 * tục (không chốt theo tuần như bảng "Tuần qua").
 */
async function getAllTimeRanking(req, res) {
  try {
    // Ưu tiên orderBy accountScore (cần single-field index — Firestore tự tạo).
    // Fallback: đọc select + sort JS nếu orderBy lỗi (field thiếu / index).
    let docs;
    try {
      const snap = await db
        .collection(COLLECTIONS.USERS)
        .orderBy("accountScore", "desc")
        .limit(TRENDING.RANKING_LIMIT + 40)
        .select("displayName", "avatarUrl", "tagName", "accountGroup", "status", "accountScore")
        .get();
      docs = snap.docs;
    } catch (orderErr) {
      console.warn("getAllTimeRanking orderBy failed, fallback scan:", orderErr.message);
      const snap = await db
        .collection(COLLECTIONS.USERS)
        .select("displayName", "avatarUrl", "tagName", "accountGroup", "status", "accountScore")
        .get();
      docs = snap.docs;
    }

    const ranking = docs
      .map((doc) => ({ uid: doc.id, data: doc.data() }))
      .filter((u) => isEligibleForRanking(u.data))
      .sort((a, b) => (b.data.accountScore || 0) - (a.data.accountScore || 0))
      .slice(0, TRENDING.RANKING_LIMIT)
      .map((u, i) => ({ rank: i + 1, ...toRankingEntry(u.uid, u.data) }));

    return res.json({ ranking });
  } catch (err) {
    console.error("getAllTimeRanking error:", err);
    return res.status(500).json({ error: "Không tải được bảng xếp hạng toàn thời gian." });
  }
}

/**
 * ==== v0.10.8 — TAB HASHTAG ====
 *
 * Khác với bảng xếp hạng "Người dùng" (users có sẵn field accountScore lưu
 * trực tiếp trên doc user), hashtag KHÔNG phải là 1 thực thể có doc riêng
 * chứa điểm — nó chỉ là 1 field mảng (`hashtags`) nằm rải rác trên từng
 * post/blog. Vì vậy tổng điểm/lượt dùng của 1 hashtag LUÔN được tính lại
 * bằng cách QUÉT toàn bộ posts + blogs hiện có (chọn lọc field cần thiết qua
 * `.select()` để giảm băng thông) — cùng triết lý "chấp nhận quét toàn bộ ở
 * quy mô nhỏ" đã dùng cho fallback của `getAllTimeRanking` phía trên.
 *
 * `hashtags/{tagChuẩnHoá}` (COLLECTIONS.HASHTAGS) vì vậy CHỈ lưu đúng 1 thứ:
 * mốc `weeklySnapshotClassic`/`weeklySnapshotAdvanced` (điểm tại thời điểm
 * BẮT ĐẦU tuần hiện tại) để tính tăng trưởng tuần — y hệt vai trò
 * `weeklySnapshot` trên doc user.
 */

// Chuẩn hoá hashtag về dạng dùng làm khoá so khớp/doc id: bỏ dấu "#" (nếu
// có) và chuyển chữ thường. Không tách dấu tiếng Việt — 2 hashtag chỉ được
// coi là 1 khi giống hệt nhau (chỉ khác hoa/thường).
function normalizeHashtagKey(raw) {
  if (!raw || typeof raw !== "string") return "";
  let t = raw.trim();
  if (t.startsWith("#")) t = t.slice(1);
  return t.toLowerCase();
}

function scoreFieldForMode(mode) {
  return mode === SCORE_MODE.ADVANCED ? "externalScoreSum" : "postScoreSum";
}

/**
 * Quét posts + blogs hiện có, CHỈ lấy field cần thiết để tính điểm + hashtag.
 * Blog dùng `isPublished == true` — giống bộ lọc của listBlogs (không đưa
 * blog nháp vào bảng xếp hạng/tìm kiếm công khai).
 * @returns {Array<object>} mỗi phần tử có thêm `type: "post"|"blog"` và `docId`
 */
async function scanContentDocs() {
  const POST_FIELDS = [
    "hashtags",
    "likeCount",
    "dislikeCount",
    "commentCount",
    "viewCount",
    "shareCount",
    "externalPostScore",
    "title",
    "excerpt",
    "coverImageUrl",
    "authorUid",
    "createdAt",
    "aiViewCount",
  ];
  const [postsSnap, blogsSnap] = await Promise.all([
    db.collection(COLLECTIONS.POSTS).select(...POST_FIELDS).get(),
    db.collection(COLLECTIONS.BLOGS).where("isPublished", "==", true).select(...POST_FIELDS).get(),
  ]);

  const posts = postsSnap.docs.map((d) => ({ type: "post", docId: d.id, ...d.data() }));
  const blogs = blogsSnap.docs.map((d) => ({ type: "blog", docId: d.id, ...d.data() }));
  return [...posts, ...blogs];
}

/**
 * ==== v0.10.8.1 — CACHE TRONG BỘ NHỚ (giảm đọc Firestore) ====
 * `scanContentDocs()` đọc TOÀN BỘ posts + blogs — tốn kém nếu gọi lại mỗi
 * request (đặc biệt tab Tìm kiếm: gõ vài chữ đã bắn 1 request; và tab Khám
 * phá: chỉ cần mở tab). Cache 1 lớp, dùng CHUNG cho mọi endpoint hashtag
 * (Tuần qua/Khám phá/click 1 hashtag/Tìm kiếm) trong `CACHE_TTL_MS` — nhiều
 * request tới trong cùng cửa sổ thời gian chỉ tốn ĐÚNG 1 lần đọc.
 * Đây là cache TRONG TIẾN TRÌNH (per Node process) — nếu chạy nhiều instance
 * (scale ngang) mỗi instance tự cache riêng, KHÔNG dùng chung; vẫn giảm đáng
 * kể so với không cache. Đánh đổi: dữ liệu có thể "cũ" tối đa `CACHE_TTL_MS`
 * — chấp nhận được vì đây là bảng xếp hạng/tìm kiếm, không phải số liệu cần
 * chính xác tuyệt đối theo thời gian thực.
 */
const CACHE_TTL_MS = 90 * 1000; // 90 giây
let scanCache = { data: null, at: 0 };
let hashtagDocsCache = { data: null, at: 0 }; // Map<key, docData của hashtags/{key}>

async function getCachedScan() {
  const now = Date.now();
  if (scanCache.data && now - scanCache.at < CACHE_TTL_MS) return scanCache.data;
  const data = await scanContentDocs();
  scanCache = { data, at: now };
  return data;
}

async function getCachedHashtagDocsMap() {
  const now = Date.now();
  if (hashtagDocsCache.data && now - hashtagDocsCache.at < CACHE_TTL_MS) return hashtagDocsCache.data;
  const snap = await db.collection(COLLECTIONS.HASHTAGS).get();
  const map = new Map(snap.docs.map((d) => [d.id, d.data()]));
  hashtagDocsCache = { data: map, at: now };
  return map;
}

// Rollover VỪA GHI xong snapshot mới cho `hashtags/*` -> cache cũ (nếu còn)
// sẽ trả dữ liệu SAI trong tối đa CACHE_TTL_MS tiếp theo. Xoá cache ngay để
// lần đọc kế tiếp bắt buộc phải đọc lại Firestore (chỉ xảy ra 1 lần/tuần,
// không đáng kể).
function invalidateHashtagDocsCache() {
  hashtagDocsCache = { data: null, at: 0 };
}

/**
 * Gom nhóm danh sách post/blog (từ scanContentDocs) theo hashtag. Trả về
 * Map<key, { key, tag, usageCount, postScoreSum, externalScoreSum, lastUsedAtMs }>.
 * `tag` giữ đúng dạng hiển thị lần XUẤT HIỆN ĐẦU TIÊN quét được (không ép về
 * 1 kiểu viết hoa/thường cố định).
 */
function aggregateHashtags(items) {
  const map = new Map();
  for (const it of items) {
    const tags = Array.isArray(it.hashtags) ? it.hashtags : [];
    if (!tags.length) continue;
    const postScore = computePostScore(it);
    const externalScore = it.externalPostScore || 0;
    const createdAtMs = toMillis(it.createdAt);

    const seenInThisItem = new Set();
    for (const rawTag of tags) {
      const key = normalizeHashtagKey(rawTag);
      if (!key || seenInThisItem.has(key)) continue; // phòng hashtag trùng lặp (không nên xảy ra, đã validate ở validateHashtags)
      seenInThisItem.add(key);

      let entry = map.get(key);
      if (!entry) {
        entry = { key, tag: rawTag, usageCount: 0, postScoreSum: 0, externalScoreSum: 0, lastUsedAtMs: 0 };
        map.set(key, entry);
      }
      entry.usageCount += 1;
      entry.postScoreSum += postScore;
      entry.externalScoreSum += externalScore;
      if (createdAtMs > entry.lastUsedAtMs) entry.lastUsedAtMs = createdAtMs;
    }
  }
  return map;
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") {
    try {
      return value.toMillis();
    } catch (_) {
      return 0;
    }
  }
  if (typeof value._seconds === "number") return value._seconds * 1000;
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return 0;
}

/**
 * ==== v0.10.17 [SỬA LỖI] Xếp hạng Hashtag chưa có tiêu chí phụ khi đồng
 * điểm ====
 * Trước bản vá, MỌI nơi xếp hạng hashtag (bên dưới) chỉ `sort` theo ĐÚNG 1
 * tiêu chí (điểm/tăng trưởng) — 2 hashtag cùng điểm thì thứ tự phụ thuộc
 * hoàn toàn vào thứ tự duyệt Map/mảng (không ổn định, không có ý nghĩa),
 * dẫn tới hiện tượng hashtag ÍT lượt dùng hơn đôi khi lại xếp TRÊN hashtag
 * cùng điểm nhưng NHIỀU lượt dùng hơn.
 *
 * `compareHashtagRank()` so sánh theo ĐÚNG thứ tự ưu tiên được yêu cầu:
 *   1. Điểm (hoặc tăng trưởng) — giảm dần.
 *   2. Cùng điểm -> lượt sử dụng (`usageCount`) — giảm dần.
 *   3. Cùng cả điểm lẫn lượt dùng -> hashtag có bài viết ĐĂNG GẦN ĐÂY NHẤT
 *      (`lastUsedAtMs`, gán trong `aggregateHashtags()`) xếp trên.
 *
 * Dùng CHUNG cho cả 5 chỗ xếp hạng hashtag trong file này (Tuần qua/Toàn
 * thời gian/Tìm kiếm/2 bảng chốt vĩnh viễn khi rollover) để nhất quán —
 * tránh trường hợp chỉ vá 1 tab mà tab khác vẫn còn lỗi cũ.
 */
function compareHashtagRank(a, b, scoreField) {
  const scoreDiff = (b[scoreField] || 0) - (a[scoreField] || 0);
  if (scoreDiff !== 0) return scoreDiff;
  const usageDiff = (b.usageCount || 0) - (a.usageCount || 0);
  if (usageDiff !== 0) return usageDiff;
  return (b.lastUsedAtMs || 0) - (a.lastUsedAtMs || 0);
}

/**
 * Đọc theo lô (Firestore getAll không giới hạn cứng nhưng chia nhỏ để an
 * toàn, cùng cỡ lô BATCH_SIZE đã dùng cho ghi ở performWeekRollover).
 */
async function getAllDocsChunked(refs, chunkSize = 450) {
  const out = [];
  for (let i = 0; i < refs.length; i += chunkSize) {
    const chunk = await db.getAll(...refs.slice(i, i + chunkSize));
    out.push(...chunk);
  }
  return out;
}

/**
 * ==== ROLLOVER TUẦN CHO HASHTAG ====
 * Cùng cơ chế "lazy, giành quyền qua transaction" như ensureWeekRollover ở
 * trên, nhưng dùng field RIÊNG trong `config/trendingState` (không đụng vào
 * field của rollover user) để 2 rollover độc lập, không chặn lẫn nhau.
 */
async function ensureHashtagWeekRollover(currentWeekCode) {
  const configRef = db.collection(COLLECTIONS.CONFIG).doc(CONFIG_DOC_ID);
  const now = Date.now();

  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(configRef);
    const data = snap.exists ? snap.data() : {};
    if (data.lastFinalizedHashtagWeekCode === currentWeekCode) return false;

    const claimIsFresh =
      data.rolloverHashtagInProgress === currentWeekCode &&
      data.rolloverHashtagClaimedAtMs &&
      now - data.rolloverHashtagClaimedAtMs < STALE_CLAIM_MS;
    if (claimIsFresh) return false;

    tx.set(configRef, { rolloverHashtagInProgress: currentWeekCode, rolloverHashtagClaimedAtMs: now }, { merge: true });
    return true;
  });

  if (!claimed) return;

  try {
    await performHashtagWeekRollover(currentWeekCode);
    await configRef.set(
      { lastFinalizedHashtagWeekCode: currentWeekCode, rolloverHashtagInProgress: null },
      { merge: true }
    );
  } catch (err) {
    console.error(`ensureHashtagWeekRollover(${currentWeekCode}) lỗi khi thực hiện:`, err.message);
  }
}

async function performHashtagWeekRollover(newWeekCode) {
  const items = await scanContentDocs();
  const currentMap = aggregateHashtags(items); // tổng điểm HIỆN TẠI = kết quả CUỐI của tuần vừa kết thúc

  // Đọc snapshot cũ của MỌI hashtag đã từng được lưu doc (kể cả hashtag hiện
  // không còn được dùng nữa — vẫn cần chốt tuần cũ của nó nếu có growth).
  const existingSnap = await db.collection(COLLECTIONS.HASHTAGS).get();
  const existingByKey = new Map(existingSnap.docs.map((d) => [d.id, d.data()]));

  // Hợp nhất khoá: hashtag đang dùng (currentMap) UNION hashtag đã có doc từ trước
  const allKeys = new Set([...currentMap.keys(), ...existingByKey.keys()]);

  const growthByOldWeek = { classic: new Map(), advanced: new Map() }; // oldWeekCode -> [{tag, usageCount, growth}]
  const exploreTop = { classic: [], advanced: [] }; // toàn thời gian, KHÔNG group theo oldWeekCode (chỉ 1 mốc "hiện tại")

  for (const key of allKeys) {
    const current = currentMap.get(key) || { tag: existingByKey.get(key)?.tag || key, usageCount: 0, postScoreSum: 0, externalScoreSum: 0 };
    const existing = existingByKey.get(key);

    for (const mode of [SCORE_MODE.CLASSIC, SCORE_MODE.ADVANCED]) {
      const field = mode === SCORE_MODE.ADVANCED ? "externalScoreSum" : "postScoreSum";
      const snapField = mode === SCORE_MODE.ADVANCED ? "weeklySnapshotAdvanced" : "weeklySnapshotClassic";
      const oldSnapshot = existing && existing[snapField];
      if (!oldSnapshot || !oldSnapshot.weekCode) continue; // chưa từng có snapshot -> chưa có tuần nào để chốt cho hashtag này/mode này

      const growth = (current[field] || 0) - (oldSnapshot.scoreAtStart || 0);
      const list = growthByOldWeek[mode].get(oldSnapshot.weekCode) || [];
      list.push({ tag: current.tag, usageCount: current.usageCount, lastUsedAtMs: current.lastUsedAtMs, growth });
      growthByOldWeek[mode].set(oldSnapshot.weekCode, list);
    }
  }

  // Chốt VĨNH VIỄN top 10 tăng trưởng — mỗi mã tuần/mode chỉ ghi ĐÚNG 1 LẦN.
  for (const mode of [SCORE_MODE.CLASSIC, SCORE_MODE.ADVANCED]) {
    for (const [oldWeekCode, list] of growthByOldWeek[mode].entries()) {
      list.sort((a, b) => compareHashtagRank(a, b, "growth"));
      const top10 = list.slice(0, TRENDING.TOP_TIER_SIZE).map((h, i) => ({ rank: i + 1, ...h }));
      await db
        .collection(COLLECTIONS.HASHTAG_WEEKLY_LEADERBOARDS)
        .doc(`${oldWeekCode}_${mode}`)
        .set({
          weekCode: oldWeekCode,
          mode,
          top10,
          totalParticipants: list.length,
          finalizedAt: FieldValue.serverTimestamp(),
        });
    }

    // Tab Khám phá (toàn thời gian) — LƯU LẠI mỗi lần chốt tuần, không phải
    // bảng "đã chốt" như trên (bảng Khám phá vẫn đang chạy tiếp), mà là 1
    // "ảnh chụp" top 10 tại đúng thời điểm chốt tuần, phục vụ thành tích/vinh
    // danh sau này (vd. "lọt top 10 Khám phá tuần N").
    const exploreList = [...currentMap.values()]
      .sort((a, b) => compareHashtagRank(a, b, scoreFieldForMode(mode)))
      .slice(0, TRENDING.TOP_TIER_SIZE)
      .map((h, i) => ({ rank: i + 1, tag: h.tag, usageCount: h.usageCount, score: h[scoreFieldForMode(mode)] }));
    exploreTop[mode] = exploreList;

    await db
      .collection(COLLECTIONS.HASHTAG_EXPLORE_SNAPSHOTS)
      .doc(`${newWeekCode}_${mode}`)
      .set({
        weekCode: newWeekCode,
        mode,
        top10: exploreTop[mode],
        capturedAt: FieldValue.serverTimestamp(),
      });
  }

  // Reset snapshot cho MỌI hashtag từng/đang xuất hiện — kể cả hashtag hiện
  // không còn bài nào dùng (current = 0, để lần rollover kế tiếp không tính
  // growth âm sai từ 1 mốc rất cũ).
  const BATCH_SIZE = 450;
  const keys = [...allKeys];
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = db.batch();
    keys.slice(i, i + BATCH_SIZE).forEach((key) => {
      const current = currentMap.get(key) || { tag: existingByKey.get(key)?.tag || key, postScoreSum: 0, externalScoreSum: 0 };
      batch.set(
        db.collection(COLLECTIONS.HASHTAGS).doc(key),
        {
          tag: current.tag,
          weeklySnapshotClassic: { weekCode: newWeekCode, scoreAtStart: current.postScoreSum || 0 },
          weeklySnapshotAdvanced: { weekCode: newWeekCode, scoreAtStart: current.externalScoreSum || 0 },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
    await batch.commit();
  }

  // Snapshot vừa ghi lại toàn bộ -> cache cũ (nếu còn) chứa dữ liệu SAI.
  invalidateHashtagDocsCache();
}

/**
 * GET /api/trending/hashtags/weekly?mode=classic|advanced
 * Top 100 Hashtag tăng TRƯỞNG NHIỀU NHẤT (postScore hoặc externalPostScore)
 * trong tuần hiện tại (đang diễn ra).
 */
async function getHashtagWeeklyRanking(req, res) {
  try {
    const mode = req.query.mode === SCORE_MODE.ADVANCED ? SCORE_MODE.ADVANCED : SCORE_MODE.CLASSIC;
    const weekInfo = getWeekInfo();
    await ensureHashtagWeekRollover(weekInfo.code);

    const items = await getCachedScan();
    const currentMap = aggregateHashtags(items);
    const field = scoreFieldForMode(mode);
    const snapField = mode === SCORE_MODE.ADVANCED ? "weeklySnapshotAdvanced" : "weeklySnapshotClassic";

    const keys = [...currentMap.keys()];
    const hashtagDocs = await getCachedHashtagDocsMap();

    const staleFixes = [];
    const ranked = keys.map((key) => {
      const current = currentMap.get(key);
      const snapshot = hashtagDocs.get(key)?.[snapField];
      let startScore;
      if (snapshot && snapshot.weekCode === weekInfo.code) {
        startScore = snapshot.scoreAtStart || 0;
      } else {
        // Hashtag mới xuất hiện giữa tuần / chưa có doc -> mốc khởi đầu = giá
        // trị hiện tại (growth = 0 cho tới khi điểm đổi tiếp), tự sửa lại.
        startScore = current[field] || 0;
        staleFixes.push({ key, tag: current.tag, scoreAtStart: startScore });
      }
      return { tag: current.tag, usageCount: current.usageCount, lastUsedAtMs: current.lastUsedAtMs, growth: (current[field] || 0) - startScore };
    });

    if (staleFixes.length) {
      const snapKeyField = snapField;
      const fix = async () => {
        const BATCH_SIZE = 450;
        for (let i = 0; i < staleFixes.length; i += BATCH_SIZE) {
          const batch = db.batch();
          staleFixes.slice(i, i + BATCH_SIZE).forEach((f) => {
            batch.set(
              db.collection(COLLECTIONS.HASHTAGS).doc(f.key),
              { tag: f.tag, [snapKeyField]: { weekCode: weekInfo.code, scoreAtStart: f.scoreAtStart }, updatedAt: FieldValue.serverTimestamp() },
              { merge: true }
            );
          });
          await batch.commit();
        }
        invalidateHashtagDocsCache();
      };
      fix().catch((err) => console.error("getHashtagWeeklyRanking: lỗi tự sửa snapshot:", err.message));
    }

    ranked.sort((a, b) => compareHashtagRank(a, b, "growth"));
    const ranking = ranked.slice(0, TRENDING.RANKING_LIMIT).map((h, i) => ({ rank: i + 1, ...h }));

    return res.json({ weekCode: weekInfo.code, weekInfo, mode, ranking });
  } catch (err) {
    console.error("getHashtagWeeklyRanking error:", err);
    return res.status(500).json({ error: "Không tải được bảng xếp hạng Hashtag theo tuần." });
  }
}

/**
 * GET /api/trending/hashtags/alltime?mode=classic|advanced
 * Top 100 Hashtag có lượng sử dụng + điểm cao nhất, phạm vi toàn thời gian.
 */
async function getHashtagAllTimeRanking(req, res) {
  try {
    const mode = req.query.mode === SCORE_MODE.ADVANCED ? SCORE_MODE.ADVANCED : SCORE_MODE.CLASSIC;
    const items = await getCachedScan();
    const currentMap = aggregateHashtags(items);
    const field = scoreFieldForMode(mode);

    const ranking = [...currentMap.values()]
      .sort((a, b) => compareHashtagRank(a, b, field))
      .slice(0, TRENDING.RANKING_LIMIT)
      .map((h, i) => ({ rank: i + 1, tag: h.tag, usageCount: h.usageCount, score: h[field] || 0 }));

    return res.json({ mode, ranking });
  } catch (err) {
    console.error("getHashtagAllTimeRanking error:", err);
    return res.status(500).json({ error: "Không tải được bảng xếp hạng Hashtag toàn thời gian." });
  }
}

/**
 * GET /api/trending/hashtags/:tag/posts?mode=classic|advanced
 * Top 100 bài viết/blog của 1 Hashtag, xếp theo (postScore hoặc externalPostScore).
 * Dùng chung format card như trang INDEX/BLOG (formatCardPost) — xem
 * posts.controller.js#formatCardPost.
 */
async function getHashtagPosts(req, res) {
  try {
    const key = normalizeHashtagKey(req.params.tag);
    if (!key) return res.status(400).json({ error: "Hashtag không hợp lệ." });
    const mode = req.query.mode === SCORE_MODE.ADVANCED ? SCORE_MODE.ADVANCED : SCORE_MODE.CLASSIC;

    const items = await getCachedScan();
    const matched = items.filter(
      (it) => Array.isArray(it.hashtags) && it.hashtags.some((t) => normalizeHashtagKey(t) === key)
    );

    const scored = matched.map((it) => ({
      ...it,
      postScore: computePostScore(it),
      externalPostScore: it.externalPostScore || 0,
    }));
    scored.sort((a, b) => {
      const scoreA = mode === SCORE_MODE.ADVANCED ? a.externalPostScore : a.postScore;
      const scoreB = mode === SCORE_MODE.ADVANCED ? b.externalPostScore : b.postScore;
      return scoreB - scoreA;
    });

    const top = scored.slice(0, TRENDING.HASHTAG_POST_LIMIT);
    const displayTag = top[0]?.hashtags?.find((t) => normalizeHashtagKey(t) === key) || `#${req.params.tag}`;

    const posts = await formatContentCards(top, req.authUid);
    return res.json({ tag: displayTag, mode, posts });
  } catch (err) {
    console.error("getHashtagPosts error:", err);
    return res.status(500).json({ error: "Không tải được danh sách bài viết theo Hashtag." });
  }
}

/**
 * GET /api/trending/search?q=&type=hashtag|post&sort=newest|trending&mode=classic|advanced
 * Tìm kiếm Hashtag hoặc bài viết (tiêu đề/nội dung tóm tắt/tác giả/hashtag).
 * ==== LƯU Ý HIỆU NĂNG ====
 * Firestore không hỗ trợ full-text search — cùng triết lý "quét + lọc bằng
 * JS ở quy mô nhỏ" đã dùng xuyên suốt file này, KHÔNG dùng dịch vụ tìm kiếm
 * ngoài (Algolia...). Nếu lượng bài viết tăng lớn, nên thay bằng 1 dịch vụ
 * search chuyên dụng.
 */
async function searchTrending(req, res) {
  try {
    const qRaw = (req.query.q || "").toString().trim();
    if (!qRaw) return res.json({ query: "", type: req.query.type || "post", hashtags: [], posts: [] });
    const q = qRaw.toLowerCase().replace(/^#/, "");
    const type = req.query.type === "hashtag" ? "hashtag" : "post";
    const sort = req.query.sort === "trending" ? "trending" : "newest";
    const mode = req.query.mode === SCORE_MODE.ADVANCED ? SCORE_MODE.ADVANCED : SCORE_MODE.CLASSIC;

    const items = await getCachedScan();

    if (type === "hashtag") {
      const currentMap = aggregateHashtags(items);
      const field = scoreFieldForMode(mode);
      let results = [...currentMap.values()].filter((h) => h.key.includes(q));
      results.sort((a, b) => (sort === "trending" ? compareHashtagRank(a, b, field) : b.lastUsedAtMs - a.lastUsedAtMs));
      results = results.slice(0, TRENDING.SEARCH_RESULT_LIMIT).map((h) => ({
        tag: h.tag,
        usageCount: h.usageCount,
        score: h[field] || 0,
      }));
      return res.json({ query: qRaw, type, sort, mode, hashtags: results, posts: [] });
    }

    // type === "post": lọc theo tiêu đề/tóm tắt/hashtag trước (không cần tác
    // giả), rồi mới attachAuthors + lọc thêm theo tên tác giả (tránh phải
    // gọi attachAuthors cho TOÀN BỘ posts/blogs khi không cần).
    const byContent = items.filter((it) => {
      const haystack = `${it.title || ""} ${it.excerpt || ""} ${(it.hashtags || []).join(" ")}`.toLowerCase();
      return haystack.includes(q);
    });
    const withAuthors = await attachAuthors(byContent);
    const matched = withAuthors.filter((it) => {
      if (byContentAlreadyMatched(it, q)) return true;
      return (it.author?.displayName || "").toLowerCase().includes(q);
    });

    matched.sort((a, b) => {
      if (sort === "trending") {
        const scoreA = mode === SCORE_MODE.ADVANCED ? a.externalPostScore || 0 : computePostScore(a);
        const scoreB = mode === SCORE_MODE.ADVANCED ? b.externalPostScore || 0 : computePostScore(b);
        return scoreB - scoreA;
      }
      return toMillis(b.createdAt) - toMillis(a.createdAt);
    });

    const top = matched.slice(0, TRENDING.SEARCH_RESULT_LIMIT);
    const posts = await formatContentCards(top, req.authUid, /* alreadyHasAuthor */ true);

    return res.json({ query: qRaw, type, sort, mode, hashtags: [], posts });
  } catch (err) {
    console.error("searchTrending error:", err);
    return res.status(500).json({ error: "Tìm kiếm thất bại." });
  }
}

function byContentAlreadyMatched(it, q) {
  const haystack = `${it.title || ""} ${it.excerpt || ""} ${(it.hashtags || []).join(" ")}`.toLowerCase();
  return haystack.includes(q);
}

/**
 * Chuẩn hoá 1 danh sách post/blog thô (từ scanContentDocs) thành format card
 * giống hệt trang INDEX/BLOG: gắn author, myReaction (nếu đăng nhập), tính
 * lại postScore. `detailPath` để frontend biết điều hướng "/post/:id" hay
 * "/blog/:id".
 */
async function formatContentCards(rawItems, authUid, alreadyHasAuthor = false) {
  if (!rawItems.length) return [];
  const items = alreadyHasAuthor ? rawItems : await attachAuthors(rawItems);

  let myReactionByKey = {};
  if (authUid) {
    const refs = items.map((it) =>
      db
        .collection(it.type === "blog" ? COLLECTIONS.BLOGS : COLLECTIONS.POSTS)
        .doc(it.docId)
        .collection(SUBCOLLECTIONS.REACTIONS)
        .doc(authUid)
    );
    const snaps = await getAllDocsChunked(refs);
    snaps.forEach((s, i) => {
      if (s.exists) myReactionByKey[`${items[i].type}:${items[i].docId}`] = s.data().type;
    });
  }

  return items.map((it) => ({
    id: it.docId,
    type: it.type,
    detailPath: it.type === "blog" ? "/blog" : "/post",
    author: it.author,
    title: it.title,
    excerpt: it.excerpt || "",
    coverImageUrl: it.coverImageUrl || null,
    hashtags: it.hashtags || [],
    likeCount: it.likeCount || 0,
    dislikeCount: it.dislikeCount || 0,
    commentCount: it.commentCount || 0,
    viewCount: it.viewCount || 0,
    aiViewCount: it.aiViewCount || 0,
    shareCount: it.shareCount || 0,
    postScore: computePostScore(it),
    externalPostScore: it.externalPostScore || 0,
    createdAt: toIsoStringLocal(it.createdAt),
    myReaction: myReactionByKey[`${it.type}:${it.docId}`] || null,
  }));
}

function toIsoStringLocal(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch (_) {
      /* fall through */
    }
  }
  const ms = toMillis(value);
  return ms ? new Date(ms).toISOString() : null;
}

module.exports = {
  getWeeklyRanking,
  getAllTimeRanking,
  getHashtagWeeklyRanking,
  getHashtagAllTimeRanking,
  getHashtagPosts,
  searchTrending,
};
