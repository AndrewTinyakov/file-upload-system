import { build } from 'esbuild';
await build({ entryPoints: ['src/browser.ts'], bundle: true, format: 'iife', outfile: 'public/browser.js', target: 'chrome140' });
await build({ entryPoints: ['/src/client/src/main.tsx'], bundle: true, format: 'esm', outfile: 'public/app.js', define: { 'import.meta.env.VITE_API_URL': '"http://api:8080/api"' }, loader: { '.css': 'css' }, jsx: 'automatic', target: 'chrome140' });
