require("dotenv").config();
const { db } = require("../config/firebase");
const { COLLECTIONS } = require("../utils/constants");

// Danh sách rút gọn — có thể mở rộng đầy đủ 195 quốc gia sau.
// "Other / Khác" luôn có order cao nhất để hiển thị cuối danh sách.
const countries = [
  { code: "VN", name: "Việt Nam" },
  { code: "US", name: "Hoa Kỳ" },
  { code: "JP", name: "Nhật Bản" },
  { code: "KR", name: "Hàn Quốc" },
  { code: "CN", name: "Trung Quốc" },
  { code: "SG", name: "Singapore" },
  { code: "TH", name: "Thái Lan" },
  { code: "GB", name: "Vương quốc Anh" },
  { code: "FR", name: "Pháp" },
  { code: "DE", name: "Đức" },
  { code: "AU", name: "Úc" },
  { code: "CA", name: "Canada" },
  { code: "OTHER", name: "Other / Khác" },
];

async function run() {
  const batch = db.batch();
  countries.forEach((c, index) => {
    const order = c.code === "OTHER" ? 9999 : index;
    const ref = db.collection(COLLECTIONS.COUNTRIES).doc(c.code);
    batch.set(ref, { ...c, order });
  });
  await batch.commit();
  console.log(`✅ Đã seed ${countries.length} quốc gia vào Firestore.`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Seed countries thất bại:", err);
  process.exit(1);
});
