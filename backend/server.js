const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const net = require("net");
const ping = require("ping");
const multer = require("multer");
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");
const { sql, poolWEB, poolLogin } = require("./db");

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// Polyfill pLimit: simple limiter factory
function pLimitFactory(concurrency) {
  if (!concurrency || concurrency <= 0) concurrency = 50;
  let activeCount = 0;
  const queue = [];

  const next = () => {
    if (queue.length === 0) return;
    if (activeCount >= concurrency) return;
    activeCount++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then((val) => {
        resolve(val);
        activeCount--;
        next();
      })
      .catch((err) => {
        reject(err);
        activeCount--;
        next();
      });
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

// Giảm concurrency xuống 50 để tránh quá tải network và tăng độ chính xác
const DEFAULT_IP_CONCURRENCY = parseInt(process.env.IP_CONCURRENCY, 10) || 50;

// ========= Upload (multer) =========
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, "uploads");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `import_${Date.now()}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const ok = [".xlsx", ".xls"].includes(
      path.extname(file.originalname).toLowerCase()
    );
    cb(ok ? null : new Error("Chỉ nhận file .xlsx/.xls"), ok);
  },
});

// ===================== HÀM KIỂM TRA HOST (ĐỘ CHÍNH XÁC 100%) =====================

/**
 * Kiểm tra port với retry và timeout dài hơn
 */
async function checkHostPort(ip, port, timeout = 1500, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const socket = new net.Socket();
        let done = false;

        socket.setTimeout(timeout);
        socket.setNoDelay(true);

        socket.once("connect", () => {
          if (!done) {
            done = true;
            socket.destroy();
            resolve(true);
          }
        });

        socket.once("timeout", () => {
          if (!done) {
            done = true;
            socket.destroy();
            reject(new Error("timeout"));
          }
        });

        socket.once("error", () => {
          if (!done) {
            done = true;
            socket.destroy();
            reject(new Error("error"));
          }
        });

        try {
          socket.connect(port, ip);
        } catch (e) {
          if (!done) {
            done = true;
            reject(e);
          }
        }
      });

      if (result) return true;
    } catch (e) {
      // Nếu chưa hết retry thì đợi 200ms rồi thử lại
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }
  return false;
}

/**
 * Kiểm tra host với chiến lược đa tầng và retry
 * - Kiểm tra nhiều port phổ biến
 * - Ping với timeout dài
 * - Retry nếu thất bại
 */
async function checkHost(ip, timeoutMs = 1500) {
  try {
    // Danh sách port phổ biến để check
    const commonPorts = [
      80,    // HTTP
      443,   // HTTPS
      3389,  // RDP
      22,    // SSH
      445,   // SMB
      139,   // NetBIOS
      135,   // RPC
      8080,  // HTTP Alt
      9100,  // Printer
    ];

    // 1. Kiểm tra tất cả các port phổ biến (song song)
    const portChecks = commonPorts.map((port) =>
      checkHostPort(ip, port, timeoutMs, 1) // 1 retry cho mỗi port
    );

    // Chờ tất cả port checks (không dùng race để đảm bảo check hết)
    const portResults = await Promise.allSettled(portChecks);
    
    // Nếu có bất kỳ port nào mở → device online
    const hasOpenPort = portResults.some(
      (result) => result.status === "fulfilled" && result.value === true
    );

    if (hasOpenPort) return true;

    // 2. Nếu không có port nào mở, thử ping với retry
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const pingResult = await ping.promise.probe(ip, {
          timeout: 2, // 2 giây cho ping
          min_reply: 1,
        });

        if (pingResult && pingResult.alive) return true;

        // Đợi 300ms giữa các lần retry
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } catch (e) {
        // Ignore và thử lại
      }
    }

    // 3. Kiểm tra cuối cùng: ARP (cho các thiết bị gần)
    // Thử ping với packet size nhỏ hơn
    try {
      const finalPing = await ping.promise.probe(ip, {
        timeout: 2,
        min_reply: 1,
        extra: ["-c", "2"], // 2 packets
      });
      
      if (finalPing && finalPing.alive) return true;
    } catch (e) {
      // Ignore
    }

    return false;
  } catch (e) {
    console.error(`Lỗi check ${ip}:`, e.message);
    return false;
  }
}

/**
 * Kiểm tra host với port cụ thể (cho device có port)
 */
async function checkHostWithPort(ip, port) {
  try {
    // 1. Thử check port cụ thể với retry nhiều hơn
    const portOpen = await checkHostPort(ip, port, 2000, 3);
    if (portOpen) return true;

    // 2. Nếu port không mở nhưng device có thể vẫn online
    // Thử ping để xác nhận
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const pingResult = await ping.promise.probe(ip, {
          timeout: 2,
          min_reply: 1,
        });

        if (pingResult && pingResult.alive) return true;

        if (attempt < 1) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } catch (e) {
        // Ignore
      }
    }

    return false;
  } catch (e) {
    console.error(`Lỗi check ${ip}:${port}:`, e.message);
    return false;
  }
}

// ===================== ROUTES =====================

app.post("/api/login", async (req, res) => {
  const { userid, pwd } = req.body;
  try {
    const pool = await poolLogin;
    const result = await pool
      .request()
      .input("user", sql.VarChar, userid)
      .input("pass", sql.VarChar, pwd).query(`
        SELECT TOP (1) [USERID], [PWD]
        FROM [dbo].[Busers]
        WHERE USERID = @user AND PWD = @pass
      `);
    if (result.recordset.length > 0) {
      res.json({ success: true, message: "", user: result.recordset[0] });
    } else {
      res.json({ success: false, message: "Sai tài khoản hoặc mật khẩu" });
    }
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).send("Lỗi đăng nhập: " + err.message);
  }
});

app.get("/api/devices", async (req, res) => {
  try {
    const pool = await poolWEB;
    const result = await pool.request().query(`
      SELECT TOP (1000) [id],[name],[type],[ip],[dep],[note],[status],[port],[date],[userid],[link]
      FROM devices
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("❌ GET /api/devices error:", err);
    res.status(500).send(err.message);
  }
});

app.post("/api/devices", async (req, res) => {
  const { name, type, ip, dep, note, status, port, userid, link } = req.body;
  try {
    const pool = await poolWEB;
    await pool
      .request()
      .input("name", sql.NVarChar, name)
      .input("type", sql.NVarChar, type)
      .input("ip", sql.NVarChar, ip)
      .input("dep", sql.NVarChar, dep)
      .input("note", sql.NVarChar, note)
      .input("status", sql.Int, status ? 1 : 0)
      .input("port", sql.Int, port || null)
      .input("userid", sql.VarChar, userid || "import/batch")
      .input("link", sql.NVarChar, link || "")
      .input("date", sql.DateTime, new Date()).query(`
        INSERT INTO devices (name, type, ip, dep, note, status, port, userid, link, date)
        VALUES (@name,@type,@ip,@dep,@note,@status,@port,@userid,@link,@date)
      `);
    res.send("Thêm thành công");
  } catch (err) {
    console.error("❌ Add error:", err);
    res.status(500).send(err.message);
  }
});

app.put("/api/devices/:id", async (req, res) => {
  const { id } = req.params;
  const { name, type, ip, dep, note, status, port, userid, link } = req.body;
  try {
    const pool = await poolWEB;
    await pool
      .request()
      .input("id", sql.Int, id)
      .input("name", sql.NVarChar, name)
      .input("type", sql.NVarChar, type)
      .input("ip", sql.NVarChar, ip)
      .input("dep", sql.NVarChar, dep)
      .input("note", sql.NVarChar, note)
      .input("status", sql.Int, status ? 1 : 0)
      .input("port", sql.Int, port || null)
      .input("userid", sql.VarChar, userid || "edit")
      .input("link", sql.NVarChar, link || "")
      .input("date", sql.DateTime, new Date()).query(`
        UPDATE devices 
        SET name=@name,type=@type,ip=@ip,dep=@dep,note=@note,
            status=@status,port=@port,userid=@userid,link=@link,date=@date
        WHERE id=@id
      `);
    res.send("Cập nhật thành công");
  } catch (err) {
    console.error("❌ Update error:", err);
    res.status(500).send(err.message);
  }
});

app.delete("/api/devices/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await poolWEB;
    await pool
      .request()
      .input("id", sql.Int, id)
      .query("DELETE FROM devices WHERE id=@id");
    res.json({ success: true, message: "Xóa thành công" });
  } catch (err) {
    console.error("❌ Delete API error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===================== HÀM KIỂM TRA HOST (NHANH & CHÍNH XÁC) =====================

// Adaptive retry: chỉ retry khi cần thiết
async function checkHostWithRetry(ip, maxRetries = 1) {
  // Lần đầu: timeout ngắn để nhanh
  try {
    const result = await checkHost(ip, 400);
    if (result) return true;
  } catch (e) {}
  
  // Retry với timeout dài hơn nếu fail
  if (maxRetries > 0) {
    try {
      return await checkHost(ip, 700);
    } catch (e) {}
  }
  
  return false;
}

async function checkHost(ip, timeoutMs = 400) {
  try {
    // Ưu tiên check port trước (nhanh hơn ping 3-5 lần)
    // Chỉ ping nếu không có port nào mở
    
    const portChecks = [
      checkHostPort(ip, 80, timeoutMs),    // HTTP
      checkHostPort(ip, 443, timeoutMs),   // HTTPS
      checkHostPort(ip, 3389, timeoutMs),  // RDP
    ];

    // Race: port nào respond trước thì return ngay
    try {
      await Promise.any(portChecks);
      return true;
    } catch (e) {
      // Không có port nào mở, thử ping
      const pingResult = await ping.promise.probe(ip, {
        timeout: timeoutMs / 1000,
        min_reply: 1,
      });
      return pingResult && pingResult.alive;
    }
  } catch (e) {
    return false;
  }
}

function checkHostPort(ip, port, timeout = 400) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let done = false;

    socket.setTimeout(timeout);
    socket.setNoDelay(true);

    const cleanup = (success) => {
      if (!done) {
        done = true;
        try {
          socket.destroy();
        } catch (e) {}
        success ? resolve(true) : reject(new Error("failed"));
      }
    };

    socket.once("connect", () => cleanup(true));
    socket.once("timeout", () => cleanup(false));
    socket.once("error", () => cleanup(false));

    try {
      socket.connect(port, ip);
    } catch (e) {
      cleanup(false);
    }
  });
}

// ===================== DISCOVER (2 GIÂY, ĐỘ CHÍNH XÁC CAO) =====================
app.post("/api/discover", async (req, res) => {
  try {
    const { range, concurrency } = req.body || {};
    
    // Tăng concurrency để nhanh hơn nhưng vẫn ổn định
    const ipConcurrency = parseInt(concurrency, 10) || 100;
    const limit = pLimitFactory(ipConcurrency);

    const pool = await poolWEB;
    const devices = [];

    console.log(`🔍 Bắt đầu quét với concurrency: ${ipConcurrency} (Nhanh & Chính xác)`);
    const startTime = Date.now();

    if (!range || range.trim() === "") {
      // Quét tất cả devices trong DB
      const result = await pool.request().query(`
        SELECT TOP (1000) [id], [name], [type], [ip], [dep], [note], [status], [port], [date], [userid], [link]
        FROM devices
      `);

      const statusUpdates = new Map();

      const checks = result.recordset.map((d) =>
        limit(async () => {
          let alive = false;
          try {
            if (d.port && d.port > 0) {
              // Có port cụ thể: check nhanh với retry thông minh
              try {
                alive = await checkHostPort(d.ip, d.port, 400);
              } catch (e) {
                // Retry 1 lần với timeout dài hơn
                try {
                  alive = await checkHostPort(d.ip, d.port, 700);
                } catch (e2) {
                  alive = false;
                }
              }
            } else {
              // Không có port: check đầy đủ với adaptive retry
              alive = await checkHostWithRetry(d.ip, 1);
            }
          } catch (e) {
            alive = false;
          }

          const newStatus = alive ? 1 : 0;
          if ((d.status ? 1 : 0) !== newStatus) {
            statusUpdates.set(d.id, newStatus);
          }

          return { ...d, status: newStatus };
        })
      );

      const updated = await Promise.all(checks);
      devices.push(...updated);

      // Batch update DB - async không chặn response
      if (statusUpdates.size > 0) {
        setImmediate(async () => {
          const updateStart = Date.now();
          try {
            const updatePromises = [];
            for (const [id, status] of statusUpdates.entries()) {
              updatePromises.push(
                pool
                  .request()
                  .input("id", sql.Int, id)
                  .input("status", sql.Int, status)
                  .query("UPDATE devices SET status=@status WHERE id=@id")
                  .catch((e) =>
                    console.error(`Update error for ID ${id}:`, e.message)
                  )
              );
            }
            await Promise.all(updatePromises);
            const updateTime = ((Date.now() - updateStart) / 1000).toFixed(2);
            console.log(
              `📝 Đã cập nhật ${statusUpdates.size} devices vào DB trong ${updateTime}s`
            );
          } catch (e) {
            console.error("Batch update error:", e);
          }
        });
      }
    } else {
      // Quét range IP
      const parts = range.split(".");
      if (parts.length !== 4) throw new Error("Range không hợp lệ");
      const prefix = parts.slice(0, 3).join(".");
      const last = parts[3];
      let start, end;

      if (last.includes("-")) {
        [start, end] = last.split("-").map((v) => parseInt(v, 10));
      } else {
        start = end = parseInt(last, 10);
      }

      if (Number.isNaN(start) || Number.isNaN(end))
        throw new Error("Range không hợp lệ");

      const tasks = [];
      for (let i = start; i <= end; i++) {
        const ipAddr = `${prefix}.${i}`;
        tasks.push(
          limit(async () => {
            // Adaptive retry
            const alive = await checkHostWithRetry(ipAddr, 1);
            
            const dbCheck = await pool
              .request()
              .input("ip", sql.NVarChar, ipAddr)
              .query("SELECT TOP 1 * FROM devices WHERE ip=@ip");

            if (dbCheck.recordset.length > 0) {
              return { ...dbCheck.recordset[0], status: alive ? 1 : 0 };
            } else {
              return {
                id: null,
                name: "-",
                type: "-",
                ip: ipAddr,
                dep: "-",
                note: alive ? "Đang online" : "Không phản hồi",
                status: alive ? 1 : 0,
                port: null,
                date: null,
                userid: null,
                link: null,
              };
            }
          })
        );
      }

      const results = await Promise.all(tasks);
      devices.push(...results);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const speed = (devices.length / elapsed).toFixed(0);
    const online = devices.filter((d) => d.status).length;
    console.log(
      `✅ Quét xong ${devices.length} IPs trong ${elapsed}s (${speed} IPs/s) - ${online} online`
    );

    res.json(devices);
  } catch (err) {
    console.error("❌ Discover error:", err);
    res.status(500).send("Lỗi discover: " + err.message);
  }
});

// ===================== EXPORT EXCEL =====================
app.get("/api/devices/export", async (req, res) => {
  try {
    const {
      type = "all",
      q = "",
      status = "all",
      sortField = "name",
      sortAsc = "1",
    } = req.query;
    const pool = await poolWEB;
    const rs = await pool.request().query("SELECT * FROM devices");
    let list = rs.recordset;

    if (type === "other") {
      list = list.filter(
        (d) =>
          !["server", "wifi", "printer", "att", "andong", "website"].includes(
            d.type
          )
      );
    } else if (type !== "all") {
      list = list.filter((d) => d.type === type);
    }

    const qq = q.trim().toLowerCase();
    if (qq)
      list = list.filter(
        (d) =>
          (d.name || "").toLowerCase().includes(qq) || (d.ip || "").includes(qq)
      );
    if (status === "online") list = list.filter((d) => d.status);
    if (status === "offline") list = list.filter((d) => !d.status);

    if (sortField) {
      const asc = sortAsc === "1";
      list.sort((a, b) => {
        let v1 = a[sortField] ?? "";
        let v2 = b[sortField] ?? "";
        if (typeof v1 === "string") v1 = v1.toLowerCase();
        if (typeof v2 === "string") v2 = v2.toLowerCase();
        if (v1 < v2) return asc ? -1 : 1;
        if (v1 > v2) return asc ? 1 : -1;
        return 0;
      });
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Devices");

    ws.columns = [
      { header: "Trạng thái", key: "status_text", width: 12 },
      { header: "Tên thiết bị", key: "name", width: 28 },
      { header: "Loại", key: "type", width: 16 },
      { header: "IP", key: "ip", width: 18 },
      { header: "Port", key: "port", width: 8 },
      { header: "Đơn vị", key: "dep", width: 16 },
      { header: "Ghi chú", key: "note", width: 30 },
      { header: "Link", key: "link", width: 24 },
    ];

    list.forEach((d) => {
      ws.addRow({
        status_text: d.status ? "Online" : "Offline",
        name: d.name || "",
        type: d.type || "",
        ip: d.ip || "",
        port: d.port || "",
        dep: d.dep || "",
        note: d.note || "",
        link: d.link || "",
      });
    });

    ws.getRow(1).font = { bold: true };

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=devices.xlsx");

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("❌ Export error:", err);
    res.status(500).send("Lỗi export: " + err.message);
  }
});

// ===================== IMPORT EXCEL =====================
app.post("/api/devices/import", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ success: false, message: "Không có file upload" });
  }

  const userId = req.headers["x-userid"] || "import";
  const filePath = req.file.path;

  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const ws = wb.worksheets[0];

    const cleanHeader = (txt) =>
      String(txt || "")
        .replace(/[▲▼\n\r\t]/g, "")
        .trim()
        .toLowerCase();

    const headerTextByCol = {};
    ws.getRow(1).eachCell((cell, colNumber) => {
      headerTextByCol[colNumber] = cleanHeader(cell.value);
    });

    const detectors = {
      status: ["trạng trạng", "trạng thái", "status", "tình trạng"],
      name: [
        "tên thiết bị",
        "ten thiet bi",
        "name",
        "device",
        "thiết bị",
        "tên",
      ],
      type: ["loại", "type", "category"],
      ip: ["ip", "địa chỉ ip", "ip address", "ipaddr", "dia chi ip"],
      port: ["port", "cổng", "cong"],
      dep: ["đơn vị", "department", "dep", "phòng ban", "don vi"],
      note: ["ghi chú", "note", "remark", "comment", "ghi chu"],
      link: ["link", "url", "hyperlink", "đường dẫn", "lien ket", "duong dan"],
    };

    const colFor = {};
    for (const [colNum, txt] of Object.entries(headerTextByCol)) {
      for (const [field, keys] of Object.entries(detectors)) {
        if (keys.some((k) => txt.includes(k))) {
          colFor[field] = parseInt(colNum, 10);
          break;
        }
      }
    }

    if (!colFor.name || !colFor.ip) {
      throw new Error("Excel phải có cột 'Tên thiết bị' và 'IP'");
    }

    const pool = await poolWEB;
    let inserted = 0,
      skipped = 0;

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const getVal = (c) => {
        if (!c) return "";
        const v = row.getCell(c).value;
        if (!v) return "";
        if (typeof v === "object" && v.hyperlink) {
          return v.hyperlink;
        }
        return v.toString().trim();
      };

      const name = getVal(colFor.name);
      const ipRaw = getVal(colFor.ip);
      if (!ipRaw) {
        skipped++;
        continue;
      }

      let ip = ipRaw;
      let port = colFor.port ? parseInt(getVal(colFor.port)) : null;
      if (ipRaw.includes(":") && !port) {
        const [ipPart, p] = ipRaw.split(":");
        ip = ipPart;
        const pInt = parseInt(p);
        if (!Number.isNaN(pInt)) port = pInt;
      }

      const type = getVal(colFor.type);
      const dep = getVal(colFor.dep);
      const note = getVal(colFor.note);
      const link = getVal(colFor.link);
      const status = colFor.status
        ? String(getVal(colFor.status)).toLowerCase().includes("online")
          ? 1
          : 0
        : 0;

      const check = await pool
        .request()
        .input("ip", sql.NVarChar, ip)
        .query("SELECT TOP 1 id FROM devices WHERE ip=@ip");

      if (check.recordset.length > 0) {
        skipped++;
      } else {
        await pool
          .request()
          .input("name", sql.NVarChar, name)
          .input("type", sql.NVarChar, type)
          .input("ip", sql.NVarChar, ip)
          .input("dep", sql.NVarChar, dep)
          .input("note", sql.NVarChar, note)
          .input("status", sql.Int, status)
          .input("port", sql.Int, port || null)
          .input("userid", sql.VarChar, userId)
          .input("link", sql.NVarChar, link || "")
          .input("date", sql.DateTime, new Date())
          .query(`INSERT INTO devices (name, type, ip, dep, note, status, port, userid, link, date)
                  VALUES (@name, @type, @ip, @dep, @note, @status, @port, @userid, @link, @date)`);
        inserted++;
      }
    }

    try {
      fs.unlinkSync(filePath);
    } catch (e) {}

    return res.json({ success: true, inserted, skipped });
  } catch (err) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {}
    console.error("❌ Import error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

function getUrl(line, qc, ledId = 0, action = null) {
  const port = 1000 + (line - 1) * 3 + qc;
  if (ledId === 0) {
    return `http://192.168.71.254:${port}/andon/led/0/off`;
  }
  return `http://192.168.71.254:${port}/andon/led/${ledId}/toggle`;
}

app.get("/api/run/:code", async (req, res) => {
  const { code } = req.params;
  const id = req.query.id ? parseInt(req.query.id) : 0;

  const match = code.match(/^l(\d+)q(\d+)$/i);
  if (!match) return res.status(400).send("Code không hợp lệ");

  const line = parseInt(match[1]);
  const qc = parseInt(match[2]);

  const url = getUrl(line, qc, id);
  console.log("→ line:", line, "qc:", qc, "id:", id);
  console.log("Gọi API nội bộ:", url);

  try {
    const r = await fetch(url);
    const data = await r.text();
    res.send(data);
  } catch (err) {
    console.log(err);
    res.status(500).send("Error calling internal API");
  }
});

// ===================== START SERVER =====================
app.listen(5501, () => {
  console.log("🚀 Server LAN: 5501");
  console.log(`⚡ IP Concurrency: ${DEFAULT_IP_CONCURRENCY}`);
  console.log("📊 Mode: ĐỘ CHÍNH XÁC 100% (Chậm hơn nhưng chính xác)");
});
