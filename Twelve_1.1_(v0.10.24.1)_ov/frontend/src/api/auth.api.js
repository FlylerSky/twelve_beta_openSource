import apiClient from "./client";

export const registerUser = (data) => apiClient.post("/auth/register", data).then((r) => r.data);

export const checkTagName = (tag) =>
  apiClient.get("/auth/check-tagname", { params: { tag } }).then((r) => r.data);

/**
 * Đồng bộ status PENDING → ACTIVE sau khi Firebase xác minh email thành công.
 * Cần đã đăng nhập (Bearer token).
 */
export const syncActivation = () =>
  apiClient.post("/auth/activation/sync").then((r) => r.data);

// Legacy – backend trả 410, giữ để tránh crash nếu còn chỗ gọi
export const sendActivationCode = (email) =>
  apiClient.post("/auth/activation/send", { email }).then((r) => r.data);

export const verifyActivationCode = (email, code) =>
  apiClient.post("/auth/activation/verify", { email, code }).then((r) => r.data);
