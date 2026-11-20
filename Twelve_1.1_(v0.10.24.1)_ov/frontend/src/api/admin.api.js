import apiClient from "./client";

// v0.10.15 — tab "Quản trị" (Settings, chỉ SA). Backend tự chặn 403 nếu gọi
// mà không phải SA — không cần kiểm tra quyền ở đây, chỉ gọi API.
export const getEmbedDomains = () => apiClient.get("/admin/embed-domains").then((r) => r.data);

export const updateEmbedDomains = ({ enabled, domains }) =>
  apiClient.put("/admin/embed-domains", { enabled, domains }).then((r) => r.data);

// v0.10.21 — giám sát tài nguyên Cloudinary do người dùng upload (backend cache 60 giây;
// refresh=true để bỏ cache và lấy số liệu mới nhất).
export const getAssetStats = ({ refresh = false } = {}) =>
  apiClient.get("/admin/assets/stats", { params: refresh ? { refresh: 1 } : undefined }).then((r) => r.data);
