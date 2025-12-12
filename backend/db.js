// // db.js
// const sql = require("mssql");

// // Kết nối DB WEB_IP
// const configWEB = {
//   user: "sa",
//   password: "Qweasd@123",
//   server: "",
//   database: "WEB_IP",
//   options: {
//     encrypt: false,
//     trustServerCertificate: true
//   }
// };

// // Kết nối DB LYS_ERP (cho trang đăng nhập)
// const configLogin = {
//   user: "tyxuan",
//   password: "jack",
//   server: "",
//   database: "LYS_ERP",   // 🔹 sửa lại đúng database
//   options: {
//     encrypt: false,
//     trustServerCertificate: true
//   }
// };


// // Pool WEB_IP
// const poolWEB = new sql.ConnectionPool(configWEB)
//   .connect()
//   .then(pool => {
//     console.log("✅ Kết nối SQL Server (WEB_IP) thành công");
//     return pool;
//   })
//   .catch(err => {
//     console.error("❌ Lỗi kết nối SQL Server (WEB_IP):", err);
//     process.exit(1);
//   });

// // Pool LIY_TYTHAC
// const poolLogin = new sql.ConnectionPool(configLogin)
//   .connect()
//   .then(pool => {
//     console.log("✅ Kết nối SQL Server (LIY_TYTHAC) thành công");
//     return pool;
//   })
//   .catch(err => {
//     console.error("❌ Lỗi kết nối SQL Server (LIY_TYTHAC):", err);
//     process.exit(1);
//   });

// module.exports = {
//   sql,
//   poolWEB,
//   poolLogin
// };
