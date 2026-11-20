import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeModeProvider } from "./context/ThemeModeContext";
import { AuthProvider } from "./context/AuthContext";
import { SnackbarProvider } from "./context/SnackbarContext";
import { CreatePostProvider } from "./context/CreatePostContext";
import { PageHeaderProvider } from "./context/PageHeaderContext";
import App from "./App";
import { dlog } from "./utils/debugLog";

window.addEventListener("error", (ev) => {
  dlog.error("system", "window.error", {
    message: ev.message,
    filename: ev.filename,
    lineno: ev.lineno,
    colno: ev.colno,
  });
});
window.addEventListener("unhandledrejection", (ev) => {
  dlog.error("system", "unhandledrejection", {
    reason: String(ev.reason?.message || ev.reason),
  });
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* v0.9.0: ThemeModeProvider tự quản lý MUI ThemeProvider + CssBaseline
        bên trong nó (theme đổi động theo Sáng/Tối/Theo trình duyệt) — xem
        context/ThemeModeContext.jsx. */}
    <ThemeModeProvider>
      <BrowserRouter>
        <SnackbarProvider>
          <AuthProvider>
            <CreatePostProvider>
              <PageHeaderProvider>
                <App />
              </PageHeaderProvider>
            </CreatePostProvider>
          </AuthProvider>
        </SnackbarProvider>
      </BrowserRouter>
    </ThemeModeProvider>
  </React.StrictMode>
);
