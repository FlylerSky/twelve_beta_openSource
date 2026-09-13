require("dotenv").config();
const { db } = require("../config/firebase");
const { COLLECTIONS } = require("../utils/constants");

async function run() {
  const version = process.env.BACKEND_VERSION || "0.8.16.120926";
  await db.collection(COLLECTIONS.CONFIG).doc("version").set({ backend: version });
  console.log(`✅ Đã set phiên bản backend = ${version} trong Firestore (config/version).`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Seed version thất bại:", err);
  process.exit(1);
});
