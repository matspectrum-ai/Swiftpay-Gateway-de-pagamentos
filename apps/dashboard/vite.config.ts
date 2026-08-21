import { defineConfig } from 'vite';

const securityHeaders = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

export default defineConfig({
  server: {
    host: '127.0.0.1',
    headers: securityHeaders,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    headers: securityHeaders,
  },
});
