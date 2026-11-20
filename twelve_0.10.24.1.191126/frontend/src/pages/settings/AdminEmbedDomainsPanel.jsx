import React, { useEffect, useState, useCallback } from "react";
import {
  Box,
  Typography,
  Paper,
  Switch,
  Stack,
  TextField,
  IconButton,
  Button,
  Divider,
  CircularProgress,
  Alert,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SaveIcon from "@mui/icons-material/Save";
import { getEmbedDomains, updateEmbedDomains } from "../../api/admin.api";
import { useSnackbar } from "../../context/SnackbarContext";

/**
 * ==== v0.10.15 — tab "Quản trị" (Settings, chỉ SA) — mục đầu tiên: quản lý
 * domain được phép nhúng media (YouTube/Vimeo/Twitch/SoundCloud/Spotify...)
 * trong bài viết/blog. ====
 *
 * `enabled = false` -> chặn TOÀN BỘ media có domain-allowlist, bất kể danh
 * sách domain còn gì (đúng yêu cầu: tắt = chặn hết). `enabled = true` -> chỉ
 * domain trong danh sách mới được nhúng.
 *
 * Mỗi lần LƯU đều kích hoạt quét lại toàn bộ bài viết/blog đang có ở backend
 * (xem embedDomains.controller.js#rescanContentForEmbedDomains) — hiển thị
 * rõ số liệu quét được sau khi lưu để SA biết tác động thực tế.
 *
 * ==== v0.10.16 — MỞ RỘNG phạm vi (không riêng iframe nữa) + hỗ trợ giới
 * hạn theo PATH ====
 * Trước bản vá, danh sách domain này CHỈ chặn được <iframe> — ảnh/video/
 * audio chèn trực tiếp bằng URL hoàn toàn nằm ngoài kiểm soát (xoá domain
 * không xoá được media trực tiếp đã đăng). Giờ áp dụng thống nhất cho MỌI
 * loại media. Mỗi dòng domain giờ có thể kèm path, vd.
 * "res.cloudinary.com/dk7xohrrk" — CHỈ cho phép đúng 1 cloud/thư mục cụ thể
 * dưới domain đó, chặn mọi cloud khác dù cùng domain gốc.
 */
export default function AdminEmbedDomainsPanel() {
  const snackbar = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [domains, setDomains] = useState([]); // [{ domain, label }] — "domain" ở ĐÂY là chuỗi hiển thị đầy đủ SA gõ ("res.cloudinary.com/dsviqitiv"), KHÔNG phải field "domain" tách riêng mà backend trả về.
  const [lastRescan, setLastRescan] = useState(null);

  // ==== v0.10.16 [SỬA LỖI] — path "biến mất" khỏi ô nhập ngay sau khi Lưu
  // ====
  // Backend (embedDomains.controller.js#normalizeDomainsInput) tách domain
  // và path thành 2 field RIÊNG khi trả về ({domain: "res.cloudinary.com",
  // path: "dsviqitiv"}) — cần thiết để so khớp path theo segment chính xác
  // ở sanitize.service.js. NHƯNG UI ở đây chỉ có 1 ô nhập/dòng, dùng field
  // "domain" để giữ TOÀN BỘ chuỗi SA gõ (kể cả phần path, vd.
  // "res.cloudinary.com/dsviqitiv") — gán thẳng response backend vào state
  // (như trước bản vá này) khiến ô nhập chỉ còn hiện "res.cloudinary.com",
  // làm SA tưởng nhầm path đã bị mất (dữ liệu Firestore vẫn lưu đúng, chỉ là
  // HIỂN THỊ sai). Ghép lại "domain/path" thành 1 chuỗi trước khi đưa vào
  // state hiển thị để khớp lại đúng những gì SA đã gõ.
  const toDisplayRow = (d) => ({
    domain: d && d.path ? `${d.domain}/${d.path}` : (d && d.domain) || "",
    label: (d && d.label) || "",
  });

  const load = useCallback(() => {
    setLoading(true);
    getEmbedDomains()
      .then((data) => {
        setEnabled(data.enabled !== false);
        setDomains(Array.isArray(data.domains) ? data.domains.map(toDisplayRow) : []);
      })
      .catch((err) => snackbar.error(err.message || "Không tải được cấu hình domain nhúng."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAddRow = () => setDomains((prev) => [...prev, { domain: "", label: "" }]);

  const handleRemoveRow = (index) => setDomains((prev) => prev.filter((_, i) => i !== index));

  const handleChangeRow = (index, field, value) =>
    setDomains((prev) => prev.map((d, i) => (i === index ? { ...d, [field]: value } : d)));

  const handleSave = () => {
    // Loại bỏ dòng domain bỏ trống (người dùng bấm "+" nhưng chưa nhập) trước
    // khi gửi — tránh lỗi validate 400 vô nghĩa từ backend cho trường hợp này.
    const cleaned = domains.map((d) => ({ domain: d.domain.trim(), label: d.label?.trim() || "" })).filter((d) => d.domain);

    const emptyRowsRemoved = domains.length - cleaned.length;
    if (emptyRowsRemoved > 0) setDomains(cleaned);

    setSaving(true);
    updateEmbedDomains({ enabled, domains: cleaned })
      .then((data) => {
        setEnabled(data.enabled !== false);
        setDomains(Array.isArray(data.domains) ? data.domains.map(toDisplayRow) : []);
        setLastRescan(data.rescan || null);
        snackbar.success("Đã lưu cấu hình domain nhúng.");
      })
      .catch((err) => snackbar.error(err.message || "Không lưu được cấu hình domain nhúng."))
      .finally(() => setSaving(false));
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
        Domain nhúng media trong bài viết
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Kiểm soát những domain được phép nhúng vào bài viết/blog — áp dụng
        cho MỌI loại media: ảnh, video/audio file trực tiếp, lẫn iframe
        (YouTube, Vimeo, Twitch, SoundCloud, Spotify...). Mỗi dòng có thể chỉ
        nhập domain (vd. "youtube.com" — cho phép mọi đường dẫn dưới domain
        đó), hoặc kèm thêm đường dẫn để giới hạn CHÍNH XÁC hơn (vd.
        "res.cloudinary.com/dk7xohrrk" chỉ cho phép đúng 1 cloud Cloudinary
        cụ thể, chặn mọi cloud khác dù cùng domain). Không thể thêm các tên miền
        dùng chung nhiều người (github.io, vercel.app, netlify.app, com.vn...) —
        hãy nhập subdomain cụ thể. Tắt hoàn toàn = chặn mọi media thuộc diện này,
        không có ngoại lệ.
      </Typography>

      <Paper variant="outlined" sx={{ borderRadius: 1, p: 2, mb: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="body1" fontWeight={600}>
              {enabled ? "Đang bật" : "Đang tắt — chặn toàn bộ media thuộc diện quản lý"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {enabled
                ? "Chỉ domain (và đường dẫn, nếu có giới hạn) trong danh sách bên dưới mới được phép nhúng."
                : "Mọi media thuộc diện quản lý (ảnh/video/audio trực tiếp, iframe YouTube/Vimeo...) sẽ bị loại bỏ khỏi bài viết, bất kể danh sách domain."}
            </Typography>
          </Box>
          <Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        </Stack>
      </Paper>

      <Paper
        variant="outlined"
        sx={{ borderRadius: 1, overflow: "hidden", opacity: enabled ? 1 : 0.5, pointerEvents: enabled ? "auto" : "none" }}
      >
        <Box sx={{ px: 2, py: 1.25, bgcolor: "action.hover" }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary">
            Danh sách domain ({domains.length})
          </Typography>
        </Box>
        <Divider />
        <Stack divider={<Divider />}>
          {domains.map((d, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="center" sx={{ px: 2, py: 1.25 }}>
              <TextField
                size="small"
                placeholder="youtube.com hoặc res.cloudinary.com/ten-cloud"
                value={d.domain}
                onChange={(e) => handleChangeRow(i, "domain", e.target.value)}
                sx={{ flex: 1.2, minWidth: 0 }}
              />
              <TextField
                size="small"
                placeholder="Nhãn hiển thị (tuỳ chọn)"
                value={d.label}
                onChange={(e) => handleChangeRow(i, "label", e.target.value)}
                sx={{ flex: 1, minWidth: 0, display: { xs: "none", sm: "block" } }}
              />
              <IconButton size="small" color="error" onClick={() => handleRemoveRow(i)} aria-label="Xoá domain">
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          {domains.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 2, textAlign: "center" }}>
              Chưa có domain nào — với "Đang bật" mà danh sách rỗng, mọi media thuộc diện quản lý cũng sẽ bị chặn.
            </Typography>
          )}
        </Stack>
        <Box sx={{ px: 2, py: 1.5 }}>
          <Button startIcon={<AddIcon />} onClick={handleAddRow} size="small">
            Thêm domain
          </Button>
        </Box>
      </Paper>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
        <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>
          {saving ? "Đang lưu…" : "Lưu thay đổi"}
        </Button>
        {saving && (
          <Typography variant="caption" color="text.secondary">
            Đang quét lại bài viết đang có, có thể mất vài giây…
          </Typography>
        )}
      </Stack>

      {lastRescan && lastRescan.error && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          Cấu hình domain ĐÃ được lưu và áp dụng cho bài đăng mới, nhưng bước quét lại các bài viết/blog đang có
          gặp lỗi. Hãy bấm "Lưu" thêm một lần nữa để quét lại.
        </Alert>
      )}
      {lastRescan && !lastRescan.error && (
        <Alert severity={lastRescan.failed > 0 ? "warning" : "info"} sx={{ mt: 2 }}>
          Đã quét {lastRescan.scanned} bài viết/blog, cập nhật lại {lastRescan.modified} bài do
          chứa media (ảnh/video/audio trực tiếp hoặc iframe) không còn hợp lệ với danh sách domain mới.
          {lastRescan.skipped > 0 &&
            ` ${lastRescan.skipped} bài không cần sửa nữa (đã bị xoá hoặc vừa được chủ bài chỉnh sửa trong lúc quét).`}
          {lastRescan.failed > 0 &&
            ` ${lastRescan.failed} bài gặp lỗi khi xử lý — hãy bấm "Lưu" thêm một lần để quét lại các bài đó.`}
        </Alert>
      )}
    </Box>
  );
}
