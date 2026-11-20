import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Container,
  Box,
  Typography,
  Tabs,
  Tab,
  Paper,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Radio,
  Divider,
  Stack,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import TuneIcon from "@mui/icons-material/Tune";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import SettingsBrightnessIcon from "@mui/icons-material/SettingsBrightness";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import Navbar from "../components/Navbar";
import { useThemeMode } from "../context/ThemeModeContext";
import { useRegisterPageHeader } from "../context/PageHeaderContext";
import { useAuth } from "../context/AuthContext";
import AdminEmbedDomainsPanel from "./settings/AdminEmbedDomainsPanel";
import AdminAssetsPanel from "./settings/AdminAssetsPanel";

/**
 * ==== v0.10.5 — Settings ====
 * Đồng bộ khung tab với Xu hướng:
 * - Tab sticky dưới AppBar/headZone, không bọc Paper ngoài.
 * - Nội dung tab vẫn dùng Paper/List bên trong (card tùy chọn).
 * - Nhiều tab cấp 1: scrollable ngang.
 */

function AppTab() {
  const { mode, setMode } = useThemeMode();

  const options = [
    {
      value: "light",
      label: "Sáng",
      icon: <LightModeIcon />,
      desc: "Luôn dùng giao diện sáng, bất kể cài đặt hệ thống.",
    },
    {
      value: "dark",
      label: "Tối",
      icon: <DarkModeIcon />,
      desc: "Luôn dùng giao diện tối, bất kể cài đặt hệ thống.",
    },
    {
      value: "system",
      label: "Theo trình duyệt",
      icon: <SettingsBrightnessIcon />,
      desc: "Tự động theo chế độ Sáng/Tối của trình duyệt hoặc hệ điều hành.",
    },
  ];

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
        Chế độ giao diện
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Chọn cách Twelve hiển thị trên thiết bị này.
      </Typography>

      <Paper variant="outlined" sx={{ borderRadius: 1, overflow: "hidden" }}>
        <List disablePadding>
          {options.map((opt, i) => (
            <React.Fragment key={opt.value}>
              {i > 0 && <Divider component="li" />}
              <ListItemButton
                selected={mode === opt.value}
                onClick={() => setMode(opt.value)}
                sx={{ py: 1.5, px: 2 }}
              >
                <ListItemIcon sx={{ minWidth: 44, color: mode === opt.value ? "primary.main" : "text.secondary" }}>
                  {opt.icon}
                </ListItemIcon>
                <ListItemText
                  primary={opt.label}
                  secondary={opt.desc}
                  primaryTypographyProps={{ fontWeight: mode === opt.value ? 700 : 500 }}
                />
                <Radio checked={mode === opt.value} onChange={() => setMode(opt.value)} sx={{ ml: 1 }} />
              </ListItemButton>
            </React.Fragment>
          ))}
        </List>
      </Paper>
    </Box>
  );
}

const TABS = [
  {
    key: "app",
    label: "Ứng dụng",
    icon: <TuneIcon fontSize="small" />,
    render: () => <AppTab />,
  },
];

// v0.10.15 — tab "Quản trị": CHỈ thêm vào danh sách tab khi tài khoản thuộc
// nhóm SA (xem useAuth().isSA) — người dùng thường không thấy tab này tồn
// tại. Đây là lớp ẩn UI, không phải lớp bảo mật — backend (middleware
// requireSA) mới là nơi thực sự chặn, phòng trường hợp ai đó cố vào thẳng
// URL "/settings/admin" mà không phải SA.
const ADMIN_TAB = {
  key: "admin",
  label: "Quản trị",
  icon: <AdminPanelSettingsIcon fontSize="small" />,
  // v0.10.21: tab gồm nhiều mục quản trị xếp dọc — (1) domain nhúng media, (2) giám sát tài nguyên upload.
  render: () => (
    <Stack spacing={4} divider={<Divider />}>
      <AdminEmbedDomainsPanel />
      <AdminAssetsPanel />
    </Stack>
  ),
};

const TAB_SX = { minHeight: 48, textTransform: "none", fontWeight: 600 };

export default function SettingsPage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const { isSA } = useAuth();
  useRegisterPageHeader({ title: "Cài đặt", isBrand: false, actions: [] });

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const appBarH = isMobile ? 56 : 64;
  const tabH = 48;

  const tabs = isSA ? [...TABS, ADMIN_TAB] : TABS;
  const activeIndex = Math.max(0, tabs.findIndex((t) => t.key === tab));
  const activeTab = tabs[activeIndex];

  const handleChangeTab = (_e, newIndex) => {
    const nextKey = tabs[newIndex]?.key;
    if (nextKey) navigate(`/settings/${nextKey}`, { replace: true });
  };

  return (
    <>
      <Navbar />

      {/* Tab sticky dưới head — cùng pattern Xu hướng */}
      <Box
        sx={{
          position: "sticky",
          top: appBarH,
          zIndex: 11,
          bgcolor: "background.paper",
          borderBottom: "1px solid",
          borderColor: "divider",
          backdropFilter: "blur(10px)",
        }}
      >
        <Container maxWidth="md" disableGutters={isMobile}>
          <Tabs
            value={activeIndex}
            onChange={handleChangeTab}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{ px: { xs: 1, sm: 2 }, minHeight: tabH }}
          >
            {tabs.map((t) => (
              <Tab key={t.key} icon={t.icon} iconPosition="start" label={t.label} sx={TAB_SX} />
            ))}
          </Tabs>
        </Container>
      </Box>

      <Container maxWidth="md" sx={{ py: { xs: 2, sm: 3 }, px: { xs: 1.5, sm: 3 } }}>
        {activeTab?.render()}
      </Container>
    </>
  );
}
