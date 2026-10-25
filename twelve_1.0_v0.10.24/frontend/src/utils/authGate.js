/**
 * Cổng thao tác ghi (like/comment/đăng bài…) — phân biệt rõ 4 trạng thái.
 * Tránh báo "Vui lòng đăng nhập" khi Firebase còn session nhưng profile chưa ready.
 *
 * Bảo mật: chỉ ok=true khi isLoggedIn (session + profile.status === "active").
 * Backend requireAuth vẫn là lớp chặn cuối.
 */

/**
 * @param {{
 *   isLoggedIn: boolean,
 *   hasSession: boolean,
 *   loadingProfile?: boolean,
 *   profile?: { status?: string } | null,
 *   profileError?: unknown,
 * }} auth
 * @returns {{ ok: true } | { ok: false, kind: string, message: string, shouldRefresh?: boolean }}
 */
export function resolveAuthActionGate(auth) {
  const {
    isLoggedIn,
    hasSession,
    loadingProfile = false,
    profile = null,
    profileError = null,
  } = auth || {};

  if (isLoggedIn) return { ok: true };

  // Đang tải hồ sơ, hoặc có session nhưng profile chưa về và chưa lỗi hẳn
  if (loadingProfile || (hasSession && !profile && !profileError)) {
    return {
      ok: false,
      kind: "loading",
      message: "Đang tải thông tin tài khoản, vui lòng thử lại sau giây lát…",
      shouldRefresh: !loadingProfile,
    };
  }

  if (hasSession && profileError) {
    return {
      ok: false,
      kind: "profile_error",
      message: "Không tải được thông tin tài khoản. Đang thử lại…",
      shouldRefresh: true,
    };
  }

  if (hasSession && profile && profile.status !== "active") {
    return {
      ok: false,
      kind: "pending",
      message: "Tài khoản chưa kích hoạt. Vui lòng xác minh email trước khi thao tác.",
      shouldRefresh: false,
    };
  }

  return {
    ok: false,
    kind: "anonymous",
    message: "Vui lòng đăng nhập để thực hiện thao tác này.",
    shouldRefresh: false,
  };
}
