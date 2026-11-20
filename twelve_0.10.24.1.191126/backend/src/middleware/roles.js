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

// Chặn LLA khỏi các thao tác "sở hữu" tài khoản/nội dung nhạy cảm (RA + SA mới được)
const requireOwnerCapable = requireGroup([ACCOUNT_GROUP.SA, ACCOUNT_GROUP.RA]);

module.exports = { requireGroup, requireSA, requireOwnerCapable };
