const API_BASE = "http://192.168.71.106:5501"; // sửa nếu cần
let devices = [];
let addingRow = false;
let editingId = null;
let sortField = null;
let sortAsc = true;
let autoRefresh = false;
let autoIntervalId = null;

// --- DOM elements ---
const deviceBody = document.getElementById('deviceBody');
const typeFilter = document.getElementById('typeFilter');
const searchInput = document.getElementById('searchInput');
const totalCountEl = document.getElementById('totalCount');
const onlineCountEl = document.getElementById('onlineCount');
const offlineCountEl = document.getElementById('offlineCount');
const rangeInputSidebar = document.getElementById('rangeInput');
const rangeInputDesktop = document.getElementById('rangeInputDesktop');
const scanBtn = document.getElementById('scanBtn');
const autoBtn = document.getElementById('autoBtn');
const autoState = document.getElementById('autoState');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');

// --- Kiểm tra user trong localStorage ngay khi vào ---
const user = localStorage.getItem("user");
if (!user) {
  window.location.href = "login.html";
} else {
  // Chỉ loadDevices nếu đã đăng nhập
  loadDevices();
}

// --- helpers ---
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function(m) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m];
  });
}
function escapeAttr(s) {
  return String(s).replace(/'/g, "\\'");
}

// --- Load devices ---
async function loadDevices() {
  try {
    const res = await fetch(`${API_BASE}/api/devices`);
    if (!res.ok) throw new Error(await res.text());
    devices = await res.json();
    render();
  } catch (err) {
    alert('Không thể tải dữ liệu từ server: ' + err.message);
  }
}

// Render status cell (mobile: hide text)
function renderStatusCell(device){
  const dot = `<span class="dot" style="background:${device.status?'var(--online)':'var(--offline)'}"></span>`;
  const text = `<span class="status-text">${device.status ? 'Online' : 'Offline'}</span>`;
  return dot + text;
}

// Sorting handler
function sortTable(field) {
  if (sortField === field) sortAsc = !sortAsc;
  else { sortField = field; sortAsc = true; }
  render();
}

// Get type badge class
function getTypeColorClass(type) {
  switch (type) {
    case 'server': return 'type-server';
    case 'wifi': return 'type-wifi';
    case 'printer': return 'type-printer';
    case 'att': return 'type-att';
    case 'andong': return 'type-andong';
    case 'website': return 'type-website';
    default: return 'type-other';
  }
}

function openLink(url) {
  if (!url) return;
  window.open(url, "_blank");
}

// Main render
async function render(filterStatus = null, forceScan = false, preserveStats = false) {
  let list = Array.isArray(devices) ? devices.slice() : [];

  const type = typeFilter?.value || 'all';
  const q = searchInput?.value.trim().toLowerCase() || '';

  if (forceScan) {
    totalCountEl.textContent = 0;
    onlineCountEl.textContent = 0;
    offlineCountEl.textContent = 0;
    await discoverNetwork(false);
    list = Array.isArray(devices) ? devices.slice() : [];
  }

  // Filter type
  if (type !== 'all') {
    if (type === 'other') {
      list = list.filter(d => !['server','wifi','printer','att','andong','website'].includes(d.type));
    } else {
      list = list.filter(d => d.type === type);
    }
  }

  // Tìm kiếm 
  if (q) {
    const keyword = q.toLowerCase();
    list = list.filter(d => 
      (d.name || "").toLowerCase().includes(keyword) ||
      (d.ip || "").toLowerCase().includes(keyword) ||
      (d.dep || "").toLowerCase().includes(keyword)
    );
  }
  // filter by status
  if (filterStatus === 'online') list = list.filter(d => d.status);
  if (filterStatus === 'offline') list = list.filter(d => !d.status);

  // sort
  if (sortField) {
    list.sort((a, b) => {
      let v1 = a[sortField] ?? '';
      let v2 = b[sortField] ?? '';
      if (typeof v1 === 'string') v1 = v1.toLowerCase();
      if (typeof v2 === 'string') v2 = v2.toLowerCase();
      if (v1 < v2) return sortAsc ? -1 : 1;
      if (v1 > v2) return sortAsc ? 1 : -1;
      return 0;
    });
  }

  deviceBody.innerHTML = '';

  // adding row
  if (addingRow) {
    const trNew = document.createElement('tr');
    trNew.innerHTML = `
      <td>
        <select id="newStatus">
          <option value="true">Online</option>
          <option value="false" selected>Offline</option>
        </select>
      </td>
      <td><input id="newName" placeholder="Name"></td>
      <td>
        <select id="newType">
          <option value="server">Server</option>
          <option value="wifi">Wifi</option>
          <option value="printer">Printer</option>
          <option value="att">Máy chấm công</option>
          <option value="andong">QC An Dong</option>
          <option value="website">WebSite</option>
          <option value="other">Khác</option>
        </select>
      </td>
      <td>
        <input id="newIp" placeholder="192.168.x.x" style="width:140px">
        <input id="newPort" placeholder="Port" style="width:60px">
      </td>
      <td><input id="newDep" placeholder="Đơn vị"></td>
      <td><input id="newNote" placeholder="Ghi chú"></td>
      <td><input id="newLink" placeholder="Link"></td>
      <td>
        <button onclick="saveNew()">Lưu</button>
        <button onclick="cancelNew()">Hủy</button>
      </td>
    `;
    deviceBody.appendChild(trNew);
    return;
  }

  // editing row
  if (editingId !== null) {
    const d = list.find(x => x.id === editingId);
    if (d) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <select id="editStatus">
            <option value="true" ${d.status ? 'selected' : ''}>Online</option>
            <option value="false" ${!d.status ? 'selected' : ''}>Offline</option>
          </select>
        </td>
        <td><input id="editName" value="${escapeHtml(d.name || '')}"></td>
        <td>
          <select id="editType">
            <option value="server" ${d.type === 'server' ? 'selected' : ''}>Server</option>
            <option value="wifi" ${d.type === 'wifi' ? 'selected' : ''}>Wifi</option>
            <option value="printer" ${d.type === 'printer' ? 'selected' : ''}>Printer</option>
            <option value="att" ${d.type === 'att' ? 'selected' : ''}>Máy chấm công</option>
            <option value="andong" ${d.type === 'andong' ? 'selected' : ''}>QC An Dong</option>
            <option value="website" ${d.type === 'website' ? 'selected' : ''}>WebSite</option>
            <option value="other" ${d.type === 'other' ? 'selected' : ''}>Khác</option>
          </select>
        </td>
        <td>
          <input id="editIp" value="${escapeHtml(d.ip || '')}" style="width:120px">
          <input id="editPort" value="${d.port || ''}" style="width:60px">
        </td>
        <td><input id="editDep" value="${escapeHtml(d.dep || '')}"></td>
        <td><input id="editNote" value="${escapeHtml(d.note || '')}"></td>
        <td><input id="editLink" value="${escapeHtml(d.link || '')}"></td>
        <td>
          <button onclick="saveEdit(${d.id})">Lưu</button>
          <button onclick="cancelEdit()">Hủy</button>
        </td>
      `;
      deviceBody.appendChild(tr);
    }
    return;
  }

  // normal rows
  list.forEach(d => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <span class="dot" style="background:${d.status ? 'var(--online)' : 'var(--offline)'}"></span>
        <span class="status-text">${d.status ? 'Online' : 'Offline'}</span>
      </td>
      <td>${escapeHtml(d.name || '')}</td>
      <td><span class="device-type ${getTypeColorClass(d.type)}">${escapeHtml(d.type || '')}</span></td>
      <td style="font-family:monospace">${escapeHtml(d.ip || '')}${d.port ? ':' + d.port : ''}</td>
      <td>${escapeHtml(d.dep || '-')}</td>
      <td>${escapeHtml(d.note || '')}</td>
      <td>${d.link ? `<button onclick="openLink('${escapeAttr(d.link)}')">Link</button>` : ''}</td>
      <td>
        <button class="icon-btn edit" onclick="editDevice(${d.id})">
          <i class="fa fa-edit"></i>
        </button>
        <button class="icon-btn delete" onclick="deleteDevice(${d.id})">
          <i class="fa fa-trash"></i>
        </button>
      </td>
    `;
    deviceBody.appendChild(tr);
  });

  if (!preserveStats) {
    totalCountEl.textContent = list.length;
    onlineCountEl.textContent = list.filter(d => d.status).length;
    offlineCountEl.textContent = list.filter(d => !d.status).length;
  }
}

// Add / cancel new
function openAddRow() {
  if (!addingRow) { addingRow = true; render(); }
}
function cancelNew() { addingRow = false; render(); }

// save new
async function saveNew(){
  const u = JSON.parse(localStorage.getItem("user") || "null");
  const payload = {
    name: document.getElementById('newName').value.trim(),
    type: document.getElementById('newType').value,
    ip: document.getElementById('newIp').value.trim(),
    port: document.getElementById('newPort')?.value ? parseInt(document.getElementById('newPort').value) : null,
    dep: document.getElementById('newDep').value.trim(),
    note: document.getElementById('newNote').value.trim(),
    status: document.getElementById('newStatus').value==='true',
    userid: u?.USERID || null,
    link: document.getElementById('newLink')?.value.trim() || ''
  };

  if (!payload.ip) { alert('IP không được để trống'); return; }

  try {
    const resp = await fetch(`${API_BASE}/api/devices`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error(await resp.text());
    addingRow=false;
    await loadDevices();
  } catch (err) {
    alert("Không thể thêm thiết bị: " + err.message);
  }
}

// edit / delete
function cancelEdit(){ editingId=null; render(); }
function editDevice(id){ editingId=id; render(); }
async function saveEdit(id){
  const portVal = document.getElementById('editPort')?.value.trim();
  const u = JSON.parse(localStorage.getItem("user") || "null");
  const payload = {
    name: document.getElementById('editName').value.trim(),
    type: document.getElementById('editType').value,
    ip: document.getElementById('editIp').value.trim(),
    port: portVal?parseInt(portVal):null,
    dep: document.getElementById('editDep').value.trim(),
    note: document.getElementById('editNote').value.trim(),
    status: document.getElementById('editStatus').value==='true',
    userid: u?.USERID || null,
    link: document.getElementById('editLink')?.value.trim() || ''
  };
  try {
    const resp = await fetch(`${API_BASE}/api/devices/${id}`, {
      method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error(await resp.text());
    editingId=null;
    await loadDevices();
  } catch (err) {
    alert("Lỗi lưu thay đổi: " + err.message);
  }
}

async function deleteDevice(id){
  if(!confirm('Bạn có chắc muốn xóa?')) return;
  try {
    const resp = await fetch(`${API_BASE}/api/devices/${id}`, {method:'DELETE'});
    if (!resp.ok) throw new Error(await resp.text());
    await loadDevices();
  } catch (err) {
    alert("Lỗi xóa: " + err.message);
  }
}

// stats click
document.getElementById('statTotal').addEventListener('click', () => render(null, true));
document.getElementById('statOnline').addEventListener('click', () => render('online', false, true));
document.getElementById('statOffline').addEventListener('click', () => render('offline', false, true));

// type filter & search
typeFilter.addEventListener('change', () => render(null, true));
searchInput.addEventListener('input', () => render());

// scan button
scanBtn.addEventListener('click', ()=>discoverNetwork());

// auto refresh
autoBtn.addEventListener('click', ()=>{
  autoRefresh = !autoRefresh;
  autoBtn.textContent = autoRefresh ? 'Tắt auto-refresh' : 'Bật auto-refresh';
  autoState.textContent = autoRefresh ? 'Bật' : 'Tắt';

  if (autoRefresh) {
    if (autoIntervalId) clearInterval(autoIntervalId);
    autoIntervalId = setInterval(()=> {
      if (!autoRefresh) { clearInterval(autoIntervalId); autoIntervalId = null; return; }
      discoverNetwork();
    }, 15000);
  } else {
    if (autoIntervalId) { clearInterval(autoIntervalId); autoIntervalId = null; }
  }
});

// export
exportBtn.addEventListener('click', ()=>{
  const type = typeFilter.value;
  const q = encodeURIComponent(searchInput.value.trim());
  const status = "all";
  const sf = sortField || "name";
  const sa = sortAsc?1:0;
  const url = `${API_BASE}/api/devices/export?type=${type}&q=${q}&status=${status}&sortField=${sf}&sortAsc=${sa}`;
  window.open(url,'_blank');
});

// import
importBtn.addEventListener('click', ()=>importFile.click());
importFile.addEventListener('change', async e=>{
  const file = e.target.files[0]; if(!file) return;
  const fd = new FormData(); fd.append("file", file);
  const u = JSON.parse(localStorage.getItem("user") || "null");
  const userId = u?.USERID || "import";
  const btnText = importBtn.textContent;
  importBtn.textContent="Đang nhập..."; importBtn.disabled=true;
  try {
    const resp = await fetch(`${API_BASE}/api/devices/import`, {
      method:"POST", headers:{"x-userid":userId}, body:fd
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(txt || "Import thất bại");
    }
    const data = await resp.json();
    if (!data.success) throw new Error(data.message || "Import lỗi");
    alert(`Import xong: thêm ${data.inserted}, bỏ qua ${data.skipped}`);
    await loadDevices();
  } catch(err) {
    alert("Lỗi import: " + err.message);
  } finally {
    importBtn.textContent = btnText;
    importBtn.disabled = false;
    importFile.value = '';
  }
});

// discover network
async function discoverNetwork(autoRender=true){
  const range = (rangeInputSidebar?.value || rangeInputDesktop?.value || '').trim();
  const overlay = document.getElementById("loadingOverlay");

  scanBtn.textContent='Đang quét...';
  scanBtn.disabled=true;
  overlay.style.display = "flex";

  try{
    const resp = await fetch(`${API_BASE}/api/discover`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({range})
    });
    if (!resp.ok) throw new Error(await resp.text());
    devices = await resp.json();
    if(autoRender) render();
  }catch(err){
    alert("Lỗi khi quét: "+err.message);
  }finally{
    scanBtn.textContent='Quét mạng (Scan)';
    scanBtn.disabled=false;
    overlay.style.display = "none";
  }
}

// logout and init listeners on DOMContentLoaded
function logout(){ localStorage.removeItem("user"); window.location.href="login.html"; }
searchInput?.addEventListener('input', () => render());


document.addEventListener('DOMContentLoaded', function() {
  const addBtn = document.getElementById('addBtn');
  if (addBtn) addBtn.addEventListener('click', openAddRow);

  const menuToggle = document.getElementById('menuToggle');
  if (menuToggle) menuToggle.addEventListener('click', toggleSidebar);

  const closeBtn = document.getElementById('closeSidebarBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeSidebar);

  // sync range inputs
  const r1 = document.getElementById('rangeInput');
  const r2 = document.getElementById('rangeInputDesktop');
  if (r1 && r2) {
    r1.addEventListener('input', ()=> r2.value = r1.value);
    r2.addEventListener('input', ()=> r1.value = r2.value);
  }

  // wire scan button (double-safe)
  const scanBtnEl = document.getElementById('scanBtn');
  if (scanBtnEl) scanBtnEl.addEventListener('click', ()=> discoverNetwork());
});

// sidebar toggle
function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const isOpen = sidebar.classList.contains("open");
  if (isOpen) {
    sidebar.classList.remove("open");
    overlay.classList.remove("show");
    document.body.classList.remove('sidebar-open');
  } else {
    sidebar.classList.add("open");
    overlay.classList.add("show");
    document.body.classList.add('sidebar-open');
  }
}
function closeSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  sidebar.classList.remove("open");
  overlay.classList.remove("show");
  document.body.classList.remove('sidebar-open');
}
menuToggle?.addEventListener('click', () => {
  sidebar.classList.add('open');
});

closeSidebarBtn?.addEventListener('click', () => {
  sidebar.classList.remove('open');
});

// initial load
loadDevices();
