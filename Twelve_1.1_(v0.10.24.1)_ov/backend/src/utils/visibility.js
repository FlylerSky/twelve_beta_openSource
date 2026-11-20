const { COLLECTIONS, ACCOUNT_STATUS } = require("./constants");

/**
 * ==== v2.0.4 [BẢO MẬT] — Blog NHÁP (isPublished !== true) không được lộ ra công khai ====
 *
 * Trước đây `getBlog` (API), `/blog/:id` (SSR), Firestore rules, và các endpoint
 * react/comment/share đều không kiểm tra `isPublished`, nên ai biết id là đọc được
 * bản nháp (SSR còn gắn `index, follow`). Mọi nơi đọc blog theo id đi qua các hàm này.
 */

/** Tài liệu này là blog chưa xuất bản? (bài `posts` luôn công khai) */
function isHiddenDraft(collectionName, data) {
  return collectionName === COLLECTIONS.BLOGS && !!data && data.isPublished !== true;
}

/** Người xem (req.authUser do optionalAuth/requireAuth gán) có quyền xem bản nháp không? */
function canViewDraft(req, data) {
  const user = req && req.authUser;
  if (!user || !req.authUid) return false;
  if (user.status !== ACCOUNT_STATUS.ACTIVE) return false;
  return user.accountGroup === "SA" || (!!data && data.authorUid === req.authUid);
}

module.exports = { isHiddenDraft, canViewDraft };
