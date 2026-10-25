const { ASSET_ROOT_FOLDER } = require("./constants");

/**
 * v0.10.20 — Tiện ích thuần (không phụ thuộc Firebase/Cloudinary SDK) để:
 *  - dựng public_id CỐ ĐỊNH cho avatar của 1 user
 *  - tách public_id ngược lại từ một URL Cloudinary đã lưu trong Firestore
 *
 * Tách riêng để script dọn rác và unit test dùng chung mà không cần kết nối gì.
 */

// public_id cố định của avatar: mỗi user CHỈ CÓ ĐÚNG 1 asset, upload lại = ghi đè.
function avatarPublicId(uid) {
  return `${ASSET_ROOT_FOLDER}/avatars/${uid}/avatar`;
}

// Tiền tố thư mục avatar của 1 user (gồm cả asset kiểu cũ có public_id ngẫu nhiên).
function avatarFolderPrefix(uid) {
  return `${ASSET_ROOT_FOLDER}/avatars/${uid}/`;
}

// Firestore không cho "/" trong document id.
function assetDocId(publicId) {
  return String(publicId).replace(/\//g, "__");
}

// Đoạn giống "transformation" của Cloudinary: w_512,h_512,c_fill / f_auto / q_auto ...
function looksLikeTransformation(seg) {
  return /^[a-z]{1,3}_[^/]*$/i.test(seg);
}

/**
 * Tách thông tin từ URL Cloudinary.
 * Hỗ trợ: https://res.cloudinary.com/<cloud>/image/upload/[transformations/][v123/]<public_id>[.ext]
 * Trả về null nếu không phải URL Cloudinary dạng delivery.
 */
function parseCloudinaryUrl(url) {
  if (typeof url !== "string" || !url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)cloudinary\.com$/i.test(u.hostname)) return null;

  const m = u.pathname.match(/^\/([^/]+)\/(image|video|raw)\/(upload|authenticated|private)\/(.+)$/);
  if (!m) return null;

  let segs;
  try {
    segs = m[4].split("/").map((s) => decodeURIComponent(s));
  } catch {
    return null;
  }

  const vIdx = segs.findIndex((s) => /^v\d+$/.test(s));
  let idSegs;
  if (vIdx >= 0) {
    idSegs = segs.slice(vIdx + 1);
  } else {
    // Không có segment version: bỏ các segment transformation ở ĐẦU (không bao giờ bỏ segment cuối).
    let i = 0;
    while (i < segs.length - 1 && looksLikeTransformation(segs[i])) i++;
    idSegs = segs.slice(i);
  }
  if (idSegs.length === 0) return null;

  // URL delivery gắn đuôi định dạng (.jpg/.png...) — public_id thì không có.
  const last = idSegs.length - 1;
  idSegs[last] = idSegs[last].replace(/\.[a-z0-9]{2,5}$/i, "");
  const publicId = idSegs.join("/");
  if (!publicId) return null;

  return { cloudName: m[1], resourceType: m[2], deliveryType: m[3], publicId };
}

function publicIdFromUrl(url) {
  return parseCloudinaryUrl(url)?.publicId || null;
}

// Rút mọi URL Cloudinary xuất hiện trong 1 chuỗi bất kỳ (HTML nội dung bài viết, JSON...).
function extractCloudinaryUrls(text) {
  if (typeof text !== "string" || !text) return [];
  return text.match(/https?:\/\/res\.cloudinary\.com\/[^\s"'<>)\\]+/gi) || [];
}

module.exports = {
  avatarPublicId,
  avatarFolderPrefix,
  assetDocId,
  parseCloudinaryUrl,
  publicIdFromUrl,
  extractCloudinaryUrls,
};
