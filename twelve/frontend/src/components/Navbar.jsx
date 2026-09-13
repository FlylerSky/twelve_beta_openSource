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
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import LogoutIcon from "@mui/icons-material/Logout";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSnackbar } from "../context/SnackbarContext";
import { useCreatePost } from "../context/CreatePostContext";
import { getBackendVersion, getFrontendVersion } from "../api/version.api";
import DebugLogPanel from "./DebugLogPanel";
import { dlog } from "../utils/debugLog";

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
        bgcolor: "grey.50",
        border: "1px solid",
        borderColor: "divider",
        textAlign: "center",
        transition: "background-color 0.15s, border-color 0.15s",
        "&:hover": {
          bgcolor: "action.hover",
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
  const { isLoggedIn, profile, signOut } = useAuth();
  const { openModal } = useCreatePost();
  const navigate = useNavigate();
  const snackbar = useSnackbar();

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
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, profile?.uid]);

  return (
    <>
      <AppBar position="sticky" elevation={0}>
        <Toolbar sx={{ justifyContent: "space-between" }}>
          <Typography
            variant="h6"
            component="div"
            sx={{ fontWeight: 700, letterSpacing: 0.5, cursor: "pointer", color: "primary.main", userSelect: "none" }}
            onClick={() => {
              const openedDebug = onBrandClick();
              if (!openedDebug) navigate("/");
            }}
            title="Twelve"
          >
            Twelve
          </Typography>
          <IconButton edge="end" onClick={() => setOpen(true)} aria-label="Mở menu">
            <MenuIcon />
          </IconButton>
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
                  bgcolor: "grey.50",
                  border: "1px solid",
                  borderColor: "divider",
                  "&:hover": { bgcolor: "action.hover" },
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
      <DebugLogPanel open={debugOpen} onClose={() => setDebugOpen(false)} />
    </>
  );
}
