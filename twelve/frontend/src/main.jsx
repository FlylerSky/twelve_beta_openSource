import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider, CssBaseline } from "@mui/material";
import theme from "./theme/theme";
import { AuthProvider } from "./context/AuthContext";
import { SnackbarProvider } from "./context/SnackbarContext";
import { CreatePostProvider } from "./context/CreatePostContext";
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
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <SnackbarProvider>
          <AuthProvider>
            <CreatePostProvider>
              <App />
            </CreatePostProvider>
          </AuthProvider>
        </SnackbarProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);
