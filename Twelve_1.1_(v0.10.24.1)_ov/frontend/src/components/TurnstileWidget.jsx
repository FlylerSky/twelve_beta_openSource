import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";

/**
 * ==== VÁ #4 [MEDIUM] — CAPTCHA cho đăng ký (v0.8.3) ====
 *
 * Backend (`middleware/captcha.js#verifyCaptcha`) chỉ bắt buộc `captchaToken`
 * khi biến môi trường `TURNSTILE_SECRET_KEY` được cấu hình — tương ứng,
 * widget này CHỈ hiển thị khi có `VITE_TURNSTILE_SITE_KEY` (site key CÔNG
 * KHAI, khác với secret key ở backend). Nếu chưa cấu hình site key ở
 * frontend, component render `null` và không đòi hỏi gì — đúng thiết kế
 * "tắt mặc định, bật khi có cấu hình" đã dùng ở backend.
 *
 * QUAN TRỌNG: site key và secret key phải cùng 1 cặp Turnstile site trên
 * Cloudflare — nếu bật secret key ở backend mà CHƯA set site key ở đây
 * (hoặc ngược lại), người dùng thật sẽ không đăng ký được (backend luôn đòi
 * token nhưng frontend không có gì để gửi).
 *
 * @param {{ onToken: (token: string|null) => void }} props
 */
const TurnstileWidget = forwardRef(function TurnstileWidget({ onToken }, ref) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  const [scriptReady, setScriptReady] = useState(false);

  // Token Turnstile chỉ DÙNG ĐƯỢC 1 LẦN — sau khi backend verify (dù thành
  // công hay thất bại vì lý do khác, ví dụ email đã tồn tại), token cũ đã bị
  // Cloudflare "đốt". Expose `reset()` để RegisterPage gọi lại sau mỗi lần
  // submit thất bại, buộc người dùng lấy token mới cho lần thử tiếp theo.
  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widgetIdRef.current != null && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
      }
    },
  }));

  // index.html đã nhúng script Turnstile với `async defer`, nên `window.turnstile`
  // có thể chưa sẵn sàng ngay lúc component mount — poll cho tới khi có.
  useEffect(() => {
    if (!siteKey) return;
    if (window.turnstile) {
      setScriptReady(true);
      return;
    }
    const interval = setInterval(() => {
      if (window.turnstile) {
        setScriptReady(true);
        clearInterval(interval);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [siteKey]);

  useEffect(() => {
    if (!siteKey || !scriptReady || !containerRef.current) return;

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: (token) => onToken(token),
      "expired-callback": () => onToken(null),
      "error-callback": () => onToken(null),
    });

    return () => {
      if (widgetIdRef.current != null && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptReady, siteKey]);

  if (!siteKey) {
    // Chưa cấu hình CAPTCHA ở môi trường này — không hiển thị gì, giữ đúng
    // hành vi trước đây (backend cũng sẽ không đòi captchaToken trong TH này).
    return null;
  }

  return (
    <Box>
      <div ref={containerRef} />
      {!scriptReady && (
        <Typography variant="caption" color="text.secondary">
          Đang tải xác minh bảo mật...
        </Typography>
      )}
    </Box>
  );
});

export default TurnstileWidget;
