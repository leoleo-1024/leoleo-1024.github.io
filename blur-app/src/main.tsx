import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getEditor } from './editor/session';
import { registerServiceWorker } from './lib/pwa';
import { showToast, store } from './state/store';
import './ui/styles.css';

// iOS Safari：ピンチでページ全体が拡大されるのを防ぐ（編集エリアの操作を優先）
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
// ダブルタップでの拡大を防ぐ
let lastTouchEnd = 0;
document.addEventListener(
  'touchend',
  (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 300 && (e.target as HTMLElement)?.closest?.('button')) e.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false },
);

window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  showToast('予期しないエラーが発生しました。もう一度お試しください。', 'error');
});

// PWA：静的ファイルだけをキャッシュしてオフラインで使えるようにする（写真はキャッシュしない）
registerServiceWorker(() => !getEditor() && !store.get().busy);

// E2E テスト用ビルド（VITE_E2E=1）でのみ内部状態を公開する
if (import.meta.env.VITE_E2E === '1') {
  (window as unknown as Record<string, unknown>).__app = { getEditor, store };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
