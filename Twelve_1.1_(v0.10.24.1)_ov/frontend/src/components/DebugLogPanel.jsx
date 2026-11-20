import React, { useEffect, useState, useMemo } from "react";
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Stack,
  Button,
  Chip,
  FormControlLabel,
  Switch,
  TextField,
  Divider,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  getDebugEntries,
  clearDebugLog,
  subscribeDebugLog,
  isDebugEnabled,
  setDebugEnabled,
  exportDebugLogText,
  dlog,
  snapshotAuth,
} from "../utils/debugLog";
import { useAuth } from "../context/AuthContext";
import { auth } from "../firebase";

const LEVEL_COLOR = {
  error: "error",
  warn: "warning",
  info: "info",
  debug: "default",
};

/**
 * Panel log ẩn — mở bằng 7 lần bấm "Twelve" trên AppBar (Navbar).
 */
export default function DebugLogPanel({ open, onClose }) {
  const [entries, setEntries] = useState(() => getDebugEntries());
  const [filter, setFilter] = useState("");
  const [consoleMirror, setConsoleMirror] = useState(() => isDebugEnabled());
  const authCtx = useAuth();

  useEffect(() => subscribeDebugLog(setEntries), []);

  useEffect(() => {
    if (open) {
      dlog.info("ui", "Debug panel opened", snapshotAuth({
        isLoggedIn: authCtx?.isLoggedIn,
        hasSession: authCtx?.hasSession,
        loadingProfile: authCtx?.loadingProfile,
        profileError: authCtx?.profileError,
        profileStatus: authCtx?.profile?.status,
        isAuthReady: authCtx?.isAuthReady,
        isPending: authCtx?.isPending,
      }));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.message.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        e.level.toLowerCase().includes(q) ||
        (e.data && JSON.stringify(e.data).toLowerCase().includes(q))
    );
  }, [entries, filter]);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(exportDebugLogText());
      dlog.info("ui", "Copied debug log to clipboard");
    } catch (e) {
      dlog.error("ui", "Copy failed", e);
    }
  };

  const dumpAuth = () => {
    dlog.info("auth", "MANUAL AUTH DUMP", {
      ctx: {
        isLoggedIn: authCtx?.isLoggedIn,
        hasSession: authCtx?.hasSession,
        isAuthReady: authCtx?.isAuthReady,
        loadingProfile: authCtx?.loadingProfile,
        profileError: authCtx?.profileError,
        isPending: authCtx?.isPending,
        profile: authCtx?.profile
          ? {
              uid: authCtx.profile.uid,
              status: authCtx.profile.status,
              tagName: authCtx.profile.tagName,
              accountGroup: authCtx.profile.accountGroup,
            }
          : null,
      },
      firebase: snapshotAuth(),
      currentUserEmailVerified: auth.currentUser?.emailVerified,
    });
  };

  return (
    <Drawer anchor="bottom" open={open} onClose={onClose} PaperProps={{ sx: { height: "70vh" } }}>
      <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", height: "100%", gap: 1 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle1" fontWeight={700}>
            Twelve Debug Log
          </Typography>
          <IconButton size="small" onClick={onClose} aria-label="Đóng">
            <CloseIcon />
          </IconButton>
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={consoleMirror}
                onChange={(_, v) => {
                  setConsoleMirror(v);
                  setDebugEnabled(v);
                }}
              />
            }
            label="Mirror console"
          />
          <Button size="small" startIcon={<ContentCopyIcon />} onClick={copyAll}>
            Copy
          </Button>
          <Button size="small" startIcon={<DeleteOutlineIcon />} onClick={() => clearDebugLog()}>
            Xóa log
          </Button>
          <Button size="small" variant="outlined" onClick={dumpAuth}>
            Dump auth
          </Button>
        </Stack>

        <TextField
          size="small"
          placeholder="Lọc (auth, api, isLoggedIn…)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          fullWidth
        />

        <Typography variant="caption" color="text.secondary">
          {filtered.length}/{entries.length} entries · Bấm 7× &quot;Twelve&quot; để mở/đóng
        </Typography>
        <Divider />

        <Box sx={{ flex: 1, overflow: "auto", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
          {[...filtered].reverse().map((e) => (
            <Box
              key={e.id}
              sx={{
                py: 0.75,
                borderBottom: "1px solid",
                borderColor: "divider",
              }}
            >
              <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip label={e.level} size="small" color={LEVEL_COLOR[e.level] || "default"} />
                <Chip label={e.category} size="small" variant="outlined" />
                <Typography variant="caption" color="text.secondary">
                  {e.ts}
                </Typography>
              </Stack>
              <Typography variant="body2" sx={{ mt: 0.25, wordBreak: "break-word" }}>
                {e.message}
              </Typography>
              {e.data !== undefined && (
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    mt: 0.5,
                    p: 1,
                    bgcolor: "action.hover",
                    borderRadius: 1,
                    overflow: "auto",
                    maxHeight: 160,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {JSON.stringify(e.data, null, 2)}
                </Box>
              )}
            </Box>
          ))}
          {filtered.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              Chưa có log.
            </Typography>
          )}
        </Box>
      </Box>
    </Drawer>
  );
}
