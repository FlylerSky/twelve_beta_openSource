import React, { useEffect, useState, useCallback } from "react";
import {
  Container,
  Tabs,
  Tab,
  Box,
  Chip,
  TextField,
  InputAdornment,
  IconButton,
  ToggleButtonGroup,
  ToggleButton,
  Stack,
  Typography,
  CircularProgress,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import WhatshotIcon from "@mui/icons-material/Whatshot";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import TagIcon from "@mui/icons-material/Tag";
import ExploreIcon from "@mui/icons-material/Explore";
import SearchIcon from "@mui/icons-material/Search";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import RankingList from "../components/RankingList";
import HashtagRankingList from "../components/HashtagRankingList";
import HashtagPostList from "../components/HashtagPostList";
import {
  getWeeklyRanking,
  getAllTimeRanking,
  getHashtagWeeklyRanking,
  getHashtagAllTimeRanking,
  getHashtagPosts,
  searchTrending,
} from "../api/trending.api";
import { formatCount, formatScore } from "../utils/number";
import { useSnackbar } from "../context/SnackbarContext";
import { useRegisterPageHeader } from "../context/PageHeaderContext";
import useIncrementalReveal from "../hooks/useIncrementalReveal";

/**
 * ==== v0.10.7 — Xu hướng (sticky CSS thuần) ====
 *
 * Không JS đo scroll / thu maxHeight (gây giật).
 * Tab cha + tab con cùng `position: sticky; top: appBarH`.
 * Khi cuộn: tab con trượt lên và **đè** tab cha (cùng mốc top, z-index cao hơn).
 * Cuộn về đầu: cả hai hiện lại theo thứ tự tài liệu (cha rồi con).
 * Nhiều cấp sau này: mỗi hàng sticky cùng top + z-index tăng dần.
 *
 * ==== v0.10.8 — thêm tab "Hashtag" ====
 * Cấu trúc 3 cấp: Tab cha (Người dùng/Hashtag) → Tab chế độ (Cổ điển/Nâng
 * cao, CHỈ có ở Hashtag) → Tab phạm vi (Tuần qua/Khám phá/Tìm kiếm). Mỗi
 * hàng sticky cùng `top`, z-index tăng dần (11 → 12 → 13) — đúng quy ước đã
 * nêu ở trên. Khi đang xem chi tiết 1 hashtag (danh sách bài viết), ẩn hàng
 * "phạm vi" (không còn ý nghĩa) nhưng vẫn giữ hàng "chế độ" vì nó vẫn quyết
 * định thứ tự bài viết (postScore hay externalPostScore).
 */

const MAIN_TABS = [
  { key: "users", label: "Người dùng", icon: <PersonOutlineIcon /> },
  { key: "hashtag", label: "Hashtag", icon: <TagIcon /> },
];

const USER_SUB_TABS = [
  { key: "weekly", label: "Tuần này", icon: <WhatshotIcon fontSize="small" /> },
  { key: "alltime", label: "Toàn thời gian", icon: <EmojiEventsIcon fontSize="small" /> },
];

const HASHTAG_MODE_TABS = [
  { key: "classic", label: "Cổ điển" },
  { key: "advanced", label: "Nâng cao" },
];

const HASHTAG_SECTION_TABS = [
  { key: "weekly", label: "Tuần qua", icon: <WhatshotIcon fontSize="small" /> },
  { key: "explore", label: "Khám phá", icon: <ExploreIcon fontSize="small" /> },
  { key: "search", label: "Tìm kiếm", icon: <SearchIcon fontSize="small" /> },
];

const TAB_SX = { minHeight: 48, textTransform: "none", fontWeight: 600 };
const TAB_H = 48;

const stickyTabSx = (top, z) => ({
  position: "sticky",
  top,
  zIndex: z,
  minHeight: TAB_H,
  bgcolor: "background.paper",
  borderBottom: "1px solid",
  borderColor: "divider",
  // Nền đặc — không lộ nội dung phía dưới khi đè
  backgroundImage: "none",
});

export default function TrendingPage() {
  useRegisterPageHeader({ title: "Xu hướng", isBrand: false, actions: [] });

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const appBarH = isMobile ? 56 : 64;

  const [searchParams, setSearchParams] = useSearchParams();

  // Đọc trạng thái ban đầu từ URL — cho phép Chip hashtag ở PostCard điều
  // hướng thẳng vào đây (vd. /trending?tab=hashtag&hashtag=%23abc).
  const initialTab = searchParams.get("tab") === "hashtag" ? 1 : 0;
  const [mainTab, setMainTab] = useState(initialTab);
  const [subTab, setSubTab] = useState(0);

  const [hashtagMode, setHashtagMode] = useState(
    searchParams.get("mode") === "advanced" ? "advanced" : "classic"
  );
  const [hashtagSection, setHashtagSection] = useState(() => {
    const s = searchParams.get("section");
    return HASHTAG_SECTION_TABS.some((t) => t.key === s) ? s : "weekly";
  });
  const [selectedHashtag, setSelectedHashtag] = useState(searchParams.get("hashtag") || null);

  const [weeklyData, setWeeklyData] = useState(null);
  const [allTimeData, setAllTimeData] = useState(null);
  const [loadingWeekly, setLoadingWeekly] = useState(false);
  const [loadingAllTime, setLoadingAllTime] = useState(false);

  const [hashtagWeeklyData, setHashtagWeeklyData] = useState({});
  const [hashtagAllTimeData, setHashtagAllTimeData] = useState({});
  const [loadingHashtagWeekly, setLoadingHashtagWeekly] = useState(false);
  const [loadingHashtagAllTime, setLoadingHashtagAllTime] = useState(false);

  const [hashtagPostsData, setHashtagPostsData] = useState(null);
  const [loadingHashtagPosts, setLoadingHashtagPosts] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchType, setSearchType] = useState("post");
  const [searchSort, setSearchSort] = useState("newest");
  const [searchResult, setSearchResult] = useState(null);
  const [loadingSearch, setLoadingSearch] = useState(false);

  const snackbar = useSnackbar();
  const mainKey = MAIN_TABS[mainTab]?.key || "users";
  const subKey = USER_SUB_TABS[subTab]?.key || "weekly";

  // ==== Đồng bộ ngược lại URL (chỉ tab Hashtag cần deep-link vì có thể được
  // mở từ nơi khác qua Chip hashtag) ====
  useEffect(() => {
    if (mainKey !== "hashtag") return;
    const next = new URLSearchParams();
    next.set("tab", "hashtag");
    next.set("mode", hashtagMode);
    if (selectedHashtag) {
      next.set("hashtag", selectedHashtag);
    } else {
      next.set("section", hashtagSection);
    }
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainKey, hashtagMode, hashtagSection, selectedHashtag]);

  const loadWeekly = useCallback(() => {
    setLoadingWeekly(true);
    getWeeklyRanking()
      .then((data) => setWeeklyData(data))
      .catch((err) => {
        snackbar.error(err.message || "Không tải được bảng xếp hạng tuần.");
        setWeeklyData({ ranking: [] });
      })
      .finally(() => setLoadingWeekly(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAllTime = useCallback(() => {
    setLoadingAllTime(true);
    getAllTimeRanking()
      .then((data) => setAllTimeData(data))
      .catch((err) => {
        snackbar.error(err.message || "Không tải được bảng xếp hạng toàn thời gian.");
        setAllTimeData({ ranking: [] });
      })
      .finally(() => setLoadingAllTime(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mainKey !== "users") return;
    if (subKey === "weekly" && weeklyData === null && !loadingWeekly) loadWeekly();
    if (subKey === "alltime" && allTimeData === null && !loadingAllTime) loadAllTime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainKey, subKey, weeklyData, allTimeData, loadingWeekly, loadingAllTime]);

  // ==== Tab Hashtag — Tuần qua / Khám phá ====
  const loadHashtagWeekly = useCallback((mode) => {
    setLoadingHashtagWeekly(true);
    getHashtagWeeklyRanking(mode)
      .then((data) => setHashtagWeeklyData((prev) => ({ ...prev, [mode]: data })))
      .catch((err) => {
        snackbar.error(err.message || "Không tải được bảng xếp hạng Hashtag theo tuần.");
        setHashtagWeeklyData((prev) => ({ ...prev, [mode]: { ranking: [] } }));
      })
      .finally(() => setLoadingHashtagWeekly(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadHashtagAllTime = useCallback((mode) => {
    setLoadingHashtagAllTime(true);
    getHashtagAllTimeRanking(mode)
      .then((data) => setHashtagAllTimeData((prev) => ({ ...prev, [mode]: data })))
      .catch((err) => {
        snackbar.error(err.message || "Không tải được bảng xếp hạng Hashtag toàn thời gian.");
        setHashtagAllTimeData((prev) => ({ ...prev, [mode]: { ranking: [] } }));
      })
      .finally(() => setLoadingHashtagAllTime(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mainKey !== "hashtag" || selectedHashtag) return;
    if (hashtagSection === "weekly" && !hashtagWeeklyData[hashtagMode] && !loadingHashtagWeekly) {
      loadHashtagWeekly(hashtagMode);
    }
    if (hashtagSection === "explore" && !hashtagAllTimeData[hashtagMode] && !loadingHashtagAllTime) {
      loadHashtagAllTime(hashtagMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainKey, selectedHashtag, hashtagSection, hashtagMode, hashtagWeeklyData, hashtagAllTimeData, loadingHashtagWeekly, loadingHashtagAllTime]);

  // ==== Chi tiết 1 Hashtag (top 100 bài viết) ====
  const loadHashtagPosts = useCallback((tag, mode) => {
    setLoadingHashtagPosts(true);
    getHashtagPosts(tag, mode)
      .then((data) => setHashtagPostsData(data))
      .catch((err) => {
        snackbar.error(err.message || "Không tải được danh sách bài viết theo Hashtag.");
        setHashtagPostsData({ tag, posts: [] });
      })
      .finally(() => setLoadingHashtagPosts(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedHashtag) {
      setHashtagPostsData(null);
      return;
    }
    loadHashtagPosts(selectedHashtag, hashtagMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHashtag, hashtagMode]);

  // ==== Tìm kiếm ====
  const runSearch = useCallback((q, type, sort, mode) => {
    if (!q.trim()) {
      setSearchResult(null);
      return;
    }
    setLoadingSearch(true);
    searchTrending({ q, type, sort, mode })
      .then((data) => setSearchResult(data))
      .catch((err) => {
        snackbar.error(err.message || "Tìm kiếm thất bại.");
        setSearchResult({ hashtags: [], posts: [] });
      })
      .finally(() => setLoadingSearch(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce nhẹ khi gõ tìm kiếm — tránh gọi API mỗi ký tự.
  useEffect(() => {
    if (mainKey !== "hashtag" || hashtagSection !== "search") return;
    const t = setTimeout(() => {
      setSearchQuery(searchInput);
      runSearch(searchInput, searchType, searchSort, hashtagMode);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, searchType, searchSort, hashtagMode, mainKey, hashtagSection]);

  // v0.10.8 — đồng bộ NGƯỢC (URL -> state): bắt trường hợp người dùng bấm 1
  // Chip hashtag khác trong lúc ĐANG ở trang Xu hướng (component không bị
  // unmount/remount vì cùng route "/trending" -> state khởi tạo qua useState
  // lazy initializer ở trên chỉ chạy 1 lần, KHÔNG tự đọc lại URL khi URL đổi
  // bởi navigate() từ nơi khác trong chính trang này). Vô hại với chính effect
  // "state -> URL" ở trên vì nó luôn ghi lại ĐÚNG giá trị state hiện có (idempotent).
  useEffect(() => {
    const urlHashtag = searchParams.get("hashtag");
    if (urlHashtag && urlHashtag !== selectedHashtag) {
      if (mainTab !== 1) setMainTab(1);
      setSelectedHashtag(urlHashtag);
      const urlMode = searchParams.get("mode");
      if (urlMode === "advanced" || urlMode === "classic") setHashtagMode(urlMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleSelectHashtag = (tag) => setSelectedHashtag(tag);
  const handleBackFromHashtag = () => {
    setSelectedHashtag(null);
    setHashtagPostsData(null);
  };

  return (
    <>
      <Navbar />

      {/* Tab cha — sticky dưới head */}
      <Box sx={stickyTabSx(appBarH, 11)}>
        <Container maxWidth="md" disableGutters={isMobile}>
          <Tabs
            value={mainTab}
            onChange={(_e, v) => {
              setMainTab(v);
              if (MAIN_TABS[v]?.key !== "hashtag") {
                setSelectedHashtag(null);
                setSearchParams({}, { replace: true });
              }
            }}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{ px: { xs: 1, sm: 2 }, minHeight: TAB_H }}
          >
            {MAIN_TABS.map((t) => (
              <Tab key={t.key} icon={t.icon} iconPosition="start" label={t.label} sx={TAB_SX} />
            ))}
          </Tabs>
        </Container>
      </Box>

      {/* Tab con — CÙNG top với cha, z-index cao hơn → cuộn lên sẽ đè cha */}
      {mainKey === "users" && (
        <Box sx={stickyTabSx(appBarH, 12)}>
          <Container maxWidth="md" disableGutters={isMobile}>
            <Tabs
              value={subTab}
              onChange={(_e, v) => setSubTab(v)}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              sx={{ px: { xs: 1, sm: 2 }, minHeight: TAB_H }}
            >
              {USER_SUB_TABS.map((t) => (
                <Tab key={t.key} icon={t.icon} iconPosition="start" label={t.label} sx={TAB_SX} />
              ))}
            </Tabs>
          </Container>
        </Box>
      )}

      {/* Hashtag — hàng "chế độ" (Cổ điển/Nâng cao) */}
      {mainKey === "hashtag" && (
        <Box sx={stickyTabSx(appBarH, 12)}>
          <Container maxWidth="md" disableGutters={isMobile}>
            <Tabs
              value={HASHTAG_MODE_TABS.findIndex((t) => t.key === hashtagMode)}
              onChange={(_e, v) => setHashtagMode(HASHTAG_MODE_TABS[v].key)}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              sx={{ px: { xs: 1, sm: 2 }, minHeight: TAB_H }}
            >
              {HASHTAG_MODE_TABS.map((t) => (
                <Tab key={t.key} label={t.label} sx={TAB_SX} />
              ))}
            </Tabs>
          </Container>
        </Box>
      )}

      {/* Hashtag — hàng "phạm vi" (Tuần qua/Khám phá/Tìm kiếm) — ẩn khi đang xem chi tiết 1 hashtag */}
      {mainKey === "hashtag" && !selectedHashtag && (
        <Box sx={stickyTabSx(appBarH, 13)}>
          <Container maxWidth="md" disableGutters={isMobile}>
            <Tabs
              value={HASHTAG_SECTION_TABS.findIndex((t) => t.key === hashtagSection)}
              onChange={(_e, v) => setHashtagSection(HASHTAG_SECTION_TABS[v].key)}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              sx={{ px: { xs: 1, sm: 2 }, minHeight: TAB_H }}
            >
              {HASHTAG_SECTION_TABS.map((t) => (
                <Tab key={t.key} icon={t.icon} iconPosition="start" label={t.label} sx={TAB_SX} />
              ))}
            </Tabs>
          </Container>
        </Box>
      )}

      <Container maxWidth="md" sx={{ py: { xs: 2, sm: 3 }, px: { xs: 1.5, sm: 3 } }}>
        {mainKey === "users" && (
          <>
            {subKey === "weekly" && weeklyData?.weekCode && (
              <Box sx={{ mb: 2, textAlign: "center" }}>
                <Chip label={`Tuần ${weeklyData.weekCode}`} size="small" variant="outlined" color="primary" />
              </Box>
            )}
            {subKey === "weekly" && (
              <RankingList
                ranking={weeklyData?.ranking || []}
                scoreField="weeklyGrowth"
                scoreLabel="Điểm tăng tuần này"
                loading={loadingWeekly}
                emptyHint="Chưa có ai tăng điểm trong tuần này."
              />
            )}
            {subKey === "alltime" && (
              <RankingList
                ranking={allTimeData?.ranking || []}
                scoreField="accountScore"
                scoreLabel="Điểm tài khoản"
                loading={loadingAllTime}
                emptyHint="Chưa có dữ liệu xếp hạng."
              />
            )}
          </>
        )}

        {mainKey === "hashtag" && selectedHashtag && (
          <Box>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
              <IconButton size="small" onClick={handleBackFromHashtag} aria-label="Quay lại">
                <ArrowBackIcon fontSize="small" />
              </IconButton>
              <TagIcon color="action" />
              <Typography variant="h6" fontWeight={700} noWrap>
                {hashtagPostsData?.tag || selectedHashtag}
              </Typography>
            </Stack>
            <HashtagPostList
              posts={hashtagPostsData?.posts || []}
              loading={loadingHashtagPosts}
              emptyHint="Chưa có bài viết nào dùng hashtag này."
            />
          </Box>
        )}

        {mainKey === "hashtag" && !selectedHashtag && hashtagSection === "weekly" && (
          <>
            {hashtagWeeklyData[hashtagMode]?.weekCode && (
              <Box sx={{ mb: 2, textAlign: "center" }}>
                <Chip label={`Tuần ${hashtagWeeklyData[hashtagMode].weekCode}`} size="small" variant="outlined" color="primary" />
              </Box>
            )}
            <HashtagRankingList
              ranking={hashtagWeeklyData[hashtagMode]?.ranking || []}
              scoreField="growth"
              scoreLabel="Điểm tăng tuần này"
              loading={loadingHashtagWeekly}
              emptyHint="Chưa có Hashtag nào tăng điểm trong tuần này."
              onSelectHashtag={handleSelectHashtag}
            />
          </>
        )}

        {mainKey === "hashtag" && !selectedHashtag && hashtagSection === "explore" && (
          <HashtagRankingList
            ranking={hashtagAllTimeData[hashtagMode]?.ranking || []}
            scoreField="score"
            scoreLabel="Điểm Hashtag"
            loading={loadingHashtagAllTime}
            emptyHint="Chưa có dữ liệu xếp hạng."
            onSelectHashtag={handleSelectHashtag}
          />
        )}

        {mainKey === "hashtag" && !selectedHashtag && hashtagSection === "search" && (
          <Box>
            <Stack spacing={1.5} sx={{ mb: 2 }}>
              <TextField
                fullWidth
                size="small"
                placeholder="Tìm hashtag hoặc bài viết (tiêu đề, nội dung, tác giả, hashtag)…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={searchType}
                  onChange={(_e, v) => v && setSearchType(v)}
                >
                  <ToggleButton value="post">Bài viết</ToggleButton>
                  <ToggleButton value="hashtag">Hashtag</ToggleButton>
                </ToggleButtonGroup>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={searchSort}
                  onChange={(_e, v) => v && setSearchSort(v)}
                >
                  <ToggleButton value="newest">Mới nhất</ToggleButton>
                  <ToggleButton value="trending">Thịnh hành</ToggleButton>
                </ToggleButtonGroup>
              </Stack>
            </Stack>

            {!searchQuery.trim() ? (
              <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ py: 4 }}>
                Nhập từ khoá để tìm Hashtag hoặc bài viết.
              </Typography>
            ) : loadingSearch ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                <Typography variant="body2" color="text.secondary">
                  Đang tìm kiếm…
                </Typography>
              </Box>
            ) : searchType === "hashtag" ? (
              <SearchHashtagResults
                results={searchResult?.hashtags || []}
                onSelectHashtag={handleSelectHashtag}
              />
            ) : (
              <HashtagPostList
                posts={searchResult?.posts || []}
                loading={false}
                emptyHint="Không tìm thấy bài viết phù hợp."
              />
            )}
          </Box>
        )}
      </Container>
    </>
  );
}

function SearchHashtagResults({ results = [], onSelectHashtag }) {
  // v0.10.8.2 — Hook PHẢI gọi trước mọi return sớm bên dưới (Rules of Hooks).
  const { visibleCount, sentinelRef, hasMore } = useIncrementalReveal(results.length, 20);

  if (!results.length) {
    return (
      <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ py: 4 }}>
        Không tìm thấy Hashtag phù hợp.
      </Typography>
    );
  }
  const visibleResults = results.slice(0, visibleCount);
  return (
    <Stack spacing={1}>
      {visibleResults.map((h) => (
        <Box
          key={h.tag}
          onClick={() => onSelectHashtag?.(h.tag)}
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            py: 1.25,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            cursor: "pointer",
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1}>
            <TagIcon fontSize="small" color="action" />
            <Box>
              <Typography variant="body2" fontWeight={700}>
                {h.tag}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatCount(h.usageCount)} lượt dùng
              </Typography>
            </Box>
          </Stack>
          <Typography variant="body2" fontWeight={700} color="primary.main">
            {formatScore(h.score)}
          </Typography>
        </Box>
      ))}
      {hasMore && (
        <Box ref={sentinelRef} sx={{ display: "flex", justifyContent: "center", py: 1.5 }}>
          <CircularProgress size={18} />
        </Box>
      )}
    </Stack>
  );
}
