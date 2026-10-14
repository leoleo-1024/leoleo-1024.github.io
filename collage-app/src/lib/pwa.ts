/**
 * Service Worker の更新管理。
 * 新しいバージョンを検出しても編集中には再読み込みせず、
 * ホーム画面に戻ったとき（プロジェクトを保存して閉じた後）に適用する。
 * 適用されないままアプリを終了した場合は、次回起動時に新しいバージョンになる。
 */
let pendingUpdate: ((reload?: boolean) => Promise<void>) | null = null;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          pendingUpdate = updateSW;
        },
      });
    })
    .catch(() => {});
}

/** 更新待ちのバージョンがあれば適用する（ページが再読み込みされる） */
export function applyPendingUpdate(): boolean {
  if (!pendingUpdate) return false;
  const update = pendingUpdate;
  pendingUpdate = null;
  void update(true);
  return true;
}
