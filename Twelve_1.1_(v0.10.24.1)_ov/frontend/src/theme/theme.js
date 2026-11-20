import { createTheme } from "@mui/material/styles";

/**
 * ==== v0.9.0 — Dark Mode ====
 * Trước đây file này export thẳng 1 theme SÁNG duy nhất. Từ v0.9.0, đổi
 * thành factory `createAppTheme(mode)` — nhận "light" hoặc "dark" (giá trị
 * ĐÃ ĐƯỢC PHÂN GIẢI — "Theo trình duyệt" được resolve thành light/dark cụ
 * thể ở `context/ThemeModeContext.jsx` trước khi gọi hàm này, bản thân hàm
 * này không biết gì về "system").
 *
 * Bảng màu SÁNG giữ nguyên y hệt bản gốc (đã tối ưu qua nhiều bản Beta,
 * không đổi). Bảng màu TỐI chọn tông "surface" xám-tím đậm (không dùng đen
 * tuyệt đối #000 — dễ chói/mỏi mắt và làm mất phân lớp giữa các Card/Paper)
 * theo đúng tinh thần Material Design 3 dark surfaces.
 */

const SHARED = {
  shape: {
    borderRadius: 16,
  },
  typography: {
    fontFamily: '"Google Sans", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontWeight: 500 },
    h2: { fontWeight: 500 },
    h3: { fontWeight: 500 },
    h4: { fontWeight: 500 },
    h5: { fontWeight: 500 },
    h6: { fontWeight: 500 },
    button: { textTransform: "none", fontWeight: 500 },
  },
};

function paletteFor(mode) {
  if (mode === "dark") {
    return {
      mode: "dark",
      primary: {
        main: "#D0BCFF", // sáng hơn bản light để đủ tương phản trên nền tối
        light: "#EADDFF",
        dark: "#4F378B",
        contrastText: "#381E72",
      },
      secondary: {
        main: "#CCC2DC",
        light: "#E8DEF8",
        contrastText: "#332D41",
      },
      error: {
        main: "#F2B8B5",
      },
      background: {
        default: "#141218",
        paper: "#1D1B20",
      },
      text: {
        primary: "#E6E1E9",
        secondary: "#CAC4D0",
      },
      divider: "rgba(230, 225, 233, 0.12)",
    };
  }

  return {
    mode: "light",
    primary: {
      main: "#6750A4",
      light: "#EADDFF",
      dark: "#4F378B",
      contrastText: "#FFFFFF",
    },
    secondary: {
      main: "#625B71",
      light: "#E8DEF8",
      contrastText: "#FFFFFF",
    },
    error: {
      main: "#B3261E",
    },
    background: {
      default: "#FFFBFE",
      paper: "#FFFFFF",
    },
    text: {
      primary: "#1C1B1F",
      secondary: "#49454F",
    },
  };
}

/**
 * @param {"light"|"dark"} mode - giá trị ĐÃ ĐƯỢC PHÂN GIẢI (không nhận "system")
 */
export function createAppTheme(mode) {
  const resolvedMode = mode === "dark" ? "dark" : "light";
  const palette = paletteFor(resolvedMode);

  return createTheme({
    ...SHARED,
    palette,
    components: {
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 100 }, // nút bo tròn kiểu Material You
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 20,
            boxShadow:
              resolvedMode === "dark" ? "0px 1px 3px rgba(0,0,0,0.4)" : "0px 1px 3px rgba(0,0,0,0.08)",
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none" },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          // v0.9.0: dùng callback nhận theme thay vì hex cố định — để AppBar
          // tự đổi màu đúng theo mode thay vì luôn hiện màu SÁNG (bug nếu để
          // hardcode "#FFFBFE"/"#1C1B1F" như bản cũ).
          root: ({ theme }) => ({
            backgroundColor: theme.palette.background.paper,
            color: theme.palette.text.primary,
            boxShadow: resolvedMode === "dark" ? "0px 1px 2px rgba(0,0,0,0.4)" : "0px 1px 2px rgba(0,0,0,0.08)",
          }),
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            // v0.9.1: bo góc vừa (16) — đồng bộ Menu/Settings, tránh “viên thuốc” quá tròn
            borderRadius: 16,
            // Trên mobile mặc định MUI chừa margin 32px mỗi bên → hộp bị hẹp.
            // Giảm margin xuống 8px và cho phép rộng gần full màn hình.
            margin: 8,
            width: "calc(100% - 16px)",
            maxHeight: "calc(100% - 16px)",
          },
          paperFullScreen: {
            borderRadius: 0,
            margin: 0,
            width: "100%",
            maxHeight: "100%",
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 8 },
        },
      },
    },
  });
}

// Giữ export mặc định (theme SÁNG) để bất kỳ import cũ nào còn sót
// (`import theme from "./theme/theme"`) không bị vỡ trong lúc chuyển đổi.
const theme = createAppTheme("light");
export default theme;
