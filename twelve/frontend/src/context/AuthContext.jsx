import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, signOut as firebaseSignOut } from "firebase/auth";
import { auth } from "../firebase";
import { getMe } from "../api/users.api";
import { syncActivation } from "../api/auth.api";
import { dlog, registerAuthSnapshotGetter, snapshotAuth } from "../utils/debugLog";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(undefined); // undefined = đang kiểm tra, null = chưa đăng nhập
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  // ==== VÁ v0.8.13 ====
  // Tách `emailVerified` thành STATE RIÊNG thay vì đọc trực tiếp
  // `firebaseUser.emailVerified` mỗi render. Lý do: Firebase SDK giữ
  // `auth.currentUser` là CÙNG MỘT object instance xuyên suốt phiên — khi
  // nơi khác gọi `user.reload()` (ví dụ LoginPage#handleCheckVerified),
  // Firebase MUTATE property `emailVerified` ngay trên chính object đó chứ
  // KHÔNG phát sinh sự kiện `onAuthStateChanged` mới (sự kiện này chỉ bắn
  // khi có đăng nhập/đăng xuất THẬT). Vì `firebaseUser` trong state vẫn là
  // cùng 1 reference y hệt, `setFirebaseUser(auth.currentUser)` (nếu có gọi
  // lại) cũng bị React bỏ qua re-render do so sánh `Object.is` thấy giống
  // hệt nhau — hậu quả: `emailVerified` tính ra từ context KẸT ở giá trị cũ
  // (thường là `false` từ lúc mới đăng ký) suốt phiên, dù người dùng đã bấm
  // link xác minh thật và Firestore đã chuyển `active`. Đây chính là bug
  // "xác minh xong vẫn bị đòi xác minh lại" được báo cáo ở v0.8.12.
  const [emailVerifiedFlag, setEmailVerifiedFlag] = useState(false);
  // Chỉ dùng để hiển thị UI khác biệt khi mọi lần thử tải hồ sơ đều thất
  // bại (xem chi tiết bug ở `refreshProfile` bên dưới) — KHÔNG dùng để suy
  // ra trạng thái đăng nhập/active, tránh lặp lại đúng kiểu lỗi đã gây ra
  // bug này (dựa vào 1 biến state có thể "kẹt" ở giá trị sai).
  const [profileError, setProfileError] = useState(null);

  /**
   * ==== VÁ v0.8.13 ====
   * Gọi hàm này thay vì tự `auth.currentUser.reload()` rồi đọc trực tiếp ở
   * bất kỳ đâu khác trong app — đảm bảo state `emailVerifiedFlag` (và do đó
   * `emailVerified` trong context, dùng bởi LoginPage) luôn được đồng bộ lại
   * SAU MỖI lần reload, thay vì chỉ mutate object mà không ai biết để
   * re-render (xem giải thích ở khai báo `emailVerifiedFlag` phía trên).
   */
  const reloadEmailVerified = useCallback(async () => {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    const verified = !!auth.currentUser.emailVerified;
    setEmailVerifiedFlag(verified);
    dlog.info("auth", "reloadEmailVerified", { verified });
    return verified;
  }, []);

  /**
   * ==== VÁ v0.8.9 — "Vui lòng đăng nhập..." dù tài khoản đã active ====
   *
   * TRƯỚC ĐÂY: hàm này gọi `getMe()` đúng 1 LẦN DUY NHẤT mỗi khi Firebase
   * auth state thay đổi (đăng nhập / F5 trang). Nếu lần gọi đó thất bại vì
   * MỘT lý do THOÁNG QUA — mạng chập chờn, hoặc phổ biến nhất: backend host
   * trên Render gói free "ngủ" sau một thời gian không có traffic và cần
   * 30-60s để "thức dậy" (cold start) ở request đầu tiên — `profile` sẽ
   * kẹt ở `null` CHO ĐẾN KHI người dùng tự tải lại trang hoặc đăng xuất/
   * đăng nhập lại (không có gì tự động gọi lại `getMe()` lần nữa).
   *
   * Vì `isLoggedIn` (xem bên dưới) được định nghĩa dựa trên
   * `profile?.status === "active"`, hễ `profile` là `null` thì `isLoggedIn`
   * LUÔN là `false` — bất kể tài khoản Firebase vẫn còn phiên đăng nhập và
   * tài khoản Twelve thực sự đã `active`. Toàn bộ nơi check `isLoggedIn`
   * (PostCard, PostDetailPage, CommentModal, RouteGuards...) vì vậy hiển
   * thị nhầm "Vui lòng đăng nhập" / điều hướng nhầm về /login cho một tài
   * khoản đang đăng nhập bình thường.
   *
   * FIX: thử lại `getMe()` tối đa 3 lần với backoff (1s, 2s) TRƯỚC KHI kết
   * luận thất bại, tất cả nằm trong CÙNG MỘT cửa sổ `loadingProfile = true`
   * — để các nơi đã biết chờ `loadingProfile` (như `RouteGuards`) tự động
   * chờ qua hết các lần thử lại thay vì kết luận "chưa đăng nhập" quá sớm.
   * Chỉ khi CẢ 3 lần đều thất bại mới set `profileError` và coi như không
   * tải được hồ sơ trong phiên này.
   */
  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser) return null;
    setLoadingProfile(true);
    dlog.info("auth", "refreshProfile start", snapshotAuth());
    setProfileError(null);
    const MAX_ATTEMPTS = 3;
    try {
      // Nếu email đã verified nhưng status vẫn PENDING → đồng bộ
      if (auth.currentUser.emailVerified) {
        try {
          await syncActivation();
          dlog.info("auth", "syncActivation ok");
        } catch (e) {
          // Có thể đã ACTIVE hoặc lỗi mạng — không chặn
          dlog.warn("auth", "syncActivation skipped/failed", { message: e?.message || String(e) });
          console.debug("syncActivation (optional):", e?.message || e);
        }
      }

      let lastErr = null;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const me = await getMe();
          setProfile(me);
          dlog.info("auth", "getMe ok", {
            attempt: attempt + 1,
            status: me?.status,
            uid: me?.uid,
            tagName: me?.tagName,
          });
          if (me.isFirstLogin) setShowWelcome(true);
          return me;
        } catch (err) {
          lastErr = err;
          dlog.warn("auth", `getMe fail attempt ${attempt + 1}/${MAX_ATTEMPTS}`, {
            message: err?.message || String(err),
            status: err?.response?.status,
          });
          console.error(`Không tải được hồ sơ (lần ${attempt + 1}/${MAX_ATTEMPTS}):`, err?.message || err);
          if (attempt < MAX_ATTEMPTS - 1) {
            // Backoff tăng dần: 1s rồi 2s — đủ để backend Render "thức dậy"
            // sau cold start mà không bắt người dùng chờ quá lâu.
            await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
          }
        }
      }
      dlog.error("auth", "refreshProfile exhausted retries", {
        message: lastErr?.message || String(lastErr),
      });
      setProfileError(lastErr);
      return null;
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    registerAuthSnapshotGetter(() => auth.currentUser);
    const unsub = onAuthStateChanged(auth, async (user) => {
      dlog.info("auth", "onAuthStateChanged", {
        hasUser: !!user,
        uid: user?.uid || null,
        emailVerified: user?.emailVerified ?? null,
      });
      setFirebaseUser(user);
      setEmailVerifiedFlag(!!user?.emailVerified);
      if (user) {
        await refreshProfile();
      } else {
        setProfile(null);
        setProfileError(null);
        dlog.info("auth", "signed out / no user — profile cleared");
      }
    });
    return unsub;
  }, [refreshProfile]);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    setProfile(null);
    setEmailVerifiedFlag(false);
  }, []);

  const dismissWelcome = useCallback(() => setShowWelcome(false), []);

  // ==== VÁ v0.8.6 ====
  // Trước đây `isLoggedIn` chỉ dựa vào việc CÓ session Firebase (`!!firebaseUser`),
  // bất kể tài khoản đã kích hoạt (status = "active") hay chưa. Vì Firebase
  // Auth session được lưu persistent (IndexedDB) và dùng chung cho MỌI tab,
  // một tài khoản `pending` (đăng nhập nhưng chưa xác minh email) chỉ cần mở
  // tab mới, gõ thẳng URL, hoặc bấm back/forward để né dialog "Xác minh email"
  // ở LoginPage — sau đó toàn bộ UI (Navbar, menu, dialog Chào mừng...) hiển
  // thị y như đã đăng nhập thật, dù backend vẫn từ chối mọi thao tác ghi dữ
  // liệu (403 ACCOUNT_NOT_ACTIVE). Đây chính là "mẹo" đăng nhập mà không cần
  // kích hoạt được ghi nhận trong bản 0.8.5.
  //
  // Từ 0.8.6: `isLoggedIn` được siết lại để đồng nghĩa với "đã đăng nhập VÀO
  // TWELVE" (status === active) — khớp với định nghĩa mà `requireAuth` ở
  // backend đã dùng từ lâu. `hasSession` (Firebase có user, bất kể status)
  // được tách ra riêng, chỉ dùng cho các luồng thuộc chính quy trình kích
  // hoạt (LoginPage, PendingSessionGate).
  const isActive = !!firebaseUser && profile?.status === "active";
  const isPending = !!firebaseUser && !!profile && profile.status !== "active";

  useEffect(() => {
    dlog.info("auth", "auth flags updated", {
      isActive,
      isPending,
      isLoggedIn: isActive,
      hasSession: !!firebaseUser,
      isAuthReady: firebaseUser !== undefined,
      loadingProfile,
      profileError: profileError || null,
      profileStatus: profile?.status ?? null,
      uid: firebaseUser?.uid || profile?.uid || null,
    });
  }, [isActive, isPending, firebaseUser, loadingProfile, profileError, profile?.status, profile?.uid]);

  const value = {
    firebaseUser,
    profile,
    hasSession: !!firebaseUser,
    isLoggedIn: isActive,
    isPending,
    isAuthReady: firebaseUser !== undefined,
    loadingProfile,
    // ==== VÁ v0.8.9 ====
    // true khi đã thử tải hồ sơ đủ 3 lần (xem refreshProfile) mà vẫn thất
    // bại — cho phép UI hiển thị đúng bản chất vấn đề ("không tải được hồ
    // sơ, thử lại") thay vì lẫn với "chưa đăng nhập" (2 tình huống có
    // nguyên nhân và cách xử lý hoàn toàn khác nhau).
    profileError,
    showWelcome,
    dismissWelcome,
    refreshProfile,
    reloadEmailVerified,
    signOut,
    isSA: isActive && profile?.accountGroup === "SA",
    emailVerified: emailVerifiedFlag,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
