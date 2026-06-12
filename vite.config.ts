import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const deepseekApiBase = env.DEEPSEEK_API_BASE || 'https://api.deepseek.com';
  const deepseekApiKey = env.DEEPSEEK_API_KEY;

  return {
    plugins: [react(), cloudflare()],
    optimizeDeps: {
      entries: ['index.html'],
    },
    server: {
      port: 5173,
      proxy: {
        '/api/llm': {
          target: deepseekApiBase,
          changeOrigin: true,
          rewrite: () => '/chat/completions',
          configure(proxy) {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Content-Type', 'application/json');
              if (deepseekApiKey) proxyReq.setHeader('Authorization', `Bearer ${deepseekApiKey}`);
            });
          },
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/three/examples/')) return 'three-postprocessing';
            if (id.includes('/node_modules/three/')) return 'three';
            if (id.includes('/node_modules/@xyflow/')) return 'xyflow';
            if (id.includes('/node_modules/katex/')) return 'katex';
          },
        },
      },
    },
  };
});