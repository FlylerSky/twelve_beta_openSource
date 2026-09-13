import { createTheme } from "@mui/material/styles";

// Bảng màu lấy cảm hứng từ Material Design 3 (Google) - tông tím chủ đạo cho Twelve
const theme = createTheme({
  palette: {
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
  },
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
          boxShadow: "0px 1px 3px rgba(0,0,0,0.08)",
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
        root: {
          backgroundColor: "#FFFBFE",
          color: "#1C1B1F",
          boxShadow: "0px 1px 2px rgba(0,0,0,0.08)",
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 28,
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

export default theme;
