import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { createAppTheme } from "../theme/theme";

/**
 * ==== v0.9.0 — Settings > Ứng dụng > Chế độ giao diện ====
 * Quản lý lựa chọn Chế độ giao diện của người dùng: "light" | "dark" | "system".
 *
 * - `mode`: lựa chọn NGƯỜI DÙNG đã chọn (kể cả "system") — hiển thị đúng trên
 *   UI Settings (radio nào đang được chọn).
 * - `resolvedMode`: giá trị THỰC TẾ đang áp dụng ("light" hoặc "dark") — khi
 *   `mode === "system"`, giá trị này theo `prefers-color-scheme` của trình
 *   duyệt/hệ điều hành và tự cập nhật real-time nếu người dùng đổi chế độ hệ
 *   thống trong lúc đang mở Twelve (không cần tải lại trang).
 *
 * Lưu lựa chọn vào localStorage — CHỈ áp dụng trên thiết bị/trình duyệt này
 * (chưa đồng bộ qua tài khoản/Firestore ở bản v0.9.0 này, có thể bổ sung sau
 * nếu cần đồng bộ đa thiết bị).
 */

const STORAGE_KEY = "twelve_theme_mode";
const VALID_MODES = ["light", "dark", "system"];

function readStoredMode() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return VALID_MODES.includes(raw) ? raw : "system";
  } catch {
    // localStorage có thể bị chặn (chế độ ẩn danh nghiêm ngặt, cookie bị tắt...)
    return "system";
  }
}

function getSystemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

const ThemeModeContext = createContext(null);

export function ThemeModeProvider({ children }) {
  const [mode, setModeState] = useState(readStoredMode);
  const [systemPrefersDark, setSystemPrefersDark] = useState(getSystemPrefersDark);

  // Lắng nghe thay đổi chế độ SÁNG/TỐI của hệ điều hành/trình duyệt real-time
  // — chỉ cần thiết khi mode = "system", nhưng đăng ký sẵn không tốn kém, để
  // sẵn sàng ngay khi người dùng chuyển sang "system" mà không cần thêm logic.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e) => setSystemPrefersDark(e.matches);
    // Safari cũ dùng addListener/removeListener thay vì addEventListener
    if (mql.addEventListener) mql.addEventListener("change", handler);
    else mql.addListener(handler);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", handler);
      else mql.removeListener(handler);
    };
  }, []);

  const setMode = (next) => {
    if (!VALID_MODES.includes(next)) return;
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Bỏ qua nếu không lưu được — lựa chọn vẫn có hiệu lực trong phiên hiện
      // tại (state React), chỉ không nhớ được sau khi tải lại trang.
    }
  };

  const resolvedMode = mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode;

  // Đồng bộ màu thanh trạng thái + nền html/body để tránh “vệt” màu chế độ
  // cũ ở mép dưới khi đổi light↔dark (overscroll / safe-area trên mobile).
  useEffect(() => {
    const color = resolvedMode === "dark" ? "#141218" : "#FFFBFE";
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", color);
    document.documentElement.style.backgroundColor = color;
    document.documentElement.style.colorScheme = resolvedMode === "dark" ? "dark" : "light";
    if (document.body) document.body.style.backgroundColor = color;
    const root = document.getElementById("root");
    if (root) root.style.backgroundColor = color;
  }, [resolvedMode]);

  const theme = useMemo(() => createAppTheme(resolvedMode), [resolvedMode]);

  const value = useMemo(() => ({ mode, resolvedMode, setMode }), [mode, resolvedMode]);

  return (
    <ThemeModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode() {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error("useThemeMode phải được gọi bên trong ThemeModeProvider.");
  return ctx;
}
