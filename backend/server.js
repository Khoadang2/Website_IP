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

// Polyfill pLimit
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

const DEFAULT_IP_CONCURRENCY = parseInt(process.env.IP_CONCURRENCY, 10) || 50;

// Upload multer
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

// Host check functions
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
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }
  return false;
}

async function checkHost(ip, timeoutMs = 1500) {
  try {
    const commonPorts = [80, 443, 3389, 22, 445, 139, 135, 8080, 9100];
    const portChecks = commonPorts.map((port) =>
      checkHostPort(ip, port, timeoutMs, 1)
    );

    const portResults = await Promise.allSettled(portChecks);
    const hasOpenPort = portResults.some(
      (result) => result.status === "fulfilled" && result.value === true
    );

    if (hasOpenPort) return true;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const pingResult = await ping.promise.probe(ip, {
          timeout: 2,
          min_reply: 1,
        });

        if (pingResult && pingResult.alive) return true;

        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } catch (e) {}
    }

    try {
      const finalPing = await ping.promise.probe(ip, {
        timeout: 2,
        min_reply: 1,
        extra: ["-c", "2"],
      });

      if (finalPing && finalPing.alive) return true;
    } catch (e) {}

    return false;
  } catch (e) {
    console.error(`Lỗi check ${ip}:`, e.message);
    return false;
  }
}

async function checkHostWithRetry(ip, maxRetries = 1) {
  try {
    const result = await checkHost(ip, 400);
    if (result) return true;
  } catch (e) {}

  if (maxRetries > 0) {
    try {
      return await checkHost(ip, 700);
    } catch (e) {}
  }

  return false;
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

// Discover
app.post("/api/discover", async (req, res) => {
  try {
    const { range, concurrency } = req.body || {};
    const ipConcurrency = parseInt(concurrency, 10) || 100;
    const limit = pLimitFactory(ipConcurrency);
    const pool = await poolWEB;
    const devices = [];

    console.log(`🔍 Bắt đầu quét với concurrency: ${ipConcurrency}`);
    const startTime = Date.now();

    if (!range || range.trim() === "") {
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
              try {
                alive = await checkHostPort(d.ip, d.port, 400);
              } catch (e) {
                try {
                  alive = await checkHostPort(d.ip, d.port, 700);
                } catch (e2) {
                  alive = false;
                }
              }
            } else {
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

      if (statusUpdates.size > 0) {
        setImmediate(async () => {
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
          } catch (e) {
            console.error("Batch update error:", e);
          }
        });
      }
    } else {
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

// Export Excel
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

// Import Excel
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

// ===================== QC LINES API =====================

async function initQCLinesTable() {
  try {
    const pool = await poolWEB;

    const checkTable = await pool.request().query(`
      SELECT * FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME = 'qc_lines'
    `);

    if (checkTable.recordset.length === 0) {
      throw new Error("❌ qc_lines chưa tồn tại – phải tạo bằng SQL chuẩn trước");
    }

    const checkPort = await pool.request().query(`
      SELECT * FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'qc_lines' AND COLUMN_NAME = 'port'
    `);

    if (checkPort.recordset.length === 0) {
      throw new Error("❌ qc_lines thiếu cột port – KHÔNG CHO PHÉP");
    }

    console.log("✅ qc_lines OK (port + display_order đã tồn tại)");
  } catch (err) {
    console.error(err.message);
    process.exit(1); // ❌ chết luôn nếu sai cấu trúc
  }
}


initQCLinesTable();

// GET danh sách lines (sắp xếp theo display_order)
app.get("/api/qc-lines", async (req, res) => {
  try {
    const pool = await poolWEB;
    const rs = await pool.request().query(`
      SELECT line_number, line_name, port, display_order
      FROM qc_lines
      ORDER BY display_order
    `);
    res.json(rs.recordset);
  } catch (err) {
    res.status(500).send(err.message);
  }
});


// UPDATE thứ tự hiển thị (reorder) - ĐẶT TRƯỚC route có :lineNumber
app.put("/api/qc-lines/reorder", async (req, res) => {
  const { orders } = req.body;

  try {
    const pool = await poolWEB;

    for (const o of orders) {
      await pool.request()
        .input("line", sql.Int, o.line_number)
        .input("order", sql.Int, o.display_order)
        .query(`
          UPDATE qc_lines
          SET display_order = @order, updated_at = GETDATE()
          WHERE line_number = @line
        `);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// UPDATE tên line - ĐẶT SAU route /reorder
app.put("/api/qc-lines/:lineNumber", async (req, res) => {
  const { lineNumber } = req.params;
  const { lineName } = req.body;

  try {
    const pool = await poolWEB;

    const checkResult = await pool
      .request()
      .input("lineNumber", sql.Int, parseInt(lineNumber))
      .query("SELECT line_number FROM qc_lines WHERE line_number = @lineNumber");

    if (checkResult.recordset.length > 0) {
      await pool
        .request()
        .input("lineNumber", sql.Int, parseInt(lineNumber))
        .input("lineName", sql.NVarChar, lineName)
        .input("updatedAt", sql.DateTime, new Date()).query(`
          UPDATE qc_lines 
          SET line_name = @lineName, updated_at = @updatedAt
          WHERE line_number = @lineNumber
        `);
    } else {
      await pool
        .request()
        .input("lineNumber", sql.Int, parseInt(lineNumber))
        .input("lineName", sql.NVarChar, lineName)
        .input("displayOrder", sql.Int, parseInt(lineNumber))
        .input("updatedAt", sql.DateTime, new Date()).query(`
          INSERT INTO qc_lines (line_number, line_name, display_order, updated_at)
          VALUES (@lineNumber, @lineName, @displayOrder, @updatedAt)
        `);
    }

    res.json({ success: true, message: "Cập nhật thành công" });
  } catch (err) {
    console.error("❌ Update QC line error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ===================== QC CONTROL API - DÙNG DISPLAY_ORDER =====================

// Hàm getUrl - tính port theo display_order
function buildUrl(port, ledId = 0) {
  if (ledId === 0) {
    return `http://192.168.71.254:${port}/andon/led/0/off`;
  }
  return `http://192.168.71.254:${port}/andon/led/${ledId}/toggle`;
}

app.get("/api/run/:code", async (req, res) => {
  const { code } = req.params;
  const ledId = req.query.id ? parseInt(req.query.id) : 0;

  const match = code.match(/^l(\d+)q(\d+)$/i);
  if (!match) return res.status(400).send("Code không hợp lệ");

  const lineNumber = parseInt(match[1]);
  const qc = parseInt(match[2]);
  if (qc < 1 || qc > 3) return res.status(400).send("QC chỉ 1–3");

  try {
    const pool = await poolWEB;
    const rs = await pool.request()
      .input("line", sql.Int, lineNumber)
      .query(`
        SELECT line_name, port
        FROM qc_lines
        WHERE line_number = @line
      `);

    if (rs.recordset.length === 0)
      return res.status(404).send("Line không tồn tại");

    const { line_name, port: basePort } = rs.recordset[0];
    const finalPort = basePort + (qc - 1);
    const url = buildUrl(finalPort, ledId);

    console.log(`QC RUN → ${line_name} | Port ${finalPort}`);

    // ✅ Thêm timeout 3s và handle lỗi
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const r = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      const text = await r.text();
      res.send(text);
    } catch (fetchErr) {
      clearTimeout(timeout);
      if (fetchErr.name === 'AbortError') {
        console.error(`⏱️ Timeout kết nối port ${finalPort}`);
        return res.status(504).send(`Timeout - Không kết nối được port ${finalPort}`);
      }
      throw fetchErr;
    }
  } catch (err) {
    console.error(`❌ Lỗi QC ${code}:`, err.message);
    res.status(500).send("Lỗi gọi Andon: " + err.message);
  }
});

// ===================== START SERVER =====================
app.listen(5501, () => {
  console.log("🚀 Server LAN: 5501");
  console.log(`⚡ IP Concurrency: ${DEFAULT_IP_CONCURRENCY}`);
  console.log("📊 Mode: ĐỘ CHÍNH XÁC 100%");
  console.log("🔌 QC Port: LẤY TỪ DATABASE (CỐ ĐỊNH)");
});
