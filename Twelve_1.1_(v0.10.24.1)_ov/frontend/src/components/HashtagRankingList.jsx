import React from "react";
import {
  Box,
  Stack,
  Typography,
  Paper,
  CircularProgress,
  Divider,
} from "@mui/material";
import TagIcon from "@mui/icons-material/Tag";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { formatScore, formatCount } from "../utils/number";
import useIncrementalReveal from "../hooks/useIncrementalReveal";

const MEDAL = [
  { color: "#FFD700", glow: "rgba(255, 215, 0, 0.35)", label: "Vàng" },
  { color: "#C0C0C0", glow: "rgba(192, 192, 192, 0.3)", label: "Bạc" },
  { color: "#CD7F32", glow: "rgba(205, 127, 50, 0.3)", label: "Đồng" },
];

/**
 * ==== v0.10.8 — Bảng xếp hạng Hashtag (tab Xu hướng) ====
 * Cùng layout podium + list như RankingList (dùng cho tab Người dùng), chỉ
 * khác: không có avatar/uid — thay bằng icon # + tên hashtag, và click vào
 * 1 hashtag gọi `onSelectHashtag(tag)` (mở danh sách bài viết của hashtag đó)
 * thay vì điều hướng sang trang hồ sơ.
 */
export default function HashtagRankingList({
  ranking = [],
  scoreField = "growth",
  scoreLabel = "Điểm tăng tuần này",
  loading = false,
  emptyHint = "Chưa có dữ liệu xếp hạng.",
  onSelectHashtag,
}) {
  const restTier = ranking.filter((h) => h.rank >= 11 && h.rank <= 100);
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

  const top1 = ranking.find((h) => h.rank === 1);
  const top2 = ranking.find((h) => h.rank === 2);
  const top3 = ranking.find((h) => h.rank === 3);
  const topTier = ranking.filter((h) => h.rank >= 4 && h.rank <= 10);
  const visibleRestTier = restTier.slice(0, visibleCount);

  const scoreOf = (h) => (h ? h[scoreField] || 0 : 0);
  const signedScore = (h) => {
    if (!h) return "0";
    const v = scoreOf(h);
    return scoreField === "growth" && v > 0 ? `+${formatScore(v)}` : formatScore(v);
  };
  const go = (h) => h?.tag && onSelectHashtag?.(h.tag);

  return (
    <Box>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1.15fr 1fr" },
          gap: 1.5,
          alignItems: "end",
          mb: 3,
        }}
      >
        <Box sx={{ order: { xs: 2, sm: 1 } }}>
          {top2 ? (
            <PodiumCard hashtag={top2} medal={MEDAL[1]} score={signedScore(top2)} scoreLabel={scoreLabel} onClick={() => go(top2)} size="md" />
          ) : (
            <Box sx={{ minHeight: 40 }} />
          )}
        </Box>
        <Box sx={{ order: { xs: 1, sm: 2 } }}>
          {top1 ? (
            <PodiumCard hashtag={top1} medal={MEDAL[0]} score={signedScore(top1)} scoreLabel={scoreLabel} onClick={() => go(top1)} size="lg" />
          ) : null}
        </Box>
        <Box sx={{ order: { xs: 3, sm: 3 } }}>
          {top3 ? (
            <PodiumCard hashtag={top3} medal={MEDAL[2]} score={signedScore(top3)} scoreLabel={scoreLabel} onClick={() => go(top3)} size="md" />
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
          {topTier.map((h, i) => (
            <RankRow
              key={h.tag}
              hashtag={h}
              score={signedScore(h)}
              scoreLabel={scoreLabel}
              onClick={() => go(h)}
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
          {visibleRestTier.map((h, i) => (
            <RankRow
              key={h.tag}
              hashtag={h}
              score={signedScore(h)}
              scoreLabel={scoreLabel}
              onClick={() => go(h)}
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

function TagAvatar({ size, color }) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "action.hover",
        border: color ? `2px solid ${color}` : "1px solid",
        borderColor: color || "divider",
        flexShrink: 0,
      }}
    >
      <TagIcon sx={{ fontSize: size * 0.55, color: color || "text.secondary" }} />
    </Box>
  );
}

function PodiumCard({ hashtag, medal, score, scoreLabel, onClick, size = "md" }) {
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
      <Box sx={{ mx: "auto", mb: 1, width: "fit-content" }}>
        <TagAvatar size={lg ? 72 : 56} color={medal.color} />
      </Box>
      <Typography variant={lg ? "subtitle1" : "body2"} fontWeight={700} noWrap>
        #{hashtag.rank} {hashtag.tag}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" noWrap>
        {formatCount(hashtag.usageCount)} lượt dùng
      </Typography>
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

function RankRow({ hashtag, score, scoreLabel, onClick, emphasized = false, last = false }) {
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
        {hashtag.rank}
      </Typography>
      <TagAvatar size={emphasized ? 40 : 32} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant={emphasized ? "subtitle2" : "body2"} fontWeight={emphasized ? 700 : 500} noWrap>
          {hashtag.tag}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap display="block">
          {formatCount(hashtag.usageCount)} lượt dùng
        </Typography>
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
