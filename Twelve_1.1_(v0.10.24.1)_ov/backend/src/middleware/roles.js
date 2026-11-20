const { ACCOUNT_GROUP } = require("../utils/constants");

// requireGroup(["SA"]) -> chỉ cho phép các nhóm được liệt kê
function requireGroup(allowedGroups = []) {
  return (req, res, next) => {
    if (!req.authUser) {
      return res.status(401).json({ error: "Bạn cần đăng nhập." });
    }
    if (!allowedGroups.includes(req.authUser.accountGroup)) {
      return res.status(403).json({ error: "Bạn không có quyền thực hiện thao tác này." });
    }
    next();
  };
}

// Chỉ SA (Admin/Dev/Kiểm duyệt) mới được dùng, ví dụ trang Blog
const requireSA = requireGroup([ACCOUNT_GROUP.SA]);

// v1.1 [TW-17 — vá từ 2.5.3]: ĐÃ XOÁ `requireOwnerCapable` (RA + SA) — không route nào gọi nó (0 nơi dùng), nên nó tạo cảm giác sai là "LLA đã bị chặn ở các thao tác sở hữu" trong khi thực tế LLA chỉ bị chặn
// bởi các lớp khác (requireActive, kiểm quyền sở hữu theo uid ở controller). Nếu route mới cần chặn LLA, gọi tường minh `requireGroup([ACCOUNT_GROUP.SA, ACCOUNT_GROUP.RA])` tại route đó.
module.exports = { requireGroup, requireSA };
