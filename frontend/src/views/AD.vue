<template>
  <div class="qc-dashboard">
    <header>
      <h1><i class="fas fa-network-wired"></i> QC Lines Dashboard</h1>
      <div class="sub">Hệ thống quản lý Quality Control - An Dong</div>

      <div class="search-bar">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Tìm kiếm Line hoặc QC... (VD: Line 5, QC2)"
          @input="filterLines"
        />
        <span class="counter">
          <i class="fas fa-layer-group"></i> {{ filteredLines.length }} /
          {{ totalLines }} lines
        </span>
      </div>
    </header>

    <div class="lines-grid" v-if="filteredLines.length > 0">
      <div v-for="line in filteredLines" :key="line.number" class="line-card">
        <div class="line-header">
          <div class="line-icon">{{ line.number }}</div>
          <div class="line-title">Line {{ line.number }}</div>
        </div>

        <div class="qc-links">
          <div v-for="qc in line.qcs" :key="qc.number" class="qc-block">
            <div class="qc-title">QC {{ qc.number }}</div>
            <div class="qc-buttons">
              <button class="btn btn-green" @click="callQC(line.number, qc.number, qc.code, 1)">
                Xanh
              </button>
              <button class="btn btn-yellow" @click="callQC(line.number, qc.number, qc.code, 2)">
                Vàng
              </button>
              <button class="btn btn-red" @click="callQC(line.number, qc.number, qc.code, 3)">
                Đỏ
              </button>
              <button class="btn btn-buzzer" @click="callQC(line.number, qc.number, qc.code, 4)">
                Còi
              </button>
              <button class="btn btn-off" @click="callQC(line.number, qc.number, qc.code, 0)">
                Tắt
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <i class="fas fa-search"></i>
      <h3>Không tìm thấy kết quả</h3>
      <p>Thử tìm kiếm với từ khóa khác</p>
    </div>
  </div>
</template>

<script>

import { ElMessage, ElMessageBox } from 'element-plus';
export default {
  name: "QCDashboard",
  
  data() {
    return {
      searchQuery: "",
      lines: [],
      filteredLines: [],
      totalLines: 11,
    };
  },
  created() {
    this.initializeLines();
  },
  
  methods: {
    initializeLines() {
      // Generate data for 11 lines, each with 3 QCs
      this.lines = Array.from({ length: 11 }, (_, i) => {
        const lineNumber = i + 1;
        return {
          number: lineNumber,
          qcs: Array.from({ length: 3 }, (_, j) => {
            const qcNumber = j + 1;
            return {
              number: qcNumber,
              code: `l${lineNumber}q${qcNumber}`, // dùng code để gửi API
            };
          }),
        };
      });
      this.filteredLines = [...this.lines];
    },

  async callQC(lineNumber, qcNumber, code, id) {
      try {
        const url = `/api/run/${code}?id=${id}`;
        const res = await fetch(url);
        const data = await res.text();

        ElMessage({ message: 'Lệnh đã gửi thành công!', type: 'success', duration: 2000 });

      } catch (err) {
        console.error(err);
        ElMessage({ message: 'Gửi lệnh thất bại!', type: 'error', duration: 2000 });
      }
    },




    filterLines() {
      const query = this.searchQuery.toLowerCase().trim();
      if (!query) {
        this.filteredLines = [...this.lines];
        return;
      }

      this.filteredLines = this.lines.filter((line) => {
        const lineMatch =
          `line ${line.number}`.toLowerCase().includes(query) ||
          `line${line.number}`.toLowerCase().includes(query) ||
          line.number.toString().includes(query);
        const qcMatch = line.qcs.some(
          (qc) =>
            `qc ${qc.number}`.toLowerCase().includes(query) ||
            `qc${qc.number}`.toLowerCase().includes(query) ||
            qc.number.toString().includes(query)
        );
        return lineMatch || qcMatch;
      });
    },
  },
};
</script>
<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.qc-dashboard {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
  font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
  background: #07101a;
  color: #e6eef6;
  min-height: 100vh;
}

header {
  background: #0f1c2e;
  padding: 24px 32px;
  border-radius: 12px;
  margin-bottom: 24px;
  border: 1px solid #1e3a5f;
  animation: slideDown 0.5s ease;
}

header h1 {
  font-size: 2em;
  font-weight: 700;
  color: #06b6d4;
  margin-bottom: 8px;
}

header h1 i {
  margin-right: 12px;
}

.sub {
  color: #94a3b8;
  font-size: 0.95em;
}

.search-bar {
  margin-top: 20px;
  display: flex;
  gap: 12px;
  align-items: center;
}

.search-bar input {
  flex: 1;
  padding: 12px 16px;
  background: #07101a;
  border: 1px solid #1e3a5f;
  border-radius: 8px;
  color: #e6eef6;
  font-size: 1em;
  transition: all 0.3s ease;
}

.search-bar input:focus {
  outline: none;
  border-color: #06b6d4;
  box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.1);
}

.search-bar input::placeholder {
  color: #94a3b8;
}

.counter {
  color: #94a3b8;
  white-space: nowrap;
}

.lines-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 20px;
  animation: fadeInUp 0.6s ease;
}

.line-card {
  background: #0f1c2e;
  border: 1px solid #1e3a5f;
  border-radius: 12px;
  padding: 24px;
  transition: all 0.3s ease;
}

.line-card:hover {
  transform: translateY(-4px);
  border-color: #06b6d4;
  box-shadow: 0 8px 24px rgba(6, 182, 212, 0.15);
}

.line-header {
  display: flex;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 2px solid #1e3a5f;
}

.line-icon {
  width: 48px;
  height: 48px;
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 100%);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 1.3em;
  font-weight: bold;
  margin-right: 14px;
  box-shadow: 0 4px 12px rgba(6, 182, 212, 0.3);
}

.line-title {
  font-size: 1.5em;
  font-weight: 700;
  color: #e6eef6;
}

.qc-links {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.qc-block {
  background: #07101a;
  border: 1px solid #1e3a5f;
  border-radius: 10px;
  padding: 12px;
}

.qc-title {
  font-weight: 600;
  margin-bottom: 8px;
  color: #06b6d4;
}

.qc-buttons {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.qc-buttons button {
  flex: 1;
  padding: 8px 10px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.9em;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.25s ease;
  color: #fff;
}

.qc-buttons button:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(6, 182, 212, 0.2);
}

.btn-green {
  background: #06d410;
  border: 1px solid #08b233;
}
.btn-yellow {
  background: #facc15;
  border: 1px solid #d97706;
  color: #000;
}
.btn-red {
  background: #ef4444;
  border: 1px solid #b91c1c;
}
.btn-buzzer {
  background: #9333ea;
  border: 1px solid #6b21a8;
}
.btn-off {
  background: #374151;
  border: 1px solid #1f2937;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #94a3b8;
}

.empty-state i {
  font-size: 4em;
  margin-bottom: 16px;
  opacity: 0.3;
}

.empty-state h3 {
  margin-bottom: 8px;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 768px) {
  .qc-dashboard {
    padding: 12px;
  }
  header {
    padding: 20px;
  }
  header h1 {
    font-size: 1.5em;
  }
  .lines-grid {
    grid-template-columns: 1fr;
  }
  .line-title {
    font-size: 1.3em;
  }
  .search-bar {
    flex-direction: column;
    align-items: stretch;
  }
  .counter {
    text-align: center;
  }
  .qc-buttons {
    flex-wrap: wrap;
    gap: 4px;
  }
}
</style>
