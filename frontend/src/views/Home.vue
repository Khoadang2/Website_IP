<template>
  <div class="wrap">
    <header>
      <div style="display:flex;align-items:center;gap:10px">
        <button class="menu-btn" @click="toggleSidebar" aria-label="Mở menu">
          <i class="fas fa-bars"></i>
        </button>
        <div>
          <h1 @click="handleLogout" style="cursor:pointer">Quản lý IP cố định</h1>
          <div class="sub mobile-hide">Quản lý: server, wifi, máy in, máy chấm công — IP online hiển thị đèn xanh</div>
        </div>
      </div>
      <div class="controls">
        <button @click="openAddRow" class="primary"><i class="fas fa-plus"></i> Thêm thiết bị</button>
        <span class="demo-badge">Mode: On</span>
        <button @click="handleDiscover" class="primary menu-scan" :disabled="loading">
          {{ loading ? 'Đang quét...' : 'Quét mạng' }}
        </button>
        <button @click="toggleAutoRefresh" class="primary mobile-hide">
          <i class="fas fa-sync-alt"></i> {{ autoRefresh ? 'Tắt auto-refresh' : 'Bật auto-refresh' }}
        </button>
        <button @click="handleExport" class="alt-btn mobile-hide">
          <i class="fas fa-file-export"></i> Xuất Excel
        </button>
        <input type="file" ref="importFile" @change="handleImport" accept=".xlsx,.xls" style="display:none" />
        <button @click="$refs.importFile.click()" class="alt-btn mobile-hide">
          <i class="fas fa-file-import"></i> Nhập Excel
        </button>
      </div>
    </header>

    <div class="grid">
      <aside :class="['card', 'sidebar', { open: sidebarOpen }]">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 class="sidebar-title">Bộ lọc & Tìm kiếm</h3>
          <button class="close-sidebar" @click="closeSidebar" aria-label="Đóng menu">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <label>Lọc theo loại</label>
        <select v-model="typeFilter" @change="applyFilters">
          <option value="all">Tất cả</option>
          <option value="server">Server</option>
          <option value="wifi">Wifi</option>
          <option value="printer">Printer</option>
          <option value="att">Máy chấm công</option>
          <option value="andong">QC An Dong</option>
          <option value="website">WebSite</option>
          <option value="other">Khác</option>
        </select>

        <label>Tìm kiếm (tên hoặc IP)</label>
        <input v-model="searchQuery" @input="applyFilters" type="text" placeholder="VD: Server, 192.168.78.10" />

        <div class="stats" style="margin-top:12px">
          <div class="stat" @click="handleStatClick(null)">
            <div class="sub">Tổng</div>
            <div class="stat-num">{{ stats.total }}</div>
          </div>
          <div class="stat" @click="handleStatClick('online')">
            <div class="sub">Online</div>
            <div class="stat-num online">{{ stats.online }}</div>
          </div>
          <div class="stat" @click="handleStatClick('offline')">
            <div class="sub">Offline</div>
            <div class="stat-num offline">{{ stats.offline }}</div>
          </div>
        </div>

        <div class="scan-range mobile-only">
          <div class="sub">Phạm vi quét (ví dụ: 192.168.78.1-254)</div>
          <input v-model="rangeInput" type="text" placeholder="192.168.78.1-254" />
        </div>
      </aside>

      <div :class="['overlay', { show: sidebarOpen }]" @click="closeSidebar" aria-hidden="true"></div>

      <main class="card">
        <div class="scan-range desktop-only" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div class="sub">Phạm vi quét (ví dụ: 192.168.78.1-254)</div>
          <input v-model="rangeInput" type="text" placeholder="192.168.78.1-254" style="max-width:260px"/>
          <div style="flex:1"></div>
          <div class="sub">Auto: <span>{{ autoRefresh ? 'Bật' : 'Tắt' }}</span></div>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th class="col-small" @click="handleSort('status')">Trạng thái <i class="fas fa-sort"></i></th>
                <th class="col-small" @click="handleSort('name')">Tên thiết bị <i class="fas fa-sort"></i></th>
                <th class="col-small" @click="handleSort('type')">Loại <i class="fas fa-sort"></i></th>
                <th class="col-small" @click="handleSort('ip')">IP <i class="fas fa-sort"></i></th>
                <th class="col-small" @click="handleSort('dep')">Đơn vị <i class="fas fa-sort"></i></th>
                <th class="col-small" @click="handleSort('note')">Ghi chú <i class="fas fa-sort"></i></th>
                <th class="col-small">Link</th>
                <th class="col-small">Chỉnh sửa</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="addingRow">
                <td>
                  <select v-model="newDevice.status">
                    <option :value="true">Online</option>
                    <option :value="false">Offline</option>
                  </select>
                </td>
                <td><input v-model="newDevice.name" placeholder="Name"></td>
                <td>
                  <select v-model="newDevice.type">
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
                  <input v-model="newDevice.ip" placeholder="192.168.x.x" style="width:140px">
                  <input v-model.number="newDevice.port" placeholder="Port" style="width:60px">
                </td>
                <td><input v-model="newDevice.dep" placeholder="Đơn vị"></td>
                <td><input v-model="newDevice.note" placeholder="Ghi chú"></td>
                <td><input v-model="newDevice.link" placeholder="Link"></td>
                <td>
                  <button @click="saveNew">Lưu</button>
                  <button @click="cancelNew">Hủy</button>
                </td>
              </tr>

              <tr v-else-if="editingId !== null && editingDevice">
                <td>
                  <select v-model="editingDevice.status">
                    <option :value="true">Online</option>
                    <option :value="false">Offline</option>
                  </select>
                </td>
                <td><input v-model="editingDevice.name"></td>
                <td>
                  <select v-model="editingDevice.type">
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
                  <input v-model="editingDevice.ip" style="width:120px">
                  <input v-model.number="editingDevice.port" style="width:60px">
                </td>
                <td><input v-model="editingDevice.dep"></td>
                <td><input v-model="editingDevice.note"></td>
                <td><input v-model="editingDevice.link"></td>
                <td>
                  <button @click="saveEdit">Lưu</button>
                  <button @click="cancelEdit">Hủy</button>
                </td>
              </tr>

              <tr v-for="device in filteredDevices" :key="device.id" v-else>
                <td>
                  <span class="dot" :style="{ background: device.status ? 'var(--online)' : 'var(--offline)' }"></span>
                  <span class="status-text">{{ device.status ? 'Online' : 'Offline' }}</span>
                </td>
                <td>{{ device.name || '' }}</td>
                <td>
                  <span class="device-type" :class="getTypeColorClass(device.type)">
                    {{ device.type || '' }}
                  </span>
                </td>
                <td style="font-family:monospace">
                  {{ device.ip || '' }}{{ device.port ? ':' + device.port : '' }}
                </td>
                <td>{{ device.dep || '-' }}</td>
                <td>{{ device.note || '' }}</td>
                <td>
                  <button v-if="device.link" @click="openLink(device.link)">Link</button>
                </td>
                <td>
                  <button class="icon-btn edit" @click="editDevice(device.id)">
                    <i class="fa fa-edit"></i>
                  </button>
                  <button class="icon-btn delete" @click="deleteDevice(device.id)">
                    <i class="fa fa-trash"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="loading" id="loadingOverlay">
          <div class="loading-container">
            <div class="circular-progress">
              <svg class="progress-ring" viewBox="0 0 120 120">
                <circle class="progress-ring__circle" 
                        stroke="url(#gradient)" 
                        stroke-width="8" 
                        fill="transparent" 
                        r="52" 
                        cx="60" 
                        cy="60"/>
                <defs>
                  <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#06b6d4;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#3b82f6;stop-opacity:1" />
                  </linearGradient>
                </defs>
              </svg>
              <div class="progress-text">{{ loadingProgress }}</div>
            </div>
            <div class="loading-message">{{ loadingMessage }}</div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script>
import { deviceAPI, authAPI } from '../services/api';

export default {
  name: 'Home',
  data() {
    return {
      devices: [],
      filteredDevices: [],
      addingRow: false,
      editingId: null,
      editingDevice: null,
      sortField: null,
      sortAsc: true,
      autoRefresh: false,
      autoIntervalId: null,
      typeFilter: 'all',
      searchQuery: '',
      rangeInput: '',
      sidebarOpen: false,
      loading: false,
      loadingProgress: '0%',
      loadingMessage: 'Đang quét mạng...',
      newDevice: this.getEmptyDevice(),
      currentStatusFilter: null, // Lưu trạng thái filter hiện tại
      stats: {
        total: 0,
        online: 0,
        offline: 0
      }
    };
  },
  mounted() {
    this.loadDevices();
  },
  beforeUnmount() {
    if (this.autoIntervalId) {
      clearInterval(this.autoIntervalId);
    }
  },
  methods: {
    getEmptyDevice() {
      return {
        name: '',
        type: 'server',
        ip: '',
        port: null,
        dep: '',
        note: '',
        status: false,
        link: ''
      };
    },
    
    async loadDevices() {
      try {
        this.devices = await deviceAPI.getAll();
        this.applyFilters();
      } catch (err) {
        alert('Không thể tải dữ liệu từ server: ' + err.message);
      }
    },
    
    applyFilters() {
      this.loading = true;
      this.loadingMessage = 'Đang lọc dữ liệu...';
      this.loadingProgress = '0%';
      
      let progress = 0;
      const progressInterval = setInterval(() => {
        progress += 10;
        this.loadingProgress = progress + '%';
        if (progress >= 100) clearInterval(progressInterval);
      }, 50);
      
      setTimeout(() => {
        let list = [...this.devices];

        // Bước 1: Filter by type
        if (this.typeFilter !== 'all') {
          if (this.typeFilter === 'other') {
            list = list.filter(d => !['server', 'wifi', 'printer', 'att', 'andong', 'website'].includes(d.type));
          } else {
            list = list.filter(d => d.type === this.typeFilter);
          }
        }

        // Bước 2: Filter by search query
        const q = this.searchQuery.trim().toLowerCase();
        if (q) {
          list = list.filter(d =>
            (d.name || '').toLowerCase().includes(q) ||
            (d.ip || '').toLowerCase().includes(q) ||
            (d.dep || '').toLowerCase().includes(q)
          );
        }

        // Bước 3: Cập nhật stats dựa trên list sau khi filter type và search
        // (TRƯỚC KHI filter status online/offline)
        this.stats.total = list.length;
        this.stats.online = list.filter(d => d.status).length;
        this.stats.offline = list.filter(d => !d.status).length;

        // Bước 4: Filter by status nếu đang trong chế độ lọc status
        if (this.currentStatusFilter === 'online') {
          list = list.filter(d => d.status);
        } else if (this.currentStatusFilter === 'offline') {
          list = list.filter(d => !d.status);
        }

        // Bước 5: Sort
        if (this.sortField) {
          list.sort((a, b) => {
            let v1 = a[this.sortField] ?? '';
            let v2 = b[this.sortField] ?? '';
            if (typeof v1 === 'string') v1 = v1.toLowerCase();
            if (typeof v2 === 'string') v2 = v2.toLowerCase();
            if (v1 < v2) return this.sortAsc ? -1 : 1;
            if (v1 > v2) return this.sortAsc ? 1 : -1;
            return 0;
          });
        }

        this.filteredDevices = list;
        this.loading = false;
      }, 600);
    },
    
    handleSort(field) {
      if (this.sortField === field) {
        this.sortAsc = !this.sortAsc;
      } else {
        this.sortField = field;
        this.sortAsc = true;
      }
      this.applyFilters();
    },
    
    getTypeColorClass(type) {
      const typeMap = {
        server: 'type-server',
        wifi: 'type-wifi',
        printer: 'type-printer',
        att: 'type-att',
        andong: 'type-andong',
        website: 'type-website'
      };
      return typeMap[type] || 'type-other';
    },
    
    openAddRow() {
      this.addingRow = true;
      this.newDevice = this.getEmptyDevice();
    },
    
    cancelNew() {
      this.addingRow = false;
    },
    
    async saveNew() {
      if (!this.newDevice.ip.trim()) {
        alert('IP không được để trống');
        return;
      }

      try {
        await deviceAPI.create(this.newDevice);
        this.addingRow = false;
        await this.loadDevices();
      } catch (err) {
        alert('Không thể thêm thiết bị: ' + err.message);
      }
    },
    
    editDevice(id) {
      this.editingId = id;
      const device = this.devices.find(d => d.id === id);
      if (device) {
        this.editingDevice = { ...device };
      }
    },
    
    cancelEdit() {
      this.editingId = null;
      this.editingDevice = null;
    },
    
    async saveEdit() {
      try {
        await deviceAPI.update(this.editingId, this.editingDevice);
        this.editingId = null;
        this.editingDevice = null;
        await this.loadDevices();
      } catch (err) {
        alert('Lỗi lưu thay đổi: ' + err.message);
      }
    },
    
    async deleteDevice(id) {
      if (!confirm('Bạn có chắc muốn xóa?')) return;
      try {
        await deviceAPI.delete(id);
        await this.loadDevices();
      } catch (err) {
        alert('Lỗi xóa: ' + err.message);
      }
    },
    
    async handleDiscover() {
      this.loading = true;
      this.loadingMessage = 'Đang quét mạng...';
      this.loadingProgress = '0%';
      
      const progressInterval = setInterval(() => {
        const currentProgress = parseInt(this.loadingProgress);
        if (currentProgress < 90) {
          this.loadingProgress = (currentProgress + 5) + '%';
        }
      }, 200);
      
      try {
        this.devices = await deviceAPI.discover(this.rangeInput.trim());
        this.loadingProgress = '100%';
        
        // Chỉ reset status filter, GIỮ NGUYÊN typeFilter và searchQuery
        this.currentStatusFilter = null;
        
        this.applyFilters();
      } catch (err) {
        alert('Lỗi khi quét: ' + err.message);
      } finally {
        clearInterval(progressInterval);
        setTimeout(() => {
          this.loading = false;
          this.loadingProgress = '0%';
        }, 300);
      }
    },
    
    toggleAutoRefresh() {
      this.autoRefresh = !this.autoRefresh;
      if (this.autoRefresh) {
        if (this.autoIntervalId) clearInterval(this.autoIntervalId);
        this.autoIntervalId = setInterval(() => this.handleDiscover(), 15000);
      } else {
        clearInterval(this.autoIntervalId);
        this.autoIntervalId = null;
      }
    },
    
    handleExport() {
      const url = deviceAPI.getExportUrl({
        type: this.typeFilter,
        q: this.searchQuery.trim(),
        status: 'all',
        sortField: this.sortField || 'name',
        sortAsc: this.sortAsc ? '1' : '0'
      });
      window.open(url, '_blank');
    },
    
    async handleImport(e) {
      const file = e.target.files[0];
      if (!file) return;

      this.loading = true;
      this.loadingMessage = 'Đang nhập dữ liệu từ Excel...';
      this.loadingProgress = '0%';
      
      const progressInterval = setInterval(() => {
        const currentProgress = parseInt(this.loadingProgress);
        if (currentProgress < 80) {
          this.loadingProgress = (currentProgress + 8) + '%';
        }
      }, 150);

      try {
        const data = await deviceAPI.import(file);
        this.loadingProgress = '100%';
        
        if (data.success) {
          alert(`Import xong: thêm ${data.inserted}, bỏ qua ${data.skipped}`);
          await this.loadDevices();
        } else {
          throw new Error(data.message || 'Import lỗi');
        }
      } catch (err) {
        alert('Lỗi import: ' + err.message);
      } finally {
        clearInterval(progressInterval);
        setTimeout(() => {
          this.loading = false;
          this.loadingProgress = '0%';
        }, 300);
        this.$refs.importFile.value = '';
      }
    },
    
    handleStatClick(filterStatus) {
      if (filterStatus === null) {
        // Nhấn "Tổng" -> chỉ reset currentStatusFilter, GIỮ NGUYÊN filter type và search
        this.currentStatusFilter = null;
        this.applyFilters();
      } else {
        // Nhấn "Online" hoặc "Offline" -> toggle filter status
        if (this.currentStatusFilter === filterStatus) {
          // Nếu đang lọc cùng loại thì tắt filter
          this.currentStatusFilter = null;
        } else {
          // Nếu chưa lọc hoặc lọc loại khác thì bật filter
          this.currentStatusFilter = filterStatus;
        }
        
        this.applyFilters();
      }
    },
    
    toggleSidebar() {
      this.sidebarOpen = !this.sidebarOpen;
      if (this.sidebarOpen) {
        document.body.classList.add('sidebar-open');
      } else {
        document.body.classList.remove('sidebar-open');
      }
    },
    
    closeSidebar() {
      this.sidebarOpen = false;
      document.body.classList.remove('sidebar-open');
    },
    
    openLink(url) {
      if (url) window.open(url, '_blank');
    },
    
    handleLogout() {
      authAPI.logout();
      this.$router.push('/login');
    }
  }
};
</script>

<style src="../style.css"></style>
<style scoped>
/* Loading Overlay */
#loadingOverlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(7, 16, 40, 0.95);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

.circular-progress {
  position: relative;
  width: 120px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.progress-ring {
  width: 120px;
  height: 120px;
  transform: rotate(-90deg);
  filter: drop-shadow(0 0 20px rgba(6, 182, 212, 0.5));
}

.progress-ring__circle {
  stroke-dasharray: 326.56;
  stroke-dashoffset: 0;
  stroke-linecap: round;
  animation: progress 2s ease-in-out infinite;
}

@keyframes progress {
  0% {
    stroke-dashoffset: 326.56;
    transform: rotate(0deg);
  }
  50% {
    stroke-dashoffset: 81.64;
  }
  100% {
    stroke-dashoffset: 326.56;
    transform: rotate(360deg);
  }
}

.progress-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 18px;
  font-weight: 700;
  color: #06b6d4;
  text-shadow: 0 0 10px rgba(6, 182, 212, 0.5);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  50% {
    opacity: 0.7;
    transform: translate(-50%, -50%) scale(1.05);
  }
}

.loading-message {
  font-size: 16px;
  font-weight: 500;
  color: #e6eef6;
  text-align: center;
  animation: slideUp 0.5s ease;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.loading-message::after {
  content: '';
  animation: dots 1.5s steps(4, end) infinite;
}

@keyframes dots {
  0%, 20% { content: ''; }
  40% { content: '.'; }
  60% { content: '..'; }
  80%, 100% { content: '...'; }
}

.circular-progress::before {
  content: '';
  position: absolute;
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(6, 182, 212, 0.2) 0%, transparent 70%);
  animation: glow 2s ease-in-out infinite;
}

@keyframes glow {
  0%, 100% {
    opacity: 0.5;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}

@media (max-width: 768px) {
  .circular-progress {
    width: 100px;
    height: 100px;
  }
  
  .progress-ring {
    width: 100px;
    height: 100px;
  }
  
  .progress-text {
    font-size: 16px;
  }
  
  .loading-message {
    font-size: 14px;
  }
}
</style>
<style src="../loading-styles.css"></style>