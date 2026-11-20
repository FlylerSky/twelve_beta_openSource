import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Drawer,
  Box,
  Avatar,
  Divider,
  Chip,
  Stack,
  ButtonBase,
  Button,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import CloseIcon from "@mui/icons-material/Close";
import LoginIcon from "@mui/icons-material/Login";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import ArticleIcon from "@mui/icons-material/Article";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import LogoutIcon from "@mui/icons-material/Logout";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import SettingsIcon from "@mui/icons-material/Settings";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSnackbar } from "../context/SnackbarContext";
import { useCreatePost } from "../context/CreatePostContext";
import { usePageHeader } from "../context/PageHeaderContext";
import { getBackendVersion, getFrontendVersion } from "../api/version.api";
import DebugLogPanel from "./DebugLogPanel";
import AccountScorePopover from "./AccountScorePopover";
import { formatScore } from "../utils/number";
import { dlog } from "../utils/debugLog";

/** Fallback bề rộng 1 IconButton size=small + gap — ưu tiên đo thật từ DOM */
const ACTION_BTN_FALLBACK_PX = 36;
const MORE_BTN_FALLBACK_PX = 36;

/** Ô menu dạng block — icon + tên, dùng trong lưới 2 cột */
function MenuBlock({ icon, label, onClick, color }) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        p: 2,
        minHeight: 104,
        borderRadius: 1,
        // v0.9.1: action.hover / paper — không hardcode grey.50 (luôn sáng trong dark mode)
        bgcolor: "action.hover",
        border: "1px solid",
        borderColor: "divider",
        textAlign: "center",
        transition: "background-color 0.15s, border-color 0.15s",
        "&:hover": {
          bgcolor: "action.selected",
          borderColor: "primary.light",
        },
      }}
    >
      <Box
        sx={{
          color: color || "text.primary",
          lineHeight: 0,
          "& .MuiSvgIcon-root": { fontSize: 28 },
        }}
      >
        {icon}
      </Box>
      <Typography
        variant="body2"
        fontWeight={600}
        sx={{
          lineHeight: 1.3,
          px: 0.5,
          wordBreak: "break-word",
        }}
      >
        {label}
      </Typography>
    </ButtonBase>
  );
}

export default function Navbar() {
  const [debugOpen, setDebugOpen] = useState(false);
  const brandClicks = useRef({ count: 0, timer: null });
  const onBrandClick = useCallback(() => {
    // ==== VÁ v0.10.11 [LOW — báo cáo bảo mật V-006] ====
    // DebugLogPanel ghi lại chi tiết request/response API (đã redact
    // password/Authorization — xem utils/debugLog.js) — CHỈ lưu local
    // (sessionStorage), không gửi lên server, nhưng vẫn là bề mặt lộ thông
    // tin không cần thiết nếu vô tình bật được ở production (ví dụ ai đó
    // biết "mẹo" bấm 7 lần vào logo, rồi screen-share/để lộ màn hình).
    // Chỉ cho phép mở panel này ở môi trường development — build production
    // (import.meta.env.DEV === false) bấm bao nhiêu lần cũng không có tác
    // dụng gì khác ngoài hành vi brand-click bình thường.
    if (!import.meta.env.DEV) return false;
    const b = brandClicks.current;
    b.count += 1;
    if (b.timer) clearTimeout(b.timer);
    b.timer = setTimeout(() => {
      b.count = 0;
    }, 2500);
    dlog.debug("nav", `Brand click ${b.count}/7`);
    if (b.count >= 7) {
      b.count = 0;
      setDebugOpen((v) => {
        dlog.info("nav", v ? "Closing debug panel" : "Opening debug panel (7x Twelve)");
        return !v;
      });
      return true; // opened debug — không navigate
    }
    return false;
  }, []);

  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState({ frontend: null, backend: null });
  // v0.8.23: anchor cho AccountScorePopover — bấm vào Điểm tài khoản trong
  // card info user để xem chi tiết nguồn gốc (postsScoreSum + positiveScore).
  const [scoreAnchorEl, setScoreAnchorEl] = useState(null);
  // Module 1.0 / v0.9.3: mở rộng vùng action trên head (ẩn title + menu)
  const [headerExpanded, setHeaderExpanded] = useState(false);
  // Số action icon vừa khít vùng trống (đo thật, không cố định 2)
  const [visibleSlots, setVisibleSlots] = useState(2);
  const toolbarRef = useRef(null);
  const titleRef = useRef(null);
  const actionsBoxRef = useRef(null);
  const { config: pageHeader } = usePageHeader();
  const { isLoggedIn, profile, signOut } = useAuth();
  const { openModal } = useCreatePost();
  const navigate = useNavigate();
  const snackbar = useSnackbar();

  // v0.9.4: quay lại trang trước; nếu vào thẳng (không có history SPA) → INDEX
  const handleBack = useCallback(() => {
    const idx = window.history.state?.idx;
    if (typeof idx === "number" && idx > 0) {
      navigate(-1);
    } else {
      navigate("/");
    }
  }, [navigate]);

  // Đổi trang → thu gọn head
  useEffect(() => {
    setHeaderExpanded(false);
  }, [pageHeader.title, pageHeader.isBrand]);

  // v0.9.3.2: đo CHÍNH vùng action (flex-1 giữa title và menu).
  // Không trừ title/menu bằng ước lượng — tránh chỗ trống "ảo" còn thừa.
  useEffect(() => {
    if (headerExpanded) return undefined;
    const box = actionsBoxRef.current;
    if (!box) return undefined;

    const measure = () => {
      const free = box.clientWidth || 0;
      const n = (pageHeader.actions || []).length;
      if (n === 0) {
        setVisibleSlots(0);
        return;
      }
      if (free <= 0) {
        setVisibleSlots(0);
        return;
      }

      // Ưu tiên bề rộng nút thật đã render; fallback 36px
      const buttons = box.querySelectorAll("button");
      let btnW = ACTION_BTN_FALLBACK_PX;
      if (buttons.length > 0) {
        const rect = buttons[0].getBoundingClientRect();
        if (rect.width > 0) btnW = rect.width + 2; // +gap
      }
      let moreW = MORE_BTN_FALLBACK_PX;
      if (buttons.length > 1) {
        const last = buttons[buttons.length - 1];
        const r = last.getBoundingClientRect();
        if (r.width > 0) moreW = r.width + 2;
      }

      // Nút back (nếu có) chiếm chỗ cố định trong vùng chức năng
      const backW = pageHeader.isBrand ? 0 : btnW;
      const freeForPageActions = Math.max(0, free - backW);

      // Fit hết không cần "..."
      if (n * btnW <= freeForPageActions + 0.5) {
        setVisibleSlots(n);
        return;
      }

      // Cần "..." — chừa moreW, phần còn lại cho icon trang
      const forIcons = Math.max(0, freeForPageActions - moreW);
      let slots = Math.floor(forIcons / btnW);
      if (slots < 0) slots = 0;
      slots = Math.min(slots, n - 1);
      // Nếu slots=0 nhưng free còn đủ 1 icon + more → cho 1 icon
      if (slots === 0 && free >= btnW + moreW) slots = 1;
      setVisibleSlots(slots);
    };

    const run = () => {
      measure();
      requestAnimationFrame(measure);
    };
    run();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(run) : null;
    if (ro) ro.observe(box);
    window.addEventListener("resize", run);
    const delay = window.setTimeout(run, 120);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", run);
      window.clearTimeout(delay);
    };
  }, [pageHeader.actions, pageHeader.title, headerExpanded]);

  useEffect(() => {
    if (!open) return;
    getFrontendVersion()
      .then((v) => setVersions((s) => ({ ...s, frontend: v })))
      .catch(() => {});
    getBackendVersion()
      .then((v) => setVersions((s) => ({ ...s, backend: v })))
      .catch(() => {});
  }, [open]);

  const closeAndGo = (path) => {
    setOpen(false);
    navigate(path);
  };

  const handleSignOut = async () => {
    await signOut();
    setOpen(false);
    snackbar.info("Bạn đã đăng xuất.");
    navigate("/");
  };

  const handleOpenCreatePost = () => {
    setOpen(false);
    openModal();
  };

  const goToOwnProfile = () => {
    if (!profile?.uid) return;
    closeAndGo(`/u/${profile.uid}`);
  };

  const menuItems = useMemo(() => {
    if (isLoggedIn) {
      return [
        {
          key: "profile",
          label: "Profile",
          icon: <PersonOutlineIcon />,
          onClick: goToOwnProfile,
        },
        {
          key: "create",
          label: "Đăng bài viết",
          icon: <AddCircleOutlineIcon />,
          onClick: handleOpenCreatePost,
          color: "primary.main",
        },
        {
          key: "blog",
          label: "Blog",
          icon: <ArticleIcon />,
          onClick: () => closeAndGo("/blog"),
        },
        {
          key: "trending",
          label: "Xu hướng",
          icon: <TrendingUpIcon />,
          onClick: () => closeAndGo("/trending"),
        },
        {
          key: "settings",
          label: "Cài đặt",
          icon: <SettingsIcon />,
          onClick: () => closeAndGo("/settings"),
        },
      ];
    }
    return [
      {
        key: "register",
        label: "Đăng ký",
        icon: <HowToRegIcon />,
        onClick: () => closeAndGo("/register"),
      },
      {
        key: "login",
        label: "Đăng nhập",
        icon: <LoginIcon />,
        onClick: () => closeAndGo("/login"),
      },
      {
        key: "blog",
        label: "Blog",
        icon: <ArticleIcon />,
        onClick: () => closeAndGo("/blog"),
      },
      {
        key: "trending",
        label: "Xu hướng",
        icon: <TrendingUpIcon />,
        onClick: () => closeAndGo("/trending"),
      },
      {
        key: "settings",
        label: "Cài đặt",
        icon: <SettingsIcon />,
        onClick: () => closeAndGo("/settings"),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, profile?.uid]);

  return (
    <>
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          // Module 1.0.1: chặn head làm tràn / trồi ngang trang
          width: "100%",
          maxWidth: "100vw",
          left: 0,
          right: 0,
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        <Toolbar
          ref={toolbarRef}
          disableGutters
          sx={{
            gap: 0.5,
            minHeight: { xs: 56, sm: 64 },
            px: { xs: 1, sm: 1.5 },
            width: "100%",
            maxWidth: "100%",
            boxSizing: "border-box",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
          }}
        >
          {headerExpanded ? (
            /* ── Expanded: đóng + toàn bộ action (scroll ngang TRONG head) ── */
            <>
              <IconButton
                onClick={() => setHeaderExpanded(false)}
                aria-label="Thu gọn thanh chức năng"
                size="small"
                sx={{ flexShrink: 0 }}
              >
                <CloseIcon />
              </IconButton>
              <Box
                sx={{
                  flex: "1 1 auto",
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  overflowX: "auto",
                  overflowY: "hidden",
                  scrollbarWidth: "none",
                  "&::-webkit-scrollbar": { display: "none" },
                  py: 0.5,
                  WebkitOverflowScrolling: "touch",
                }}
              >
                {(pageHeader.actions || []).map((act) => (
                  <Button
                    key={act.key}
                    size="small"
                    variant="text"
                    color={act.color || "inherit"}
                    disabled={!!act.disabled}
                    startIcon={act.icon}
                    onClick={() => {
                      act.onClick?.();
                    }}
                    sx={{
                      flex: "0 0 auto",
                      textTransform: "none",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      borderRadius: 2,
                      px: 1.25,
                    }}
                  >
                    {act.label}
                  </Button>
                ))}
              </Box>
            </>
          ) : (
            /* ── Compact: [back?] title | actions icons | ... | menu ── */
            <>
              <Typography
                ref={titleRef}
                variant="h6"
                component="div"
                noWrap
                sx={{
                  fontWeight: 700,
                  letterSpacing: pageHeader.isBrand ? 0.5 : 0.2,
                  cursor: pageHeader.isBrand ? "pointer" : "default",
                  color: pageHeader.isBrand ? "primary.main" : "text.primary",
                  userSelect: "none",
                  // Không flex-grow — nếu grow=1, offsetWidth nuốt hết chỗ trống
                  // → đo free=0 → chỉ còn "..." (bug 0.9.3).
                  flex: "0 1 auto",
                  minWidth: 0,
                  maxWidth: "55%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  mr: 0.5,
                }}
                onClick={() => {
                  if (!pageHeader.isBrand) return;
                  const openedDebug = onBrandClick();
                  if (!openedDebug) navigate("/");
                }}
                title={pageHeader.title}
              >
                {pageHeader.title || "Twelve"}
              </Typography>

              <Box
                ref={actionsBoxRef}
                sx={{
                  flex: "1 1 auto",
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 0.25,
                }}
              >
                {/* v0.9.4: back nằm trong vùng chức năng head (không cạnh title) */}
                {!pageHeader.isBrand && (
                  <IconButton
                    onClick={handleBack}
                    aria-label="Quay lại"
                    title="Quay lại"
                    size="small"
                    sx={{ flexShrink: 0 }}
                  >
                    <ArrowBackIcon />
                  </IconButton>
                )}
                {(pageHeader.actions || []).slice(0, visibleSlots).map((act) => (
                  <IconButton
                    key={act.key}
                    size="small"
                    color={act.color || "default"}
                    disabled={!!act.disabled}
                    onClick={() => act.onClick?.()}
                    aria-label={act.label}
                    title={act.label}
                    sx={{ flexShrink: 0 }}
                  >
                    {act.icon}
                  </IconButton>
                ))}
                {(pageHeader.actions || []).length > visibleSlots && (
                  <IconButton
                    size="small"
                    onClick={() => setHeaderExpanded(true)}
                    aria-label="Thêm chức năng"
                    title="Thêm"
                    sx={{ flexShrink: 0 }}
                  >
                    <MoreHorizIcon />
                  </IconButton>
                )}
              </Box>

              {/* Không dùng edge="end" — margin âm dễ làm tràn ngang viewport */}
              <IconButton
                onClick={() => setOpen(true)}
                aria-label="Mở menu"
                sx={{ flexShrink: 0, ml: 0.25 }}
              >
                <MenuIcon />
              </IconButton>
            </>
          )}
        </Toolbar>
      </AppBar>

      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        PaperProps={{
          sx: {
            width: { xs: "100%", sm: 360 },
            maxWidth: "100%",
            display: "flex",
            flexDirection: "column",
          },
        }}
      >
        {/* ── Header: "Menu" + nút X cùng hàng ── */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            py: 1.5,
            flexShrink: 0,
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <MenuIcon color="action" />
            <Typography variant="h6" fontWeight={700}>
              Menu
            </Typography>
          </Stack>
          <IconButton onClick={() => setOpen(false)} aria-label="Đóng menu" size="small">
            <CloseIcon />
          </IconButton>
        </Box>

        <Divider flexShrink={0} />

        {/* ── Vùng scroll: user + blocks ── */}
        <Box
          sx={{
            flex: "1 1 auto",
            overflowY: "auto",
            px: 2,
            py: 2,
            minHeight: 0,
          }}
        >
          {isLoggedIn && profile && (
            <Box sx={{ mb: 2 }}>
              <Stack
                direction="row"
                spacing={1.5}
                alignItems="center"
                onClick={goToOwnProfile}
                sx={{
                  cursor: "pointer",
                  borderRadius: 1,
                  p: 1.5,
                  bgcolor: "action.hover",
                  border: "1px solid",
                  borderColor: "divider",
                  "&:hover": { bgcolor: "action.selected" },
                }}
              >
                <Avatar src={profile.avatarUrl} sx={{ width: 48, height: 48 }}>
                  {profile.displayName?.[0]}
                </Avatar>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="subtitle1" fontWeight={700} noWrap>
                    {profile.displayName}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    @{profile.tagName?.replace(/^@/, "")}
                  </Typography>
                  {profile.email && (
                    <Typography variant="caption" color="text.secondary" noWrap display="block">
                      {profile.email}
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.disabled" noWrap display="block">
                    UID: {profile.uid}
                  </Typography>
                  {/* v0.8.23: Điểm tài khoản — bấm để xem chi tiết nguồn gốc.
                      stopPropagation để không kích hoạt onClick của cả Stack
                      cha (điều hướng sang trang Profile). */}
                  <Chip
                    size="small"
                    icon={<EmojiEventsIcon fontSize="small" />}
                    label={`Điểm tài khoản: ${formatScore(profile.accountScore || 0)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setScoreAnchorEl(e.currentTarget);
                    }}
                    sx={{ mt: 0.5, cursor: "pointer" }}
                  />
                </Box>
                {profile.accountGroup && (
                  <Chip
                    size="small"
                    label={profile.accountGroup}
                    color={profile.accountGroup === "SA" ? "primary" : "default"}
                  />
                )}
              </Stack>

              <Button
                fullWidth
                variant="outlined"
                color="error"
                startIcon={<LogoutIcon />}
                onClick={handleSignOut}
                sx={{ mt: 1.5, borderRadius: 1, textTransform: "none", fontWeight: 600 }}
              >
                Đăng xuất
              </Button>
            </Box>
          )}

          {/* Lưới 2 cột — tự scroll khi nhiều mục */}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 1.25,
            }}
          >
            {menuItems.map((item) => (
              <MenuBlock
                key={item.key}
                icon={item.icon}
                label={item.label}
                onClick={item.onClick}
                color={item.color}
              />
            ))}
          </Box>
        </Box>

        {/* ── Footer phiên bản: luôn neo dưới, không bị trồi ── */}
        <Box
          sx={{
            flexShrink: 0,
            px: 2,
            py: 1.5,
            borderTop: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
          }}
        >
          <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="center" sx={{ mb: 0.5 }}>
            <InfoOutlinedIcon sx={{ fontSize: 16, color: "text.disabled" }} />
            <Typography variant="caption" color="text.secondary">
              Phiên bản nền tảng
            </Typography>
          </Stack>
          <Typography variant="caption" display="block" textAlign="center" color="text.secondary">
            Frontend: {versions.frontend || "…"}
          </Typography>
          <Typography variant="caption" display="block" textAlign="center" color="text.secondary">
            Backend: {versions.backend || "…"}
          </Typography>
        </Box>
      </Drawer>
      {import.meta.env.DEV && <DebugLogPanel open={debugOpen} onClose={() => setDebugOpen(false)} />}

      {/* v0.8.23 */}
      <AccountScorePopover
        anchorEl={scoreAnchorEl}
        onClose={() => setScoreAnchorEl(null)}
        postsScoreSum={profile?.postsScoreSum || 0}
        positiveScore={profile?.positiveScore || 0}
        accountScore={profile?.accountScore || 0}
      />
    </>
  );
}
