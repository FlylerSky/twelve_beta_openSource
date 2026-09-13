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

// ==== Tên collection Firestore ====
const COLLECTIONS = {
  USERS: "users",
  TAGNAMES: "tagNames", // dùng để đảm bảo Tag Name Search là duy nhất: doc id = tagName (không có @)
  POSTS: "posts",
  BLOGS: "blogs",
  COUNTRIES: "countries",
  CONFIG: "config", // doc "version" chứa { backend: "0.1.0" }
  ACTIVATIONS: "activations", // mã kích hoạt tài khoản, tách riêng khỏi users để dễ quản lý TTL
};

// Sub-collection names (đặt trong doc bài viết / blog)
const SUBCOLLECTIONS = {
  COMMENTS: "comments",
  REACTIONS: "reactions", // mỗi doc id = uid, field type: like/dislike
  SHARES: "shares", // mỗi doc = 1 lượt share được TÍNH (đã có người click link), field sharerUid có thể null
  VIEWS: "views", // mỗi doc id = viewerKey (uid/session/ip), chống đếm trùng view trong 1 khoảng thời gian (v0.8.3)
};

module.exports = {
  ACCOUNT_GROUP,
  ACCOUNT_ROLE,
  ROLE_TO_GROUP,
  ACCOUNT_STATUS,
  REACTION_TYPE,
  COLLECTIONS,
  SUBCOLLECTIONS,
};
