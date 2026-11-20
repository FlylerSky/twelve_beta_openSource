import React, { useCallback, useEffect, useState } from "react";
import {
  Box,
  Typography,
  Paper,
  Stack,
  Button,
  Divider,
  CircularProgress,
  Alert,
  LinearProgress,
  Chip,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { getAssetStats } from "../../api/admin.api";
import { useSnackbar } from "../../context/SnackbarContext";
import { formatRelativeTime } from "../../utils/time";

/**
 * ==== v0.10.21 — tab "Quản trị" (Settings, chỉ SA): giám sát tài nguyên upload ====
 *
 * Hiển thị dữ liệu từ GET /api/admin/assets/stats (backend v0.10.20):
 *  - Số lượng + dung lượng file người dùng đã upload, theo từng loại (hiện chỉ "avatar").
 *  - Top 10 tài khoản đổi/upload nhiều nhất — phát hiện sớm tài khoản lạm dụng.
 *  - Dung lượng THẬT của tài khoản Cloudinary, để so với sổ đăng ký.
 *
 * Cách đọc: Cloudinary còn chứa cả ảnh/video SA tự upload cho bài viết (không nằm trong
 * sổ), nên số ở khối Cloudinary LỚN HƠN số trong sổ là bình thường. Dấu hiệu cần điều tra:
 * dung lượng/số file trên Cloudinary tăng nhanh mà số trong sổ không tăng → có file
 * đang lọt ra ngoài sổ. Khi đó chạy "npm run assets:cleanup" (dry-run) ở backend.
 *
 * Backend tự chặn 403 nếu không phải SA; panel chỉ hiện trong tab Quản trị (xem SettingsPage).
 */

const KIND_LABEL = { avatar: "Ảnh đại diện (avatar)" };

function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return "—";
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(2)} MB`;
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function StatBox({ label, value, sub }) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 1, p: 1.5, flex: 1, minWidth: 130 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.3 }}>
        {value}
      </Typography>
      {sub && (
        <Typography variant="caption" color="text.secondary">
          {sub}
        </Typography>
      )}
    </Paper>
  );
}

export default function AdminAssetsPanel() {
  const snackbar = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(
    (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      return getAssetStats({ refresh })
        .then((data) => setStats(data))
        .catch((err) => {
          const msg = err.message || "Không lấy được thống kê tài nguyên.";
          setError(msg);
          if (refresh) snackbar.error(msg);
        })
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [snackbar]
  );

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const registry = stats?.registry;
  const cl = stats?.cloudinary;
  const kinds = registry ? Object.entries(registry.byKind || {}) : [];
  const topUploaders = stats?.topUploaders || [];
  const usedPct = cl && Number.isFinite(Number(cl.storageUsedPercent)) ? Number(cl.storageUsedPercent) : null;

  return (
    <Box>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1} sx={{ mb: 0.5 }}>
        <Typography variant="subtitle1" fontWeight={700}>
          Tài nguyên người dùng upload
        </Typography>
        <Button
          size="small"
          startIcon={refreshing ? <CircularProgress size={14} /> : <RefreshIcon />}
          onClick={() => load(true)}
          disabled={loading || refreshing}
        >
          Làm mới
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Theo dõi số lượng và dung lượng file người dùng đã upload lên Cloudinary (hiện chỉ có ảnh đại diện), tài khoản nào
        đổi/upload nhiều nhất, và dung lượng thật của tài khoản Cloudinary — để kho tài nguyên không phình ra ngoài tầm
        kiểm soát. Số liệu được lưu tạm 60 giây; bấm "Làm mới" để lấy số mới nhất.
      </Typography>

      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!loading && stats && (
        <>
          {/* Tổng quan sổ đăng ký */}
          <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap" sx={{ mb: 2 }}>
            <StatBox label="Tổng số file (theo sổ)" value={registry.total.toLocaleString("vi-VN")} />
            <StatBox label="Tổng dung lượng (theo sổ)" value={formatBytes(registry.totalBytes)} />
            <StatBox
              label="Dung lượng TB / file"
              value={registry.total > 0 ? formatBytes(registry.totalBytes / registry.total) : "—"}
            />
          </Stack>

          {/* Theo loại */}
          <Paper variant="outlined" sx={{ borderRadius: 1, overflow: "hidden", mb: 2 }}>
            <Box sx={{ px: 2, py: 1.25, bgcolor: "action.hover" }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary">
                Theo loại
              </Typography>
            </Box>
            <Divider />
            <Stack divider={<Divider />}>
              {kinds.map(([kind, v]) => (
                <Stack key={kind} direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, py: 1.25 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {KIND_LABEL[kind] || kind}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {v.count.toLocaleString("vi-VN")} file · {formatBytes(v.totalBytes)}
                  </Typography>
                </Stack>
              ))}
              {kinds.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 2, textAlign: "center" }}>
                  Chưa có loại tài nguyên nào.
                </Typography>
              )}
            </Stack>
          </Paper>

          {/* Cloudinary thật */}
          <Paper variant="outlined" sx={{ borderRadius: 1, p: 2, mb: 2 }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary">
              Tài khoản Cloudinary (số liệu thật)
            </Typography>
            {cl ? (
              <>
                <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                  <StatBox
                    label="Dung lượng lưu trữ"
                    value={formatBytes(cl.storageBytes)}
                    sub={cl.storageLimitBytes ? `Hạn mức ${formatBytes(cl.storageLimitBytes)}` : undefined}
                  />
                  <StatBox label="Số file gốc" value={cl.resources != null ? Number(cl.resources).toLocaleString("vi-VN") : "—"} />
                  <StatBox
                    label="File phái sinh"
                    value={cl.derivedResources != null ? Number(cl.derivedResources).toLocaleString("vi-VN") : "—"}
                  />
                </Stack>
                {usedPct != null && (
                  <Box sx={{ mt: 1.5 }}>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(100, usedPct)}
                      color={usedPct >= 90 ? "error" : usedPct >= 70 ? "warning" : "primary"}
                    />
                    <Typography variant="caption" color="text.secondary">
                      Đã dùng {usedPct}% hạn mức lưu trữ
                    </Typography>
                  </Box>
                )}
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                  {cl.plan ? `Gói: ${cl.plan}. ` : ""}Số này gồm cả ảnh/video SA tự upload cho bài viết (không nằm trong sổ)
                  nên lớn hơn số theo sổ là bình thường. Nếu nó tăng nhanh mà số theo sổ không tăng, hãy chạy dry-run
                  "npm run assets:cleanup" ở backend để tìm file lọt ngoài sổ.
                </Typography>
              </>
            ) : (
              <Alert severity="warning" sx={{ mt: 1 }}>
                Không lấy được số liệu từ Cloudinary (có thể tạm thời chạm hạn mức Admin API hoặc thiếu cấu hình). Số liệu
                theo sổ ở trên vẫn đúng.
              </Alert>
            )}
          </Paper>

          {/* Top uploader */}
          <Paper variant="outlined" sx={{ borderRadius: 1, overflow: "hidden" }}>
            <Box sx={{ px: 2, py: 1.25, bgcolor: "action.hover" }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary">
                Top {topUploaders.length || 10} tài khoản đổi/upload nhiều nhất
              </Typography>
            </Box>
            <Divider />
            <Stack divider={<Divider />}>
              {topUploaders.map((u, i) => (
                <Stack key={`${u.ownerUid}-${u.kind}`} direction="row" spacing={1.5} alignItems="center" sx={{ px: 2, py: 1.25 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ width: 20, textAlign: "right" }}>
                    {i + 1}
                  </Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {u.displayName || "(không rõ tên)"} {u.tagName && <span style={{ fontWeight: 400 }}>{u.tagName}</span>}
                      {!u.accountExists && (
                        <Chip size="small" color="warning" label="tài khoản đã xoá" sx={{ ml: 1, height: 20 }} />
                      )}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                      {KIND_LABEL[u.kind] || u.kind} · uid {u.ownerUid}
                      {u.updatedAt ? ` · lần cuối: ${formatRelativeTime(u.updatedAt)}` : ""}
                    </Typography>
                  </Box>
                  <Typography variant="body2" fontWeight={700}>
                    {u.uploadCount.toLocaleString("vi-VN")} lần
                  </Typography>
                </Stack>
              ))}
              {topUploaders.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 2, textAlign: "center" }}>
                  Chưa có dữ liệu. Sổ chỉ ghi các lần upload từ bản v0.10.20 trở đi; avatar cũ sẽ được ghi vào sổ khi chạy
                  script dọn tài nguyên hoặc khi chủ tài khoản đổi avatar.
                </Typography>
              )}
            </Stack>
          </Paper>

          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
            Cập nhật lúc {new Date(stats.generatedAt).toLocaleString("vi-VN")}
            {stats.cached ? " (từ bộ nhớ tạm)" : ""}.
          </Typography>
        </>
      )}
    </Box>
  );
}
