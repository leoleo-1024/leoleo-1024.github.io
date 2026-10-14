import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { registerServiceWorker } from './lib/pwa';
import { toast } from './state/toast';
import './index.css';

// iOS Safari：ピンチ操作でページ全体が拡大されるのを防ぐ（キャンバス内の操作を優先）
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast.error('予期しないエラーが発生しました。操作をやり直してください。改善しない場合はアプリを再読み込みしてください。');
});

// PWA：Service Worker を登録してオフラインで使えるようにする
registerServiceWorker();

// E2E テスト用ビルド（VITE_E2E=1）でのみ内部状態を公開する。
// 本番ビルドでは条件が false に置き換わり、このコードは出力に含まれない。
if (import.meta.env.VITE_E2E === '1') {
  void import('./testHooks').then((m) => m.installTestHooks());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
