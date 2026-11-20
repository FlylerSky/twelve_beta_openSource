/**
 * ==== v0.10.10 — API root / discovery map ====
 *
 * Trước bản này, GET "/" trên backend (khác domain frontend — xem
 * frontend/middleware.js, middleware CHỈ rewrite "/post/:path*" và
 * "/blog/:path*" sang backend, KHÔNG rewrite "/") rơi thẳng xuống handler
 * 404 chung ở server.js — ai/bot/AI agent gọi thẳng vào domain backend chỉ
 * thấy trống trơn.
 *
 * Nội dung trả về ở ĐÂY (và chỉ ở đây — các response nghiệp vụ khác vẫn giữ
 * tiếng Việt vì hiển thị trực tiếp cho người dùng thật trên UI) dùng tiếng
 * Anh, theo đúng quy ước phổ biến của "API root" (vd. api.github.com/) —
 * mục tiêu là để con người VÀ AI agent/LLM tự khám phá được bề mặt API của
 * Twelve mà không cần tài liệu ngoài.
 *
 * Đây KHÔNG phải OpenAPI/Swagger đầy đủ (không mô tả schema request/response
 * chi tiết từng field) — chỉ là 1 "bản đồ" liệt kê method + path + mô tả +
 * yêu cầu xác thực cho từng nhóm tài nguyên, đủ để 1 agent biết "có gì" và
 * "gọi vào đâu" trước khi đọc code/README chi tiết hơn nếu cần.
 *
 * Danh sách endpoint dưới đây được liệt kê THỦ CÔNG, đối chiếu trực tiếp với
 * các file routes/*.js — khi thêm/sửa/xoá route, NHỚ cập nhật file này theo,
 * nếu không "bản đồ" sẽ nói sai với thực tế.
 */

const pkg = require("../../package.json");

function getApiRoot(req, res) {
  const backendVersion = process.env.BACKEND_VERSION || pkg.version || "0.1.0";
  const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/$/, "") || null;

  const body = {
    name: "Twelve API",
    description:
      "Twelve is a social content platform (posts, blogs, reactions, comments, hashtag & user trending rankings). This is the machine-readable map of its public HTTP API.",
    version: backendVersion,
    status: "ok",
    frontend_url: frontendUrl,
    health_check: { method: "GET", path: "/health" },

    authentication: {
      type: "Bearer token (Firebase ID token)",
      header: "Authorization: Bearer <idToken>",
      notes:
        "Sign-in itself happens client-side against Firebase (this backend has no password-based login endpoint). Obtain an ID token via the Firebase Auth REST API or SDK with a Firebase Web API key, then send it as a Bearer token on every authenticated request below. Endpoints not marked 'auth: none' or 'auth: optional' require this header.",
    },

    conventions: {
      base_path: "/api",
      response_format: "JSON for all /api/* routes.",
      errors: "JSON body { \"error\": \"<message>\" } with a non-2xx HTTP status.",
      pagination:
        "List endpoints (posts, blogs) use cursor-based pagination via a 'cursor' query param and return a 'nextCursor' field; pass it back to fetch the next page.",
      rate_limiting:
        "All /api/* routes are rate-limited per IP (and per authenticated user on write actions). Sensitive routes (auth, react, comment, share, profile writes) have stricter limits. Exceeding a limit returns HTTP 429.",
    },

    resources: {
      auth: {
        base: "/api/auth",
        endpoints: [
          { method: "POST", path: "/api/auth/register", auth: "none", description: "Register a new account. Requires a CAPTCHA token." },
          { method: "GET", path: "/api/auth/check-tagname", auth: "none", description: "Check whether a @tagName is available." },
          { method: "POST", path: "/api/auth/activation/sync", auth: "required (pending account allowed)", description: "Sync account status from 'pending' to 'active' after Firebase email verification." },
        ],
      },
      users: {
        base: "/api/users",
        endpoints: [
          { method: "GET", path: "/api/users/me", auth: "required (pending account allowed)", description: "Get the authenticated user's own profile." },
          { method: "PATCH", path: "/api/users/me", auth: "required (active account)", description: "Update the authenticated user's own profile." },
          { method: "POST", path: "/api/users/me/avatar", auth: "required (active account)", description: "Upload/replace the authenticated user's avatar. multipart/form-data, field name 'avatar', max 10MB." },
          { method: "GET", path: "/api/users/:uid", auth: "none", description: "Get a user's public profile." },
        ],
      },
      posts: {
        base: "/api/posts",
        description: "Short-form posts shown on the INDEX page.",
        endpoints: [
          { method: "GET", path: "/api/posts", auth: "optional", description: "List posts, newest first, cursor-paginated." },
          { method: "POST", path: "/api/posts", auth: "required (active account)", description: "Create a post." },
          { method: "GET", path: "/api/posts/:id", auth: "optional", description: "Get a single post." },
          { method: "PATCH", path: "/api/posts/:id", auth: "required (owner, active account)", description: "Update a post." },
          { method: "DELETE", path: "/api/posts/:id", auth: "required (owner, active account)", description: "Delete a post." },
          { method: "POST", path: "/api/posts/:id/react", auth: "required (active account)", description: "Like or dislike a post. Body: { \"type\": \"like\" | \"dislike\" }." },
          { method: "POST", path: "/api/posts/:id/share", auth: "optional", description: "Create a signed share link for a post." },
          { method: "GET", path: "/api/posts/:id/comments", auth: "none", description: "List comments on a post." },
          { method: "POST", path: "/api/posts/:id/comments", auth: "required (active account)", description: "Add a comment to a post." },
          { method: "PATCH", path: "/api/posts/:id/comments/:commentId", auth: "required (owner, active account)", description: "Edit a comment." },
          { method: "DELETE", path: "/api/posts/:id/comments/:commentId", auth: "required (owner, active account)", description: "Delete a comment." },
        ],
      },
      blogs: {
        base: "/api/blogs",
        description: "Long-form articles shown on the BLOG page. Writing (create/update/delete) is restricted to staff accounts (Admin/Dev/Moderator); reading, reacting, sharing and commenting are open to everyone like posts.",
        endpoints: [
          { method: "GET", path: "/api/blogs", auth: "optional", description: "List published blogs, newest first, cursor-paginated." },
          { method: "POST", path: "/api/blogs", auth: "required (staff only)", description: "Create a blog." },
          { method: "GET", path: "/api/blogs/:id", auth: "optional", description: "Get a single blog." },
          { method: "PATCH", path: "/api/blogs/:id", auth: "required (staff only)", description: "Update a blog." },
          { method: "DELETE", path: "/api/blogs/:id", auth: "required (staff only)", description: "Delete a blog." },
          { method: "POST", path: "/api/blogs/:id/react", auth: "required (active account)", description: "Like or dislike a blog." },
          { method: "POST", path: "/api/blogs/:id/share", auth: "optional", description: "Create a signed share link for a blog." },
          { method: "GET", path: "/api/blogs/:id/comments", auth: "none", description: "List comments on a blog." },
          { method: "POST", path: "/api/blogs/:id/comments", auth: "required (active account)", description: "Add a comment to a blog." },
          { method: "PATCH", path: "/api/blogs/:id/comments/:commentId", auth: "required (owner, active account)", description: "Edit a comment." },
          { method: "DELETE", path: "/api/blogs/:id/comments/:commentId", auth: "required (owner, active account)", description: "Delete a comment." },
        ],
      },
      trending: {
        base: "/api/trending",
        description: "Ranking and discovery endpoints behind the 'Trending' page: user leaderboards and a hashtag directory (usage, score, growth, search).",
        endpoints: [
          { method: "GET", path: "/api/trending/users/weekly", auth: "optional", description: "Top 100 users by score growth in the current week." },
          { method: "GET", path: "/api/trending/users/alltime", auth: "optional", description: "Top 100 users by all-time account score." },
          { method: "GET", path: "/api/trending/hashtags/weekly", auth: "optional", description: "Top 100 hashtags by score growth in the current week. Query: mode=classic|advanced." },
          { method: "GET", path: "/api/trending/hashtags/alltime", auth: "optional", description: "Top 100 hashtags by all-time usage/score. Query: mode=classic|advanced." },
          { method: "GET", path: "/api/trending/hashtags/:tag/posts", auth: "optional", description: "Top 100 posts/blogs for one hashtag. Query: mode=classic|advanced." },
          { method: "GET", path: "/api/trending/search", auth: "optional", description: "Search hashtags or posts/blogs. Query: q, type=hashtag|post, sort=newest|trending, mode=classic|advanced." },
        ],
        notes:
          "mode=classic ranks by postScore (all engagement). mode=advanced ranks by externalPostScore (engagement from other accounts only — resistant to self-interaction farming).",
      },
      countries: {
        base: "/api/countries",
        endpoints: [{ method: "GET", path: "/api/countries", auth: "none", description: "List countries (used by profile/registration forms)." }],
      },
      version: {
        base: "/api/version",
        endpoints: [{ method: "GET", path: "/api/version", auth: "none", description: "Current backend version string." }],
      },
      admin: {
        base: "/api/admin",
        description: "Staff-only platform administration. Every endpoint here requires an active account in the SA group (Admin/Dev/Moderator).",
        endpoints: [
          { method: "GET", path: "/api/admin/embed-domains", auth: "required (SA only)", description: "Get the current iframe embed domain allowlist (enabled flag + domain list) used when sanitizing post/blog content." },
          { method: "PUT", path: "/api/admin/embed-domains", auth: "required (SA only)", description: "Replace the iframe embed domain allowlist. Body: { enabled: boolean, domains: [{ domain, label? }] }. Triggers a safe re-scan of all existing posts/blogs to retroactively strip iframes from domains no longer allowed." },
        ],
      },
    },

    content_pages: {
      description:
        "Server-rendered (non-JS) HTML pages for a single post/blog — full content, author, hashtags and stats baked into the HTML, meant to be read directly by crawlers and AI agents without executing JavaScript. The interactive comment section is web-app only.",
      endpoints: [
        { method: "GET", path: "/post/:id", description: "Server-rendered HTML view of a single post." },
        { method: "GET", path: "/blog/:id", description: "Server-rendered HTML view of a single blog." },
      ],
    },
  };

  // Static, không phụ thuộc Firestore — có thể cache ngắn ở CDN/proxy phía
  // trước mà không lo dữ liệu cũ (nội dung chỉ đổi khi deploy code mới).
  res.set("Cache-Control", "public, max-age=300");
  return res.json(body);
}

module.exports = { getApiRoot };
