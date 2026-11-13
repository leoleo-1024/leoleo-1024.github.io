/**
 * Service Worker の登録と更新管理。
 * 新しいバージョンを検出しても編集中には再読み込みせず、写真を開いていないときに適用する。
 */
let pendingUpdate: ((reload?: boolean) => Promise<void>) | null = null;
let canApplyNow: () => boolean = () => true;

export function registerServiceWorker(isIdle: () => boolean) {
  canApplyNow = isIdle;
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          pendingUpdate = updateSW;
          applyPendingUpdate();
        },
      });
    })
    .catch(() => {});
}

/** 更新待ちのバージョンがあり、編集中でなければ適用する（ページが再読み込みされる） */
export function applyPendingUpdate(): boolean {
  if (!pendingUpdate || !canApplyNow()) return false;
  const update = pendingUpdate;
  pendingUpdate = null;
  void update(true);
  return true;
}
