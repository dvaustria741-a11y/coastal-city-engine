import { defineConfig } from 'vite';
export default defineConfig({ base: './', server: { host: '0.0.0.0', port: 3000, allowedHosts: true }, build: { target: 'es2022', chunkSizeWarningLimit: 1800, rollupOptions: { output: { manualChunks(id) { if (id.includes('node_modules/three') || id.includes('three/webgpu') || id.includes('three/tsl')) return 'three'; } } } } });
