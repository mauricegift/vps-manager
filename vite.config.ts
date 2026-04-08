import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5758,
    host: true,
    allowedHosts: true,
    watch: {
      ignored: ['**/.local/**', '**/.cache/**', '**/node_modules/**'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5756',
        changeOrigin: true,
        ws: false,
        configure: (proxy) => {
          proxy.on('error', (err: any) => {
            if (err.code === 'ECONNREFUSED') return; // backend not ready yet
          });
        },
      },
      '/socket.io': {
        target: 'http://localhost:5756',
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (err: any) => {
            if (err.code === 'ECONNREFUSED') return;
          });
        },
      },
    },
  },
})
