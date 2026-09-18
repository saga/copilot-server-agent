import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// React 通过相对路径 /api/* 调用 Express，dev 经 proxy 转发避免 CORS
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
