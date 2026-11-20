// ==== Nhóm & vai trò tài khoản ====
const ACCOUNT_GROUP = {
  SA: "SA", // Senior Account: quyền hạn cao
  RA: "RA", // Regular Account: người dùng sở hữu tài khoản
  LLA: "LLA", // Low Level Account: tài khoản thử nghiệm, không có quyền sở hữu
};

const ACCOUNT_ROLE = {
  // SA
  ADMIN: "admin",
  DEV: "dev",
  MODERATOR: "moderator",
  // RA
  PRO_USER: "pro_user",
  USER: "user",
  // LLA
  TEST: "test",
};

// Vai trò nào thuộc nhóm nào (dùng để suy ra accountGroup từ accountRole khi cần)
const ROLE_TO_GROUP = {
  [ACCOUNT_ROLE.ADMIN]: ACCOUNT_GROUP.SA,
  [ACCOUNT_ROLE.DEV]: ACCOUNT_GROUP.SA,
  [ACCOUNT_ROLE.MODERATOR]: ACCOUNT_GROUP.SA,
  [ACCOUNT_ROLE.PRO_USER]: ACCOUNT_GROUP.RA,
  [ACCOUNT_ROLE.USER]: ACCOUNT_GROUP.RA,
  [ACCOUNT_ROLE.TEST]: ACCOUNT_GROUP.LLA,
};

const ACCOUNT_STATUS = {
  PENDING: "pending", // Chưa kích hoạt
  ACTIVE: "active",
  SUSPENDED: "suspended", // Dùng cho LLA có thể bị tước quyền bất cứ lúc nào
};

const REACTION_TYPE = {
  LIKE: "like",
  DISLIKE: "dislike",
};

// ==== v0.9.6 [MEDIUM] — Giới hạn độ dài nội dung do người dùng nhập ====
// Trước đây `title` (bài viết/blog) chỉ được kiểm tra "có tồn tại", không có
// độ dài tối đa/tối thiểu — tiêu đề dài bất thường có thể gây vấn đề hiển
// thị, phình document Firestore, và ảnh hưởng SEO/OG tags. `editComment`
// cũng thiếu giới hạn độ dài (trong khi `addComment` đã có sẵn 2000 ký tự),
// cho phép lách giới hạn ban đầu bằng cách tạo comment ngắn rồi sửa dài ra.
// Xem CHANGELOG-v0.9.6.md.
const CONTENT_LIMITS = {
  TITLE_MIN: 5,
  TITLE_MAX: 200,
  COMMENT_MAX: 2000,
  COVER_IMAGE_URL_MAX: 2000,
  // v0.9.7 — hashtag bài viết/blog
  HASHTAG_MAX_COUNT: 20,
  HASHTAG_MAX_LENGTH: 30, // số ký tự tối đa SAU dấu #
  // v0.10.17 — phân trang danh sách bình luận (xem comments.controller.js#listComments)
  COMMENTS_PAGE_SIZE: 20,
  COMMENTS_PAGE_SIZE_MAX: 50,
  // v1.1 [BẢO MẬT F1 — vá từ Twelve 2.0.10] — giới hạn đầu vào của `contentHtml` TRƯỚC khi sanitize (xem services/contentPipeline.js).
  // Số đo ghi trong báo cáo Twelve 2.0.10 (cùng sanitizer, chưa đo lại riêng trên 0.10.24): bài thật 118 KB ≈ 0,5 giây; thẻ lạ/`<table>` bị DOMPurify "gỡ vỏ" tốn thời gian siêu tuyến tính
  // (2.000 thẻ ≈ 1 giây, 6.000 phần tử bảng ≈ 3,6 giây); `<div>` lồng sâu tốn bậc hai.
  HTML_MAX_CHARS: 250000,
  HTML_MAX_ELEMENTS: 5000,
  HTML_MAX_DEPTH: 100,
  HTML_MAX_DISALLOWED: 300,
  HTML_MAX_MEDIA: 200, // img/video/audio/source/iframe — mỗi phần tử phải kiểm tra URL nên đắt hơn (5.000 ảnh ≈ 3,4 giây)
  SANITIZE_TIMEOUT_MS: 3000,
};

// ==== Tên collection Firestore ====
const COLLECTIONS = {
  USERS: "users",
  TAGNAMES: "tagNames", // dùng để đảm bảo Tag Name Search là duy nhất: doc id = tagName (không có @)
  POSTS: "posts",
  BLOGS: "blogs",
  COUNTRIES: "countries",
  CONFIG: "config", // doc "version" chứa { backend: "0.1.0" }
  ACTIVATIONS: "activations", // mã kích hoạt tài khoản, tách riêng khỏi users để dễ quản lý TTL
  // v0.10.0 — trang Xu hướng (Trending)
  WEEKLY_LEADERBOARDS: "weeklyLeaderboards", // doc id = mã tuần "N.K.MM.YYYY", lưu VĨNH VIỄN top 10 đã chốt của tuần đó
  // v0.10.8 — tab Hashtag của trang Xu hướng
  HASHTAGS: "hashtags", // doc id = hashtag đã chuẩn hoá (chữ thường, không có "#") — chỉ lưu mốc weeklySnapshot để tính tăng trưởng tuần, KHÔNG lưu tổng điểm hiện tại (luôn quét lại từ posts/blogs, xem trending.controller.js)
  HASHTAG_WEEKLY_LEADERBOARDS: "hashtagWeeklyLeaderboards", // doc id = "{mãTuầnCũ}_{classic|advanced}", lưu VĨNH VIỄN top 10 Hashtag tăng trưởng mạnh nhất tuần đã chốt
  HASHTAG_EXPLORE_SNAPSHOTS: "hashtagExploreSnapshots", // doc id = "{mãTuầnCũ}_{classic|advanced}", lưu top 10 Hashtag toàn thời gian (tab Khám phá) tại thời điểm chốt tuần — phục vụ thành tích/vinh danh sau này
};

// (ASSETS được thêm bên dưới, ngay sau object COLLECTIONS, để khỏi làm rối khối comment dài phía trên)
COLLECTIONS.ASSETS = "assets"; // v0.10.20 — sổ đăng ký MỌI file người dùng upload lên Cloudinary (doc id = publicId, "/" đổi thành "__"), xem services/assets.service.js

// Sub-collection names (đặt trong doc bài viết / blog)
const SUBCOLLECTIONS = {
  COMMENTS: "comments",
  REACTIONS: "reactions", // mỗi doc id = uid, field type: like/dislike
  SHARES: "shares", // mỗi doc = 1 lượt share được TÍNH (đã có người click link), field sharerUid có thể null
  VIEWS: "views", // mỗi doc id = viewerKey (uid/session/ip), chống đếm trùng view trong 1 khoảng thời gian (v0.8.3)
  POSITIVE_SCORE_LOGS: "positiveScoreLogs", // audit log: mỗi lần cộng/trừ positiveScore đều ghi 1 doc ở đây
};

// v0.10.0 — trang Xu hướng (Trending): giới hạn/tầng hiển thị bảng xếp hạng.
// "Đại sảnh" = top 1-3, "Top 4-10", "Top 11-100". RANKING_LIMIT là tổng số
// user tối đa trả về cho mỗi bảng xếp hạng (Tuần qua / Toàn thời gian).
const TRENDING = {
  RANKING_LIMIT: 100,
  HALL_OF_FAME_SIZE: 3,
  TOP_TIER_SIZE: 10,
  // v0.10.8 — tab Hashtag: số bài viết tối đa hiển thị khi click vào 1 Hashtag,
  // và số kết quả tối đa cho mỗi loại ở tab Tìm kiếm.
  HASHTAG_POST_LIMIT: 100,
  SEARCH_RESULT_LIMIT: 50,
};

// v0.10.8 — 2 "chế độ" xếp hạng dùng chung cho tab Hashtag (Cổ điển/Nâng cao)
// và tab Tìm kiếm (sắp xếp theo "thịnh hành"). CLASSIC dùng postScore (đã bao
// gồm cả tự tương tác), ADVANCED dùng externalPostScore (chỉ tính tương tác
// từ người khác — chống farm điểm, xem utils/helpers.js#computePostScore).
const SCORE_MODE = {
  CLASSIC: "classic",
  ADVANCED: "advanced",
};

// ==== v0.10.20 — Quản lý tài nguyên Cloudinary do người dùng upload ====
// Mọi thứ liên quan tới "được upload gì, bao lớn, để ở đâu" gom về đây để khi
// mở rộng upload (ảnh bài viết, video...) chỉ cần THÊM 1 mục vào ASSET_KIND +
// ASSET_LIMITS, không phải rải hằng số khắp nơi như trước.
const ASSET_ROOT_FOLDER = "twelve"; // mọi public_id do Twelve tạo đều bắt đầu bằng "twelve/"

const ASSET_KIND = {
  AVATAR: "avatar", // 1 ảnh/user, GHI ĐÈ khi đổi (public_id cố định theo uid)
};

const ASSET_LIMITS = {
  [ASSET_KIND.AVATAR]: {
    // Frontend luôn cắt 512x512 JPEG (~100-300KB, xem AvatarCropper.jsx) nên 2MB
    // đã là dư nhiều; trước v0.10.20 là 10MB (chỉ để chừa chỗ cho ảnh gốc, nhưng
    // ảnh gốc không bao giờ được gửi lên server).
    MAX_BYTES: 2 * 1024 * 1024,
    // Chỉ định dạng ảnh tĩnh phổ biến. Bỏ GIF (ảnh động phình dung lượng) và AVIF.
    ALLOWED_MIMES: ["image/jpeg", "image/png", "image/webp"],
    // Số asset tối đa 1 user được giữ cho loại này (cơ sở để mở rộng quota sau này).
    MAX_PER_USER: 1,
  },
};

module.exports = {
  ACCOUNT_GROUP,
  ACCOUNT_ROLE,
  ROLE_TO_GROUP,
  ACCOUNT_STATUS,
  REACTION_TYPE,
  COLLECTIONS,
  SUBCOLLECTIONS,
  CONTENT_LIMITS,
  TRENDING,
  SCORE_MODE,
  ASSET_ROOT_FOLDER,
  ASSET_KIND,
  ASSET_LIMITS,
};
