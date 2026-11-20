/**
 * ==== ĐIỂM BÀI VIẾT (v0.8.0) ====
 * Mirror chính xác công thức ở backend (`backend/src/utils/helpers.js#computePostScore`):
 *   1 view = +1, 1 like = +2, 1 dislike = -2, 1 comment = +3, 1 share = +4.
 *
 * Chỉ dùng để TÍNH LẠI điểm ngay trên UI cho mượt (optimistic update) mỗi khi
 * người dùng like/dislike/bình luận/share — y hệt cách likeCount/dislikeCount
 * đã được cập nhật lạc quan từ trước. Giá trị THẬT SỰ luôn lấy từ server
 * (`post.postScore` trong response API) ở lần tải lại tiếp theo — không có gì
 * lưu trên client, nên không thể "lệch pha" lâu dài với server.
 */
export const POST_SCORE_WEIGHTS = Object.freeze({
  view: 1,
  like: 2,
  dislike: -2,
  comment: 3,
  share: 4,
});

export function computePostScore({
  viewCount = 0,
  likeCount = 0,
  dislikeCount = 0,
  commentCount = 0,
  shareCount = 0,
} = {}) {
  return (
    (viewCount || 0) * POST_SCORE_WEIGHTS.view +
    (likeCount || 0) * POST_SCORE_WEIGHTS.like +
    (dislikeCount || 0) * POST_SCORE_WEIGHTS.dislike +
    (commentCount || 0) * POST_SCORE_WEIGHTS.comment +
    (shareCount || 0) * POST_SCORE_WEIGHTS.share
  );
}
