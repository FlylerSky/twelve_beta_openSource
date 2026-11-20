// v0.10.20 — test quản lý tài nguyên. Chạy: npm test   (Node >= 18, không cần Firebase/Cloudinary thật)
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const {
  parseCloudinaryUrl,
  publicIdFromUrl,
  avatarPublicId,
  extractCloudinaryUrls,
  assetDocId,
} = require("../src/utils/cloudinaryUrl");
const { planAssetCleanup } = require("../src/utils/assetAudit");

const CLOUD = "democloud";
const url = (pid, v = "v1700000000", ext = "jpg") => `https://res.cloudinary.com/${CLOUD}/image/upload/${v}/${pid}.${ext}`;
const OLD = "2026-01-01T00:00:00Z";
const NOW = Date.parse("2026-09-29T12:00:00Z");

// ---------- cloudinaryUrl ----------
test("parseCloudinaryUrl: URL có version, có transformation, không version", () => {
  assert.equal(publicIdFromUrl(url("twelve/avatars/u1/abcd1234")), "twelve/avatars/u1/abcd1234");
  assert.equal(
    publicIdFromUrl(`https://res.cloudinary.com/${CLOUD}/image/upload/w_512,h_512,c_fill/v12/twelve/avatars/u1/x.jpg`),
    "twelve/avatars/u1/x"
  );
  assert.equal(
    publicIdFromUrl(`https://res.cloudinary.com/${CLOUD}/image/upload/f_auto/twelve/avatars/u1/x.png`),
    "twelve/avatars/u1/x"
  );
  assert.equal(publicIdFromUrl(url(avatarPublicId("u9"))), "twelve/avatars/u9/avatar");
  assert.equal(parseCloudinaryUrl(url("a/b")).cloudName, CLOUD);
});

test("parseCloudinaryUrl: từ chối thứ không phải URL Cloudinary", () => {
  for (const bad of [null, "", "not a url", "https://evil.com/image/upload/v1/twelve/avatars/u1/a.jpg", "https://res.cloudinary.com/x/foo/bar"]) {
    assert.equal(publicIdFromUrl(bad), null);
  }
  // hostname giả mạo có chứa cloudinary.com ở giữa
  assert.equal(publicIdFromUrl("https://cloudinary.com.evil.io/c/image/upload/v1/a/b.jpg"), null);
});

test("extractCloudinaryUrls + assetDocId", () => {
  const html = `<p><img src="${url("twelve/posts/p1")}"> và <video src='${url("m/v", "v2", "mp4")}'></video></p>`;
  assert.equal(extractCloudinaryUrls(html).length, 2);
  assert.equal(assetDocId("twelve/avatars/u1/avatar"), "twelve__avatars__u1__avatar");
});

// ---------- planAssetCleanup ----------
const res = (pid, extra = {}) => ({ public_id: pid, bytes: 1000, created_at: OLD, secure_url: url(pid), ...extra });
const base = (over) => ({
  cloudName: CLOUD,
  now: NOW,
  registry: [],
  contentPublicIds: new Set(),
  ...over,
});

test("plan: giữ avatar đang dùng, xoá avatar cũ bị thay, xoá asset của tài khoản đã mất", () => {
  const plan = planAssetCleanup(
    base({
      users: [
        { uid: "u1", avatarUrl: url("twelve/avatars/u1/new") },
        { uid: "u2", avatarUrl: null },
      ],
      resources: [
        res("twelve/avatars/u1/new"),
        res("twelve/avatars/u1/old1"),
        res("twelve/avatars/u1/old2"),
        res("twelve/avatars/u2/old"), // u2 còn tồn tại nhưng không dùng avatar nào
        res("twelve/avatars/ghost/old"), // tài khoản đã xoá
      ],
    })
  );
  assert.deepEqual(plan.keep.map((k) => k.publicId), ["twelve/avatars/u1/new"]);
  assert.equal(plan.delete.length, 4);
  assert.equal(plan.summary.deleteByReason.SUPERSEDED_AVATAR, 3);
  assert.equal(plan.summary.deleteByReason.ACCOUNT_GONE, 1);
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.registryToCreate.length, 1); // backfill sổ cho avatar đang dùng
  assert.equal(plan.registryToCreate[0].ownerUid, "u1");
});

test("plan: KHÔNG bao giờ đụng asset ngoài phạm vi avatar (media SA tự up cho bài viết)", () => {
  const plan = planAssetCleanup(
    base({
      users: [{ uid: "u1", avatarUrl: url("twelve/avatars/u1/a") }],
      resources: [res("twelve/avatars/u1/a"), res("posts/hinh-bai-viet"), res("blog-video/clip1"), res("random123")],
    })
  );
  assert.equal(plan.summary.inScope, 1);
  assert.equal(plan.delete.length, 0);
});

test("plan: ân hạn, nội dung bài viết, không rõ chủ", () => {
  const recent = new Date(NOW - 3600 * 1000).toISOString(); // 1 giờ trước
  const plan = planAssetCleanup(
    base({
      users: [{ uid: "u1", avatarUrl: url("twelve/avatars/u1/a") }],
      contentPublicIds: new Set(["twelve/avatars/u1/pasted"]),
      resources: [
        res("twelve/avatars/u1/a"),
        res("twelve/avatars/u1/just-uploaded", { created_at: recent }),
        res("twelve/avatars/u1/pasted"),
        res("twelve/avatars/loose-file"), // nằm thẳng trong scope, không có uid
      ],
    })
  );
  assert.equal(plan.delete.length, 0);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.unattributed.length, 1);
  assert.equal(plan.keep.some((k) => k.reason === "REFERENCED_IN_CONTENT"), true);

  const forced = planAssetCleanup(
    base({
      users: [{ uid: "u1", avatarUrl: url("twelve/avatars/u1/a") }],
      resources: [res("twelve/avatars/u1/a"), res("twelve/avatars/loose-file")],
      includeUnattributed: true,
    })
  );
  assert.equal(forced.delete.length, 1);
});

test("plan: dynamic folder mode (public_id ngẫu nhiên, thư mục nằm ở asset_folder)", () => {
  const plan = planAssetCleanup(
    base({
      users: [{ uid: "u1", avatarUrl: url("randomIdNew") }],
      resources: [
        res("randomIdNew", { asset_folder: "twelve/avatars/u1" }),
        res("randomIdOld", { asset_folder: "twelve/avatars/u1" }),
      ],
    })
  );
  assert.deepEqual(plan.keep.map((k) => k.publicId), ["randomIdNew"]);
  assert.deepEqual(plan.delete.map((d) => d.publicId), ["randomIdOld"]);
  assert.equal(plan.delete[0].ownerUid, "u1");
});

test("plan: phanh an toàn khi dữ liệu đầu vào bất thường", () => {
  // 1) không đọc được user nào
  let plan = planAssetCleanup(base({ users: [], resources: [res("twelve/avatars/u1/a")] }));
  assert.ok(plan.blockers.some((b) => b.startsWith("NO_USERS")));
  // 2) avatarUrl trỏ cloud khác
  plan = planAssetCleanup(
    base({
      users: [{ uid: "u1", avatarUrl: "https://res.cloudinary.com/othercloud/image/upload/v1/twelve/avatars/u1/a.jpg" }],
      resources: [res("twelve/avatars/u1/a")],
    })
  );
  assert.ok(plan.blockers.some((b) => b.startsWith("CLOUD_MISMATCH")));
  // 3) có avatar nhưng không khớp asset nào
  plan = planAssetCleanup(
    base({
      users: [{ uid: "u1", avatarUrl: url("somewhere/else") }],
      resources: [res("twelve/avatars/u1/a")],
    })
  );
  assert.ok(plan.blockers.some((b) => b.startsWith("NO_REFERENCE_MATCH")));
});

test("plan: đối soát sổ assets", () => {
  const plan = planAssetCleanup(
    base({
      users: [{ uid: "u1", avatarUrl: url("twelve/avatars/u1/avatar") }],
      resources: [res("twelve/avatars/u1/avatar"), res("twelve/avatars/u1/old")],
      registry: [
        { publicId: "twelve/avatars/u1/avatar" }, // đã có -> không tạo lại
        { publicId: "twelve/avatars/u1/old" }, // asset bị xoá -> dọn dòng sổ
        { publicId: "twelve/avatars/u7/gone" }, // asset không còn trên Cloudinary -> dọn dòng sổ
      ],
    })
  );
  assert.equal(plan.registryToCreate.length, 0);
  assert.deepEqual(plan.registryToRemove.map((r) => r.publicId).sort(), ["twelve/avatars/u1/old", "twelve/avatars/u7/gone"]);
});

// ---------- assets.service (mock Cloudinary + Firestore) ----------
function loadServiceWithMocks() {
  const calls = { upload: null, destroy: [], deleteByPrefix: [], batchOps: [] };
  const docs = new Map();
  const cloudinaryMock = {
    config: () => ({ cloud_name: CLOUD, api_key: "k", api_secret: "s" }),
    uploader: {
      upload_stream: (opts, cb) => {
        calls.upload = opts;
        return { end: () => cb(null, { public_id: opts.public_id, secure_url: url(opts.public_id, "v5"), bytes: 4321, format: "jpg", width: 512, height: 512, version: 5 }) };
      },
      destroy: async (pid, o) => calls.destroy.push([pid, o]),
    },
    api: {
      delete_resources_by_prefix: async (p) => calls.deleteByPrefix.push(p),
      delete_resources: async () => ({}),
      usage: async () => ({}),
    },
  };
  const dbMock = {
    collection: (name) => ({
      doc: (id) => ({ _k: `${name}/${id}`, get: async () => ({ exists: docs.has(`${name}/${id}`), data: () => docs.get(`${name}/${id}`) }) }),
      where: () => ({ get: async () => ({ docs: [] }) }),
    }),
    batch: () => ({
      update: (ref, d) => calls.batchOps.push(["update", ref._k, d]),
      set: (ref, d) => calls.batchOps.push(["set", ref._k, d]),
      delete: (ref) => calls.batchOps.push(["delete", ref._k]),
      commit: async () => {},
    }),
  };
  const inject = (rel, exp) => {
    const id = require.resolve(path.join(__dirname, "..", rel));
    require.cache[id] = { id, filename: id, loaded: true, exports: exp };
  };
  inject("src/config/cloudinary.js", cloudinaryMock);
  inject("src/config/firebase.js", { db: dbMock });
  const svcId = require.resolve("../src/services/assets.service");
  delete require.cache[svcId];
  return { svc: require("../src/services/assets.service"), calls, docs };
}

test("putAvatar: public_id cố định + overwrite + ép jpg + có tag/context", async () => {
  const { svc, calls } = loadServiceWithMocks();
  const r = await svc.putAvatar("u1", Buffer.from("x"));
  assert.equal(calls.upload.public_id, "twelve/avatars/u1/avatar");
  assert.equal(calls.upload.overwrite, true);
  assert.equal(calls.upload.invalidate, true);
  assert.equal(calls.upload.format, "jpg");
  assert.equal(calls.upload.folder, undefined); // không còn dùng `folder` sinh public_id ngẫu nhiên
  assert.deepEqual(calls.upload.context, { owner_uid: "u1", kind: "avatar" });
  assert.equal(r.public_id, "twelve/avatars/u1/avatar");
});

test("commitAvatarRecord: cập nhật user + sổ assets, tăng uploadCount, giữ createdAt", async () => {
  const { svc, calls, docs } = loadServiceWithMocks();
  const r = { public_id: "twelve/avatars/u1/avatar", secure_url: url("twelve/avatars/u1/avatar", "v5"), bytes: 4321, format: "jpg", width: 512, height: 512, version: 5 };
  await svc.commitAvatarRecord("u1", r);
  const set1 = calls.batchOps.find((o) => o[0] === "set");
  assert.equal(set1[1], "assets/twelve__avatars__u1__avatar");
  assert.equal(set1[2].uploadCount, 1);
  assert.deepEqual(calls.batchOps.find((o) => o[0] === "update").slice(1, 2), ["users/u1"]);

  docs.set("assets/twelve__avatars__u1__avatar", { uploadCount: 4, createdAt: "2026-01-01T00:00:00.000Z" });
  calls.batchOps.length = 0;
  await svc.commitAvatarRecord("u1", r);
  const set2 = calls.batchOps.find((o) => o[0] === "set");
  assert.equal(set2[2].uploadCount, 5);
  assert.equal(set2[2].createdAt, "2026-01-01T00:00:00.000Z");
});

test("releaseSupersededAvatar: chỉ xoá asset cũ của CHÍNH user; không xoá của người khác / avatar hiện tại / URL lạ", async () => {
  const { svc, calls } = loadServiceWithMocks();
  const cur = avatarPublicId("u1");
  assert.equal(await svc.releaseSupersededAvatar("u1", url("twelve/avatars/u1/legacyRandom"), cur), true);
  assert.equal(calls.destroy.length, 1);
  assert.equal(calls.destroy[0][0], "twelve/avatars/u1/legacyRandom");
  // avatar của user khác (dù ai đó nhét URL vào) -> không xoá
  assert.equal(await svc.releaseSupersededAvatar("u1", url("twelve/avatars/u2/avatar"), cur), false);
  // chính avatar hiện tại
  assert.equal(await svc.releaseSupersededAvatar("u1", url(cur), cur), false);
  // ảnh ngoài phạm vi (media bài viết), URL ngoài Cloudinary, null
  assert.equal(await svc.releaseSupersededAvatar("u1", url("posts/hinh1"), cur), false);
  assert.equal(await svc.releaseSupersededAvatar("u1", "https://example.com/a.jpg", cur), false);
  assert.equal(await svc.releaseSupersededAvatar("u1", null, cur), false);
  // cloud khác
  assert.equal(
    await svc.releaseSupersededAvatar("u1", "https://res.cloudinary.com/other/image/upload/v1/twelve/avatars/u1/x.jpg", cur),
    false
  );
  assert.equal(calls.destroy.length, 1);
});

test("getAssetStats: gom số liệu sổ + top uploader kèm tên + usage Cloudinary; lỗi usage không làm hỏng cả endpoint", async () => {
  const inject = (rel, exp) => {
    const id = require.resolve(path.join(__dirname, "..", rel));
    require.cache[id] = { id, filename: id, loaded: true, exports: exp };
  };
  const agg = (count, totalBytes) => ({ get: async () => ({ data: () => ({ count, totalBytes }) }) });
  const topDocs = [
    { data: () => ({ ownerUid: "u1", kind: "avatar", uploadCount: 9, updatedAt: "2026-09-29T00:00:00Z" }) },
    { data: () => ({ ownerUid: "ghost", kind: "avatar", uploadCount: 2, updatedAt: "2026-09-28T00:00:00Z" }) },
  ];
  const colMock = {
    aggregate: () => agg(3, 3000),
    where: () => ({ aggregate: () => agg(3, 3000) }),
    orderBy: () => ({ limit: () => ({ get: async () => ({ docs: topDocs }) }) }),
  };
  let usageFails = false;
  inject("src/config/cloudinary.js", {
    config: () => ({ cloud_name: CLOUD }),
    api: {
      usage: async () => {
        if (usageFails) throw new Error("boom");
        return { plan: "Free", storage: { usage: 5000, limit: 1e9, used_percent: 0.5 }, resources: 42, derived_resources: 7 };
      },
    },
  });
  inject("src/config/firebase.js", {
    db: {
      collection: (name) => (name === "assets" ? colMock : { doc: (id) => ({ id }) }),
      getAll: async (...refs) =>
        refs.map((r) =>
          r.id === "u1"
            ? { id: "u1", exists: true, data: () => ({ displayName: "Alice", tagName: "alice" }) }
            : { id: r.id, exists: false }
        ),
    },
  });
  const svcId = require.resolve("../src/services/assets.service");
  delete require.cache[svcId];
  const svc = require("../src/services/assets.service");

  const a = await svc.getAssetStats({ force: true });
  assert.equal(a.registry.total, 3);
  assert.equal(a.registry.totalBytes, 3000);
  assert.deepEqual(a.registry.byKind.avatar, { count: 3, totalBytes: 3000 });
  assert.equal(a.topUploaders[0].displayName, "Alice");
  assert.equal(a.topUploaders[0].tagName, "@alice");
  assert.equal(a.topUploaders[1].accountExists, false);
  assert.equal(a.cloudinary.storageBytes, 5000);
  assert.equal(a.cloudinary.resources, 42);

  // cache 60s
  assert.equal((await svc.getAssetStats()).cached, true);
  // Cloudinary usage lỗi -> vẫn trả phần còn lại
  usageFails = true;
  const b = await svc.getAssetStats({ force: true });
  assert.equal(b.cloudinary, null);
  assert.equal(b.registry.total, 3);
});
