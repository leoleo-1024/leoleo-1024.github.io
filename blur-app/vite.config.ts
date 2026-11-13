/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages では https://<user>.github.io/blur/ に配置する
const base = process.env.APP_BASE ?? '/blur/';

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '1.0.0'),
  },
  plugins: [
    react(),
    VitePWA({
      // 編集中に勝手に再読み込みされないよう、更新の適用はアプリ側で制御する（src/lib/pwa.ts）
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        name: 'ぼかし・モザイク',
        short_name: 'ぼかし',
        description: '写真の一部にぼかし・モザイク・黒塗り・渦巻き・モーションブラーをかけるアプリ（端末内で処理）',
        lang: 'ja',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#000000',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 静的アセットのみをキャッシュ（写真はキャッシュしない：写真は blob: URL でのみ扱う）
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  worker: { format: 'es' },
  build: {
    outDir: '../blur',
    emptyOutDir: true,
    target: ['es2020', 'safari15'],
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
