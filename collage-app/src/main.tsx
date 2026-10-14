import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { toast } from './state/toast';
import { useEditor } from './state/editorStore';
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
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}

// 動作検証（E2E テスト）用に状態を参照できるようにする（ローカルのみで外部送信はしない）
(window as unknown as { __editor: typeof useEditor }).__editor = useEditor;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
