import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * ==== Module 1.0 — Smart Page Header ====
 * Mỗi trang đăng ký { title, isBrand, actions[] } vào context.
 * Navbar đọc config để hiển thị tên trang + nút chức năng trên AppBar.
 * Unmount trang → clear (tránh “dính” action của trang trước).
 *
 * action: { key, label, icon, onClick, disabled?, color? }
 */

const DEFAULT = {
  title: "Twelve",
  isBrand: true,
  actions: [],
};

const PageHeaderContext = createContext(null);

export function PageHeaderProvider({ children }) {
  const [config, setConfig] = useState(DEFAULT);

  const setPageHeader = useCallback((next) => {
    setConfig({
      title: next?.title ?? "Twelve",
      isBrand: next?.isBrand === true,
      actions: Array.isArray(next?.actions) ? next.actions : [],
    });
  }, []);

  const resetPageHeader = useCallback(() => {
    setConfig(DEFAULT);
  }, []);

  const value = useMemo(
    () => ({ config, setPageHeader, resetPageHeader }),
    [config, setPageHeader, resetPageHeader]
  );

  return <PageHeaderContext.Provider value={value}>{children}</PageHeaderContext.Provider>;
}

export function usePageHeader() {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) throw new Error("usePageHeader phải dùng trong PageHeaderProvider.");
  return ctx;
}

/**
 * Đăng ký header khi mount, clear khi unmount.
 * pages gọi: useRegisterPageHeader({ title, isBrand, actions })
 */
export function useRegisterPageHeader({ title, isBrand = false, actions = [] }) {
  const { setPageHeader, resetPageHeader } = usePageHeader();

  // Serialize actions by keys + labels to avoid infinite loops when parent
  // recreates action array each render — pages should useMemo actions.
  const actionsKey = actions.map((a) => a?.key).join("|");

  React.useEffect(() => {
    setPageHeader({ title, isBrand, actions });
    return () => resetPageHeader();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, isBrand, actionsKey, setPageHeader, resetPageHeader, actions]);
}
