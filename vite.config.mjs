import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig(({ mode, command }) => ({
  root: 'web', publicDir: false,
  plugins: [react(), tailwindcss(), {
    name: 'dispatch-preview-title',
    transformIndexHtml(html) {
      return mode === 'preview' || command === 'serve'
        ? html.replace('<title>dispatch · Local agent workspace</title>', '<title>PREVIEW · dispatch</title>')
        : html;
    },
  }],
  resolve: { alias: { '@': fileURLToPath(new URL('./web', import.meta.url)) } },
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: { host: '127.0.0.1', proxy: { ...Object.fromEntries(['/api'].map(path => [path, { target: 'http://127.0.0.1:4317', changeOrigin: true, configure: proxy => proxy.on('proxyReq', request => request.removeHeader('origin')) }])) } },
}));
