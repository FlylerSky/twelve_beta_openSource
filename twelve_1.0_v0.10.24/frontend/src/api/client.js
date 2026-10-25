import axios from "axios";
import { auth } from "../firebase";
import { dlog, snapshotAuth } from "../utils/debugLog";

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:8080/api",
});

let reqSeq = 0;

// Tự động đính kèm Firebase idToken (nếu đã đăng nhập) vào mọi request
apiClient.interceptors.request.use(async (config) => {
  const id = ++reqSeq;
  config.__twelveReqId = id;
  config.__twelveStartedAt = Date.now();

  const user = auth.currentUser;
  let tokenAttached = false;
  let tokenError = null;
  if (user) {
    try {
      const token = await user.getIdToken();
      config.headers.Authorization = `Bearer ${token}`;
      tokenAttached = true;
    } catch (e) {
      tokenError = e?.message || String(e);
      dlog.error("api", "getIdToken failed", { id, error: tokenError, ...snapshotAuth() });
    }
  }

  dlog.debug("api", `→ ${config.method?.toUpperCase() || "GET"} ${config.url}`, {
    id,
    hasUser: !!user,
    tokenAttached,
    tokenError,
    params: config.params,
    // body size only
    hasData: config.data != null,
  });

  return config;
});

// Chuẩn hoá lỗi trả về từ backend để dùng { message } thống nhất
apiClient.interceptors.response.use(
  (res) => {
    const id = res.config?.__twelveReqId;
    const ms = res.config?.__twelveStartedAt ? Date.now() - res.config.__twelveStartedAt : null;
    dlog.debug("api", `← ${res.status} ${res.config?.method?.toUpperCase()} ${res.config?.url}`, {
      id,
      ms,
      status: res.status,
    });
    return res;
  },
  (err) => {
    const cfg = err.config || {};
    const id = cfg.__twelveReqId;
    const ms = cfg.__twelveStartedAt ? Date.now() - cfg.__twelveStartedAt : null;
    const status = err.response?.status;
    const message = err.response?.data?.error || "Đã có lỗi xảy ra, vui lòng thử lại.";
    const code = err.response?.data?.code;

    dlog.error("api", `✕ ${status || "NET"} ${cfg.method?.toUpperCase()} ${cfg.url}`, {
      id,
      ms,
      status,
      code,
      message,
      data: err.response?.data,
      ...snapshotAuth({
        note: status === 401 || status === 403 ? "auth-sensitive failure" : undefined,
      }),
    });

    return Promise.reject({ ...err, message });
  }
);

export default apiClient;
