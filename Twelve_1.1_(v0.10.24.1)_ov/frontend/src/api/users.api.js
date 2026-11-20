import apiClient from "./client";

export const getMe = () => apiClient.get("/users/me").then((r) => r.data.user);

export const getPublicProfile = (uid) => apiClient.get(`/users/${uid}`).then((r) => r.data.user);

export const updateMe = (data) => apiClient.patch("/users/me", data).then((r) => r.data);

export const uploadAvatar = (fileBlob) => {
  if (!fileBlob || !(fileBlob instanceof Blob) || fileBlob.size === 0) {
    return Promise.reject({ message: "Ảnh không hợp lệ hoặc rỗng. Vui lòng chọn lại." });
  }
  const formData = new FormData();
  formData.append("avatar", fileBlob, "avatar.jpg");
  // QUAN TRỌNG: không tự set header Content-Type. Khi gửi FormData,
  // trình duyệt/axios cần tự sinh "multipart/form-data; boundary=..." — nếu set
  // cứng "multipart/form-data" (thiếu boundary) thì multer không parse được file.
  return apiClient
    .post("/users/me/avatar", formData, {
      // Đảm bảo không bị interceptor hoặc default gắn Content-Type sai
      headers: { "Content-Type": undefined },
      // Timeout dài hơn vì upload ảnh có thể chậm trên mạng yếu
      timeout: 60000,
    })
    .then((r) => r.data);
};
