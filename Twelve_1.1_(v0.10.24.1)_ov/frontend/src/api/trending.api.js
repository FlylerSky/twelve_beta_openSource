import apiClient from "./client";

export const getWeeklyRanking = () => apiClient.get("/trending/users/weekly").then((r) => r.data);

export const getAllTimeRanking = () => apiClient.get("/trending/users/alltime").then((r) => r.data);

// ==== v0.10.8 — tab Hashtag ====
export const getHashtagWeeklyRanking = (mode = "classic") =>
  apiClient.get("/trending/hashtags/weekly", { params: { mode } }).then((r) => r.data);

export const getHashtagAllTimeRanking = (mode = "classic") =>
  apiClient.get("/trending/hashtags/alltime", { params: { mode } }).then((r) => r.data);

// `tag` có thể có hoặc không có dấu "#" ở đầu — backend tự chuẩn hoá.
export const getHashtagPosts = (tag, mode = "classic") =>
  apiClient.get(`/trending/hashtags/${encodeURIComponent(tag)}/posts`, { params: { mode } }).then((r) => r.data);

export const searchTrending = ({ q, type = "post", sort = "newest", mode = "classic" }) =>
  apiClient.get("/trending/search", { params: { q, type, sort, mode } }).then((r) => r.data);
