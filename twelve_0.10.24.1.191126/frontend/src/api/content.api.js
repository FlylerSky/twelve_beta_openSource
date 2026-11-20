import apiClient from "./client";

// Factory dùng chung cho cả "posts" và "blogs" vì 2 module có API gần như giống hệt nhau
function makeContentApi(basePath) {
  return {
    list: (cursor, limit = 10) =>
      apiClient.get(basePath, { params: { cursor, limit } }).then((r) => r.data),

    getOne: (id, params) => apiClient.get(`${basePath}/${id}`, { params }).then((r) => r.data),

    create: (data) => apiClient.post(basePath, data).then((r) => r.data),

    update: (id, data) => apiClient.patch(`${basePath}/${id}`, data).then((r) => r.data),

    remove: (id) => apiClient.delete(`${basePath}/${id}`).then((r) => r.data),

    react: (id, type) => apiClient.post(`${basePath}/${id}/react`, { type }).then((r) => r.data),

    // Chỉ TẠO link chia sẻ (không tính share ở đây) — xem
    // backend/src/controllers/share.controller.js. Lượt share thực sự được
    // tính khi getOne(id) được gọi lại với ?idu=/?shared= trong URL.
    share: (id) => apiClient.post(`${basePath}/${id}/share`).then((r) => r.data),

    // v0.10.17: phân trang cursor (giống `list()` ở trên) — trả nguyên
    // `{comments, nextCursor}` thay vì chỉ mảng comments, để caller (xem
    // `usePaginatedComments`) biết còn trang tiếp theo hay không.
    listComments: (id, cursor, limit = 20) =>
      apiClient.get(`${basePath}/${id}/comments`, { params: { cursor, limit } }).then((r) => r.data),

    addComment: (id, content) =>
      apiClient.post(`${basePath}/${id}/comments`, { content }).then((r) => r.data),

    editComment: (id, commentId, content) =>
      apiClient.patch(`${basePath}/${id}/comments/${commentId}`, { content }).then((r) => r.data),

    deleteComment: (id, commentId) =>
      apiClient.delete(`${basePath}/${id}/comments/${commentId}`).then((r) => r.data),
  };
}

export const postsApi = makeContentApi("/posts");
export const blogsApi = makeContentApi("/blogs");
