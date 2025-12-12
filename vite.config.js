import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './frontend/src')
    }
  },

  root: './',
  publicDir: 'public',

  server: {
  host: '0.0.0.0',  // ← Thêm dòng này
  port: 5500,
  proxy: {
    '/api': {
      target: 'http://192.168.71.106:5501',
      changeOrigin: true
    }
  }
}
})
