import React from "react";
import {
  Box,
  Stack,
  Avatar,
  Typography,
  Paper,
  Chip,
  CircularProgress,
  Divider,
} from "@mui/material";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import WorkspacePremiumIcon from "@mui/icons-material/WorkspacePremium";
import { useNavigate } from "react-router-dom";
import { formatScore } from "../utils/number";
import useIncrementalReveal from "../hooks/useIncrementalReveal";

const MEDAL = [
  { color: "#FFD700", glow: "rgba(255, 215, 0, 0.35)", label: "Vàng" },
  { color: "#C0C0C0", glow: "rgba(192, 192, 192, 0.3)", label: "Bạc" },
  { color: "#CD7F32", glow: "rgba(205, 127, 50, 0.3)", label: "Đồng" },
];

/**
 * Bảng xếp hạng Xu hướng — layout gần Twelve Old:
 * podium top 3 (2 · 1 · 3 trên desktop), list 4–10 / 11–100.
 */
export default function RankingList({
  ranking = [],
  scoreField = "accountScore",
  scoreLabel = "Điểm",
  loading = false,
  emptyHint = "Chưa có dữ liệu xếp hạng.",
}) {
  const navigate = useNavigate();
  const restTier = ranking.filter((u) => u.rank >= 11 && u.rank <= 100);
  // v0.10.8.2 — Hook PHẢI gọi trước mọi return sớm bên dưới (Rules of Hooks).
  const { visibleCount, sentinelRef, hasMore } = useIncrementalReveal(restTier.length, 20);

  if (loading) {
    return (
      <Box sx={{ py: 6, display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5 }}>
        <CircularProgress size={28} />
        <Typography variant="body2" color="text.secondary">
          Đang tải bảng xếp hạng…
        </Typography>
      </Box>
    );
  }

  if (!ranking.length) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
        {emptyHint}
      </Typography>
    );
  }

  const top1 = ranking.find((u) => u.rank === 1);
  const top2 = ranking.find((u) => u.rank === 2);
  const top3 = ranking.find((u) => u.rank === 3);
  const topTier = ranking.filter((u) => u.rank >= 4 && u.rank <= 10);
  const visibleRestTier = restTier.slice(0, visibleCount);

  const scoreOf = (u) => (u ? u[scoreField] || 0 : 0);
  const signedScore = (u) => {
    if (!u) return "0";
    const v = scoreOf(u);
    return scoreField === "weeklyGrowth" && v > 0 ? `+${formatScore(v)}` : formatScore(v);
  };
  const go = (uid) => uid && navigate(`/u/${uid}`);

  return (
    <Box>
      {/* Podium: thứ tự hiển thị 2 — 1 — 3 */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1.15fr 1fr" },
          gap: 1.5,
          alignItems: "end",
          mb: 3,
        }}
      >
        {/* Rank 2 — left on desktop, second on mobile */}
        <Box sx={{ order: { xs: 2, sm: 1 } }}>
          {top2 ? (
            <PodiumCard user={top2} medal={MEDAL[1]} score={signedScore(top2)} scoreLabel={scoreLabel} onClick={() => go(top2.uid)} size="md" />
          ) : (
            <Box sx={{ minHeight: 40 }} />
          )}
        </Box>
        {/* Rank 1 — center */}
        <Box sx={{ order: { xs: 1, sm: 2 } }}>
          {top1 ? (
            <PodiumCard user={top1} medal={MEDAL[0]} score={signedScore(top1)} scoreLabel={scoreLabel} onClick={() => go(top1.uid)} size="lg" />
          ) : null}
        </Box>
        {/* Rank 3 */}
        <Box sx={{ order: { xs: 3, sm: 3 } }}>
          {top3 ? (
            <PodiumCard user={top3} medal={MEDAL[2]} score={signedScore(top3)} scoreLabel={scoreLabel} onClick={() => go(top3.uid)} size="md" />
          ) : (
            <Box sx={{ minHeight: 40 }} />
          )}
        </Box>
      </Box>

      {topTier.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 1, mb: 2, overflow: "hidden" }}>
          <Box sx={{ px: 2, py: 1, bgcolor: "action.hover" }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary">
              Hạng 4 – 10
            </Typography>
          </Box>
          <Divider />
          {topTier.map((u, i) => (
            <RankRow
              key={u.uid}
              user={u}
              score={signedScore(u)}
              scoreLabel={scoreLabel}
              onClick={() => go(u.uid)}
              emphasized
              last={i === topTier.length - 1}
            />
          ))}
        </Paper>
      )}

      {restTier.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 1, overflow: "hidden" }}>
          <Box sx={{ px: 2, py: 1, bgcolor: "action.hover" }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary">
              Hạng 11 – 100
            </Typography>
          </Box>
          <Divider />
          {visibleRestTier.map((u, i) => (
            <RankRow
              key={u.uid}
              user={u}
              score={signedScore(u)}
              scoreLabel={scoreLabel}
              onClick={() => go(u.uid)}
              last={i === visibleRestTier.length - 1 && !hasMore}
            />
          ))}
          {hasMore && (
            <Box ref={sentinelRef} sx={{ display: "flex", justifyContent: "center", py: 1.5 }}>
              <CircularProgress size={18} />
            </Box>
          )}
        </Paper>
      )}
    </Box>
  );
}

function PodiumCard({ user, medal, score, scoreLabel, onClick, size = "md" }) {
  const lg = size === "lg";
  return (
    <Paper
      onClick={onClick}
      variant="outlined"
      sx={{
        p: lg ? 2.25 : 1.75,
        textAlign: "center",
        cursor: "pointer",
        borderRadius: 1,
        borderColor: medal.color,
        borderWidth: lg ? 2 : 1,
        boxShadow: `0 0 0 1px ${medal.glow}`,
        transition: "transform 0.15s, box-shadow 0.15s",
        "&:hover": { transform: "translateY(-3px)", boxShadow: `0 6px 20px ${medal.glow}` },
      }}
    >
      <EmojiEventsIcon sx={{ color: medal.color, fontSize: lg ? 36 : 28, mb: 0.5 }} />
      <Avatar
        src={user.avatarUrl}
        sx={{
          width: lg ? 72 : 56,
          height: lg ? 72 : 56,
          mx: "auto",
          mb: 1,
          border: `2px solid ${medal.color}`,
        }}
      >
        {user.displayName?.[0]}
      </Avatar>
      <Typography variant={lg ? "subtitle1" : "body2"} fontWeight={700} noWrap>
        #{user.rank} {user.displayName || "(Ẩn danh)"}
      </Typography>
      {user.tagName && (
        <Typography variant="caption" color="text.secondary" display="block" noWrap>
          {user.tagName.startsWith("@") ? user.tagName : `@${user.tagName}`}
        </Typography>
      )}
      <Typography
        variant={lg ? "h5" : "h6"}
        fontWeight={800}
        sx={{ mt: 0.75, color: medal.color, lineHeight: 1.2 }}
      >
        {score}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {scoreLabel}
      </Typography>
    </Paper>
  );
}

function RankRow({ user, score, scoreLabel, onClick, emphasized = false, last = false }) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.25}
      onClick={onClick}
      sx={{
        px: 1.75,
        py: emphasized ? 1.15 : 0.85,
        cursor: "pointer",
        borderBottom: last ? "none" : "1px solid",
        borderColor: "divider",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Typography
        variant="body2"
        fontWeight={700}
        color="text.secondary"
        sx={{ width: 28, flexShrink: 0, textAlign: "center", fontVariantNumeric: "tabular-nums" }}
      >
        {user.rank}
      </Typography>
      <Avatar src={user.avatarUrl} sx={{ width: emphasized ? 40 : 32, height: emphasized ? 40 : 32 }}>
        {user.displayName?.[0]}
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant={emphasized ? "subtitle2" : "body2"} fontWeight={emphasized ? 700 : 500} noWrap>
          {user.displayName || "(Ẩn danh)"}
        </Typography>
        {user.tagName && (
          <Typography variant="caption" color="text.secondary" noWrap display="block">
            {user.tagName.startsWith("@") ? user.tagName : `@${user.tagName}`}
          </Typography>
        )}
      </Box>
      <Box sx={{ textAlign: "right", flexShrink: 0 }}>
        <Typography variant="body2" fontWeight={700} color={emphasized ? "primary.main" : "text.primary"}>
          {score}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
          {scoreLabel}
        </Typography>
      </Box>
    </Stack>
  );
}
