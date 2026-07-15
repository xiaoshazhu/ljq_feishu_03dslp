import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@lark-base-open/connector-api')) return 'connector-sdk';
          if (id.includes('@lark-base-open/js-sdk')) return 'base-sdk';
          if (
            id.includes('ant-design-vue')
            || id.includes('@ant-design/icons')
            || id.includes('@ant-design/colors')
          ) {
            return 'antd-vendor';
          }
          if (id.includes('/vue/') || id.includes('/@vue/')) return 'vue-vendor';
          return 'vendor';
        }
      }
    }
  }
});
