<template>
  <div class="login-container">
    <div class="login-box">
      <img src="../assets/LogoYS.png" alt="Logo">
      <h2>Đăng nhập hệ thống</h2>
      
      <div class="input-group">
        <i class="fa fa-user"></i>
        <input 
          v-model="userid" 
          type="text" 
          placeholder="Tên đăng nhập" 
          autocomplete="off"
          @keypress.enter="login"
        >
      </div>
      
      <div class="input-group">
        <i class="fa fa-lock"></i>
        <input 
          v-model="pwd" 
          type="password" 
          placeholder="Mật khẩu" 
          autocomplete="off"
          @keypress.enter="login"
        >
      </div>
      
      <button @click="login" :disabled="loading">
        <i class="fa fa-sign-in-alt"></i> 
        {{ loading ? 'Đang đăng nhập...' : 'Đăng nhập' }}
      </button>
      
      <div class="msg" :style="{ color: msgColor }">{{ message }}</div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'Login',
  data() {
    return {
      userid: '',
      pwd: '',
      message: '',
      msgColor: '',
      loading: false,
      API_BASE: ''
    };
  },
  methods: {
    async login() {
      if (!this.userid.trim() || !this.pwd.trim()) {
        this.message = '⚠️ Vui lòng nhập đầy đủ thông tin';
        this.msgColor = 'red';
        return;
      }

      this.loading = true;
      this.message = '';

      try {
        const res = await fetch(`${this.API_BASE}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userid: this.userid.trim(),
            pwd: this.pwd.trim()
          })
        });

        const data = await res.json();

        if (data.success) {
          this.message = '✅ Đăng nhập thành công!';
          this.msgColor = 'green';
          localStorage.setItem('user', JSON.stringify(data.user));
          
          // Chuyển hướng sau 1 giây
          setTimeout(() => {
            this.$router.push('/home');
          }, 1000);
        } else {
          this.message = '❌ ' + (data.message || 'Sai tài khoản/mật khẩu');
          this.msgColor = 'red';
        }
      } catch (err) {
        console.error(err);
        this.message = '❌ Không kết nối được server';
        this.msgColor = 'red';
      } finally {
        this.loading = false;
      }
    }
  }
};
</script>

<style scoped>
.login-container {
  font-family: "Segoe UI", Arial, sans-serif;
  background: linear-gradient(135deg, #e0f7fa, #e3f2fd);
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  margin: 0;
}

.login-box {
  background: #fff;
  padding: 40px 35px;
  border-radius: 12px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.15);
  width: 360px;
  text-align: center;
  animation: fadeIn 0.6s ease;
}

.login-box img {
  width: 80px;
  margin-bottom: 15px;
}

.login-box h2 {
  margin-bottom: 25px;
  font-size: 20px;
  font-weight: 600;
  color: #333;
}

.input-group {
  display: flex;
  align-items: center;
  margin: 10px 0;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 10px;
  background: #fafafa;
}

.input-group i {
  margin-right: 8px;
  color: #666;
}

.input-group input {
  border: none;
  outline: none;
  flex: 1;
  font-size: 14px;
  background: transparent;
}

button {
  width: 100%;
  padding: 12px;
  background: #007bff;
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  margin-top: 15px;
  transition: 0.3s;
}

button:hover:not(:disabled) {
  background: #0056b3;
}

button:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.msg {
  margin-top: 15px;
  font-size: 14px;
  font-weight: 500;
  min-height: 20px;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>