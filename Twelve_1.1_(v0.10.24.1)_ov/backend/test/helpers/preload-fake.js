// Dùng với `node -r ./test/helpers/preload-fake.js server.js`: chạy server.js THẬT với Firestore/Auth GIẢ, để kiểm hành vi cấp tiến trình (sống/chết) mà không cần mạng hay khoá thật.
const { install } = require("./fakeFirebase");
install({ tokens: {} });
