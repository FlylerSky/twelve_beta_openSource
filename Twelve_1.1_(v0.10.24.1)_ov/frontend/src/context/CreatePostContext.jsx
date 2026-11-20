import React, { createContext, useContext, useState, useCallback } from "react";

const CreatePostContext = createContext(null);

/**
 * Cho phép mở modal "Đăng bài viết" từ BẤT KỲ trang nào (vd: từ Navbar) mà
 * không cần điều hướng về trang INDEX trước. Modal thực tế được mount 1 lần
 * duy nhất ở App.jsx và chỉ đọc trạng thái open/close từ context này.
 */
export function CreatePostProvider({ children }) {
  const [open, setOpen] = useState(false);
  // lastCreated đổi giá trị mỗi lần tạo bài thành công -> các trang khác (vd:
  // IndexPage) có thể useEffect theo dõi để tự làm mới danh sách bài viết.
  const [lastCreated, setLastCreated] = useState(null);

  const openModal = useCallback(() => setOpen(true), []);
  const closeModal = useCallback(() => setOpen(false), []);
  const notifyCreated = useCallback((id) => setLastCreated({ id, ts: Date.now() }), []);

  return (
    <CreatePostContext.Provider value={{ open, openModal, closeModal, lastCreated, notifyCreated }}>
      {children}
    </CreatePostContext.Provider>
  );
}

export function useCreatePost() {
  return useContext(CreatePostContext);
}
