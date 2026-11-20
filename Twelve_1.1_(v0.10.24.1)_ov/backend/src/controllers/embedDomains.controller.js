const { db, admin } = require("../config/firebase");
const { COLLECTIONS } = require("../utils/constants");
const {
  setEmbedDomainsConfig,
  getEmbedDomainsConfig,
  DEFAULT_EMBED_DOMAINS,
} = require("../services/sanitize.service");
const { processContentHtml } = require("../services/contentPipeline");

const FieldValue = admin.firestore.FieldValue;
const CONFIG_DOC_ID = "embedDomains";

/**
 * ==== v0.10.15 — tab "Quản trị" (Settings, chỉ SA) — quản lý domain nhúng
 * media của bài viết/blog ====
 *
 * Doc Firestore `config/embedDomains`:
 *   { enabled: boolean, domains: [{ domain, path, label }], updatedAt, updatedByUid }
 *
 * `enabled: false` = chặn TOÀN BỘ media có domain-allowlist — không có
 * ngoại lệ, bất kể `domains` còn gì.
 *
 * ==== v0.10.16 — thêm `path` (tuỳ chọn) cho mỗi domain, áp dụng cho TẤT CẢ
 * media (không riêng iframe nữa — xem docblock "VÁ v0.10.16" trong
 * sanitize.service.js) ====
 * SA có thể nhập "domain/path" (vd. "res.cloudinary.com/dk7xohrrk") để CHỈ
 * cho phép đúng 1 thư mục/cloud cụ thể dưới domain đó — không phải toàn bộ
 * domain. `path` rỗng (chỉ nhập domain thuần) = không giới hạn, hành vi y
 * hệt trước bản vá.
 */

const MAX_DOMAINS = 50;
const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/; // ví dụ hợp lệ: "youtube.com", "player.vimeo.com" — không cho phép scheme/khoảng trắng
const MAX_PATH_LEN = 200;
// Mỗi SEGMENT của path chỉ chấp nhận ký tự an toàn thường gặp trong URL
// (không "?", "#", "*", khoảng trắng, hay ký tự đặc biệt khác) — path phân
// biệt hoa/thường (khác domain), giữ NGUYÊN chữ hoa/thường SA nhập.
const PATH_SEGMENT_RE = /^[a-zA-Z0-9._~%-]+$/;

// ==== VÁ v0.10.18 [LOW — báo cáo bảo mật L-7] chặn "suffix công cộng" ====
// `hostnameMatchesDomain()` chấp nhận MỌI subdomain của 1 domain trong danh
// sách. Nếu SA lỡ thêm 1 suffix dùng chung (`github.io`, `vercel.app`,
// `com.vn`...) thì MỌI người dùng của dịch vụ đó (mỗi người 1 subdomain
// riêng) đều trở thành nguồn được tin cậy — kể cả kẻ tấn công tự đăng ký 1
// subdomain. Path-scoping KHÔNG cứu được trường hợp này (path áp cho mọi
// subdomain). Từ chối luôn ở bước lưu; SA phải nhập subdomain cụ thể
// (vd. `ten-ban.github.io`). Danh sách dưới đây là các dịch vụ hosting
// nhiều-người-dùng phổ biến (không thể đầy đủ tuyệt đối) + heuristic ccSLD.
const PUBLIC_SUFFIXES = new Set([
  "github.io", "githubusercontent.com", "gitlab.io", "bitbucket.io",
  "vercel.app", "now.sh", "netlify.app", "pages.dev", "workers.dev",
  "web.app", "firebaseapp.com", "appspot.com", "herokuapp.com", "onrender.com",
  "fly.dev", "railway.app", "glitch.me", "repl.co", "replit.app", "replit.dev",
  "blogspot.com", "wordpress.com", "wixsite.com", "weebly.com", "webflow.io",
  "notion.site", "carrd.co", "neocities.org", "itch.io", "surge.sh",
  "azurewebsites.net", "azurestaticapps.net", "cloudfront.net", "amazonaws.com",
  "s3.amazonaws.com", "ngrok.io", "ngrok-free.app", "trycloudflare.com",
  "duckdns.org", "no-ip.org", "ddns.net", "000webhostapp.com", "supabase.co",
]);
const GENERIC_SLD_LABELS = new Set([
  "co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go", "gr", "ltd", "plc", "sch", "mil", "info",
]);

function isPublicSuffix(domain) {
  if (PUBLIC_SUFFIXES.has(domain)) return true;
  const labels = domain.split(".");
  // ccSLD kiểu "com.vn", "co.uk", "com.au", "co.jp", "ne.jp"...
  return labels.length === 2 && GENERIC_SLD_LABELS.has(labels[0]) && labels[1].length === 2;
}

function splitDomainAndPath(withoutScheme) {
  const slashIdx = withoutScheme.indexOf("/");
  if (slashIdx === -1) return { domainPart: withoutScheme, pathPart: "" };
  return { domainPart: withoutScheme.slice(0, slashIdx), pathPart: withoutScheme.slice(slashIdx + 1) };
}

function normalizeDomainsInput(rawDomains) {
  if (!Array.isArray(rawDomains)) return { error: "Danh sách domain phải là 1 mảng." };
  if (rawDomains.length > MAX_DOMAINS) return { error: `Tối đa ${MAX_DOMAINS} domain.` };

  const seen = new Set();
  const domains = [];
  for (const raw of rawDomains) {
    const inputRaw = typeof raw === "string" ? raw : raw && raw.domain;
    if (typeof inputRaw !== "string") return { error: "Mỗi domain phải là chuỗi ký tự." };

    // Tách domain/path TRÊN CHUỖI GỐC (chưa lowercase) — path cần giữ đúng
    // chữ hoa/thường, chỉ domain mới hạ về chữ thường.
    const withoutScheme = inputRaw.trim().replace(/^https?:\/\//i, "");
    const { domainPart, pathPart } = splitDomainAndPath(withoutScheme);
    const domain = domainPart.toLowerCase();

    if (!DOMAIN_RE.test(domain)) {
      return {
        error: `Domain không hợp lệ: "${inputRaw}". Chỉ nhập tên miền thuần, có thể kèm đường dẫn (vd. "youtube.com" hoặc "res.cloudinary.com/ten-cloud"), không kèm "https://".`,
      };
    }

    // Chuẩn hoá path: bỏ "/" đầu/cuối thừa, gộp "//" liên tiếp, loại segment rỗng.
    const pathSegments = pathPart.split("/").map((s) => s.trim()).filter(Boolean);
    const path = pathSegments.join("/");
    if (path) {
      if (path.length > MAX_PATH_LEN) {
        return { error: `Đường dẫn quá dài ở "${inputRaw}" (tối đa ${MAX_PATH_LEN} ký tự).` };
      }
      if (!pathSegments.every((seg) => PATH_SEGMENT_RE.test(seg))) {
        return {
          error: `Đường dẫn không hợp lệ ở "${inputRaw}" — mỗi phần chỉ chấp nhận chữ/số và . _ ~ % -, không khoảng trắng hay ký tự đặc biệt khác.`,
        };
      }
    }

    if (isPublicSuffix(domain)) {
      return {
        error: `"${domain}" là tên miền DÙNG CHUNG (mỗi người dùng có 1 subdomain riêng) — cho phép nó nghĩa là tin cậy mọi người dùng của dịch vụ đó. Hãy nhập subdomain cụ thể (vd. "ten-ban.${domain}").`,
      };
    }

    const key = `${domain}/${path}`;
    if (seen.has(key)) continue; // bỏ qua trùng lặp thay vì báo lỗi — thân thiện hơn
    seen.add(key);
    const labelRaw = typeof raw === "object" && raw && typeof raw.label === "string" ? raw.label.trim() : "";
    const defaultLabel = path ? `${domain}/${path}` : domain;
    domains.push({ domain, path, label: labelRaw ? labelRaw.slice(0, 60) : defaultLabel });
  }
  return { domains };
}

/**
 * GET /api/admin/embed-domains (chỉ SA)
 * Trả về cấu hình đang lưu ở Firestore — KHÔNG đọc từ state trong bộ nhớ
 * (`getEmbedDomainsConfig()`) vì state đó chỉ có domain thô (không có
 * `label`, đã rút gọn để sanitize dùng) — Firestore mới là nguồn đầy đủ cho
 * UI hiển thị.
 */
async function getEmbedDomainsSettings(req, res) {
  try {
    const snap = await db.collection(COLLECTIONS.CONFIG).doc(CONFIG_DOC_ID).get();
    if (!snap.exists) {
      // Chưa từng được ghi (lý thuyết không xảy ra vì server.js đã seed lúc
      // khởi động — phòng hờ trường hợp gọi API trước khi job seed kịp chạy).
      return res.json({ enabled: true, domains: DEFAULT_EMBED_DOMAINS });
    }
    const data = snap.data();
    return res.json({ enabled: data.enabled !== false, domains: Array.isArray(data.domains) ? data.domains : [] });
  } catch (err) {
    console.error("getEmbedDomainsSettings error:", err);
    return res.status(500).json({ error: "Không tải được cấu hình domain nhúng." });
  }
}

/**
 * PUT /api/admin/embed-domains (chỉ SA)
 * Body: { enabled: boolean, domains: [{ domain, label? }] }
 *
 * Sau khi ghi, LUÔN:
 *   1. Gọi `setEmbedDomainsConfig()` để áp dụng NGAY cho các request kế tiếp
 *      (không cần khởi động lại server).
 *   2. Quét lại TOÀN BỘ posts + blogs, sanitize lại `contentHtml` bằng cấu
 *      hình MỚI — loại bỏ mọi iframe từ domain không còn trong danh sách
 *      (hoặc mọi iframe nếu `enabled: false`). Đây chính là yêu cầu "quét
 *      sạch bài viết đang có một cách an toàn": chỉ GHI LẠI những doc thực
 *      sự thay đổi (so sánh HTML trước/sau), không đụng vào doc không liên
 *      quan; chạy theo lô (batch) để không vượt giới hạn ghi Firestore.
 */
async function updateEmbedDomainsSettings(req, res) {
  try {
    const enabled = req.body.enabled !== false; // mặc định true nếu thiếu/không hợp lệ, chỉ false khi CHỦ ĐỘNG gửi false
    const { domains, error } = normalizeDomainsInput(req.body.domains);
    if (error) return res.status(400).json({ error });

    const configRef = db.collection(COLLECTIONS.CONFIG).doc(CONFIG_DOC_ID);
    await configRef.set(
      { enabled, domains, updatedAt: FieldValue.serverTimestamp(), updatedByUid: req.authUid },
      { merge: false } // ghi đè toàn bộ — đây là cấu hình "trạng thái hiện tại", không phải log cộng dồn
    );

    // Áp dụng ngay cho các request /api/posts, /api/blogs... kế tiếp.
    setEmbedDomainsConfig({ enabled, domains: domains.map((d) => ({ domain: d.domain, path: d.path })) });

    // v0.10.18 (L-6): cấu hình ĐÃ được lưu + áp dụng ở trên — nếu bước quét
    // lại bài cũ lỗi (vd. Firestore tạm lỗi), KHÔNG trả 500 (gây hiểu nhầm là
    // chưa lưu được) mà trả kết quả kèm `error` để giao diện báo SA lưu lại.
    let rescan;
    try {
      rescan = await rescanContentForEmbedDomains();
    } catch (rescanErr) {
      console.error("rescanContentForEmbedDomains error:", rescanErr);
      rescan = { scanned: 0, modified: 0, skipped: 0, failed: 0, error: true };
    }

    return res.json({ enabled, domains, rescan });
  } catch (err) {
    console.error("updateEmbedDomainsSettings error:", err);
    return res.status(500).json({ error: "Không lưu được cấu hình domain nhúng." });
  }
}

/**
 * Quét lại TOÀN BỘ posts + blogs (kể cả blog nháp — nội dung của nó vẫn có
 * thể chứa media không còn hợp lệ, và sẽ được publish sau này), sanitize
 * lại `contentHtml` bằng cấu hình domain HIỆN TẠI (đã được
 * `setEmbedDomainsConfig()` áp dụng ngay trước khi hàm này được gọi), CHỈ
 * ghi lại những doc có nội dung thực sự thay đổi.
 *
 * v0.10.16: `sanitizeHtml()` giờ domain-gate CẢ iframe LẪN img/video/audio/
 * source trực tiếp (xem sanitize.service.js) — nên lần quét này giờ dọn
 * sạch MỌI loại nhúng từ 1 domain SA vừa gỡ/thu hẹp path, không riêng
 * iframe như trước v0.10.16 nữa.
 *
 * ==== LƯU Ý HIỆU NĂNG ====
 * Đọc TOÀN BỘ contentHtml của mọi post/blog (không dùng `.select()` giảm
 * tải như các chỗ khác trong code — ở đây bắt buộc cần full nội dung để
 * sanitize lại) — cùng triết lý "chấp nhận quét toàn bộ ở quy mô nhỏ" đã
 * dùng cho trending.controller.js. Thao tác này CHỈ chạy khi SA chủ động
 * lưu thay đổi domain (hiếm, không phải trên đường request thông thường của
 * người dùng) nên chấp nhận được dù có thể mất vài giây ở dữ liệu lớn.
 */
async function rescanContentForEmbedDomains() {
  const [postsSnap, blogsSnap] = await Promise.all([
    db.collection(COLLECTIONS.POSTS).get(),
    db.collection(COLLECTIONS.BLOGS).get(),
  ]);

  // Bước 1 (chỉ ĐỌC, không ghi): lọc ra các doc CÓ VẺ cần sửa. Đây mới chỉ là
  // ứng viên — dữ liệu đọc ở đây có thể đã cũ khi tới lúc ghi (xem bước 2).
  //
  // v1.1 [BẢO MẬT F1/F10 — vá từ 2.0.10]: trước đây `sanitizeHtml` (JSDOM + DOMPurify) chạy ĐỒNG BỘ trên event loop cho MỌI bài (2 lần/bài) — một bài cũ chứa payload bệnh lý
  // (hoặc chỉ là dữ liệu lớn) làm treo cả server trong lúc SA bấm lưu. Nay mỗi bài đi qua `processContentHtml` (worker có timeout, xem services/contentPipeline.js)
  // và nằm trong try/catch: tài liệu lỗi chỉ bị tính vào `failed`, không huỷ cả đợt quét. Việc sanitize làm NGOÀI transaction (transaction có thể bị chạy lại).
  let scanned = 0;
  let failed = 0;
  const candidates = [];
  for (const snap of [postsSnap, blogsSnap]) {
    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data();
      if (!data.contentHtml) continue;
      try {
        const { html: clean, excerpt } = await processContentHtml(data.contentHtml);
        if (clean !== data.contentHtml) candidates.push({ ref: doc.ref, original: data.contentHtml, clean, excerpt });
      } catch (err) {
        failed++;
        console.error(`rescanContentForEmbedDomains: lỗi khi làm sạch ${doc.ref.path}:`, err.message);
      }
    }
  }

  // ==== VÁ v0.10.18 [LOW — báo cáo bảo mật L-6] ====
  // Trước đây: ghi hàng loạt bằng `batch` từ dữ liệu ĐÃ ĐỌC từ trước ->
  //  (a) nếu người dùng sửa bài đúng lúc đang quét, `contentHtml` mới của họ
  //      bị GHI ĐÈ bằng bản cũ đã sanitize;
  //  (b) nếu 1 bài vừa bị xoá, `batch.update` lỗi làm HỎNG CẢ LÔ (tới 450
  //      bài) — trong khi cấu hình domain đã lưu rồi mà API vẫn trả 500.
  // Giờ mỗi bài được xử lý trong 1 TRANSACTION RIÊNG: đọc lại bản MỚI NHẤT,
  // sanitize chính bản đó, chỉ ghi nếu vẫn cần (Firestore tự thử lại nếu có
  // ghi đồng thời) -> không ghi đè được chỉnh sửa của người dùng. Lỗi của
  // 1 bài không ảnh hưởng bài khác, được đếm vào `failed` để SA biết mà lưu
  // lại lần nữa. Chạy song song theo nhóm nhỏ để không quá chậm.
  let modified = 0;
  let skipped = 0; // đã bị xoá / đã được sửa sạch bởi chính người dùng trong lúc quét
  const CONCURRENCY = 10;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    await Promise.all(
      candidates.slice(i, i + CONCURRENCY).map(async ({ ref, original, clean, excerpt }) => {
        try {
          const outcome = await db.runTransaction(async (tx) => {
            const fresh = await tx.get(ref);
            if (!fresh.exists) return "skipped";
            // Nội dung đã bị sửa trong lúc quét => bỏ qua: đường sửa bài đã sanitize bằng cấu hình HIỆN TẠI (VÁ v0.10.18 L-6).
            if (fresh.data().contentHtml !== original) return "skipped";
            tx.update(ref, { contentHtml: clean, excerpt });
            return "modified";
          });
          if (outcome === "modified") modified++;
          else skipped++;
        } catch (err) {
          failed++;
          console.error(`rescanContentForEmbedDomains: lỗi khi xử lý ${ref.path}:`, err.message);
        }
      })
    );
  }

  return { scanned, modified, skipped, failed };
}

module.exports = { getEmbedDomainsSettings, updateEmbedDomainsSettings };
