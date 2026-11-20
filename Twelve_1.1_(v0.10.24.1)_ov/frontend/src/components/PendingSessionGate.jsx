import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/**
 * VÁ v0.8.6 — đóng "mẹo" đăng nhập mà không cần kích hoạt.
 *
 * Trước bản này, một tài khoản `pending` (đã đăng nhập Firebase nhưng chưa
 * xác minh email) chỉ bị chặn ở đúng nơi họ vừa gõ mật khẩu (dialog trong
 * LoginPage). Vì session Firebase là persistent và dùng chung mọi tab/route,
 * họ chỉ cần mở tab mới hoặc gõ thẳng URL khác để né dialog đó — AuthContext
 * khi ấy vẫn coi họ là "đã đăng nhập" nên Navbar, WelcomeSetupDialog... hiển
 * thị như một tài khoản active thật, dù mọi request ghi dữ liệu vẫn bị
 * backend từ chối (403 ACCOUNT_NOT_ACTIVE) — nên chưa gây hậu quả thực tế,
 * nhưng vẫn là một lỗ hổng cần siết lại.
 *
 * Component này mount đúng 1 lần ở gốc App, độc lập với route đang đứng:
 * hễ phát hiện có session Firebase nhưng tài khoản CHƯA active (`isPending`),
 * nó điều hướng thẳng về /login ở MỌI route — không có ngoại lệ theo tab hay
 * theo cách người dùng vào app. Chỉ khi tài khoản đồng bộ xong thành active
 * (qua syncActivation trong AuthContext) thì mới được coi là đã đăng nhập.
 */
export default function PendingSessionGate() {
  const { isAuthReady, isPending, loadingProfile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthReady || loadingProfile) return;
    if (!isPending) return;
    if (location.pathname === "/login") return;

    navigate("/login", {
      replace: true,
      state: { from: location, pendingActivation: true },
    });
  }, [isAuthReady, isPending, loadingProfile, location, navigate]);

  return null;
}
