# Twelve Security Status — Twelve 1.1 (0.10.24.1.191126)

Cập nhật: 2026-11-19. Đây là bản backport bảo mật từ Twelve 2.5.3.3 (Beta) về
Twelve 0.10.24 (1.0 Chính thức). Chi tiết xem `PATCH-11-1-NOTES.md`.

## Trạng thái vá (15 lỗ hổng đã vá)

| ID | Mức | Mô tả | Trạng thái |
|---|---|---|---|
| F1 | CRITICAL | DoS sanitize (worker + assessHtml + timeout) | ✅ ĐÃ VÁ |
| A-01 | HIGH | Sập tiến trình bằng id lạ (idParams + unhandledRejection) | ✅ ĐÃ VÁ |
| F2 | HIGH | Multer thiếu giới hạn field | ✅ ĐÃ VÁ |
| F11 | HIGH | file-type ASF infinite loop DoS | ✅ ĐÃ VÁ |
| TW-07/13 | HIGH | Firestore rules lộ config/positiveScoreLogs | ✅ ĐÃ VÁ (deploy rules sau cùng) |
| F4 | MEDIUM | pending/suspended vẫn tính điểm | ✅ ĐÃ VÁ |
| F6 | MEDIUM | token thu hồi còn dùng ~1 giờ | ✅ ĐÃ VÁ (cache 60s) |
| R-01/A-06 | MEDIUM | style color ẩn chữ (transparent/alpha thấp) | ✅ ĐÃ VÁ |
| TW-06 | MEDIUM | class không giới hạn (ẩn chữ qua CSS site) | ✅ ĐÃ VÁ |
| PATCH-2#9 | MEDIUM | link ngoài không ép rel/nofollow | ✅ ĐÃ VÁ |
| TW-10 | MEDIUM | Turnstile không timeout/hostname | ✅ ĐÃ VÁ |
| TW-01 | MEDIUM | rate-limiter khoá IP sai sau Cloudflare | ✅ ĐÃ VÁ |
| F5 | LOW | firebase-admin ^12 (2 CVE HIGH) → ^13.10 | ✅ ĐÃ VÁ (cần Node ≥20) |
| N2/TW-22 | LOW | cookie-parser chết + CORS credentials | ✅ ĐÃ VÁ |
| TW-25 | LOW | updateMe ghi 2 lần (race) | ✅ ĐÃ VÁ |
| G1/TW-02 | — | CSP frontend enforcing (script-src/frame-ancestors) | ✅ ĐÃ VÁ |
| G2/TW-19 | — | Quill clipboard self-XSS | ✅ ĐÃ VÁ |

## Đã biết còn hạn chế (đề xuất Twelve 1.2, không phải lỗ hổng)

- View-score-once-per-pair / share daily cap (F3/TW-03) — cần mô hình dữ liệu mới.
- Email normalization (Gmail dots) — cần migrate + đồng bộ frontend.
- Endpoint quên mật khẩu chưa có → A-03 chưa áp dụng; khi thêm phải có uniform
  response + rate limit + timing-safe.
- Tag name / account deletion / profile visitors chưa có → các vá liên quan chưa áp dụng.

## Kiểm tra định kỳ

- Sau deploy: `npm run test:security` (7 test hồi quy).
- Xem log backend cảnh báo `[sanitize] worker không khả dụng` — nếu xuất hiện
  thường xuyên, kiểm tra Node version (≥20) và jsdom trong worker.
