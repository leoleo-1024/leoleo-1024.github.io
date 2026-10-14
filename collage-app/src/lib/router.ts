import { useSyncExternalStore } from 'react';

/**
 * ハッシュベースの最小ルーター。
 * GitHub Pages などの静的ホスティングでもリロード・戻る操作が機能する。
 */
export type Route =
  | { name: 'home' }
  | { name: 'settings' }
  | { name: 'images'; projectId: string }
  | { name: 'editor'; projectId: string }
  | { name: 'preview'; projectId: string }
  | { name: 'export'; projectId: string };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'p' && parts[1]) {
    const projectId = decodeURIComponent(parts[1]);
    switch (parts[2]) {
      case 'images':
        return { name: 'images', projectId };
      case 'preview':
        return { name: 'preview', projectId };
      case 'export':
        return { name: 'export', projectId };
      default:
        return { name: 'editor', projectId };
    }
  }
  return { name: 'home' };
}

export function routeToHash(r: Route): string {
  switch (r.name) {
    case 'home':
      return '#/';
    case 'settings':
      return '#/settings';
    case 'editor':
      return `#/p/${encodeURIComponent(r.projectId)}/edit`;
    default:
      return `#/p/${encodeURIComponent(r.projectId)}/${r.name}`;
  }
}

export function navigate(r: Route, opts: { replace?: boolean } = {}) {
  const hash = routeToHash(r);
  if (opts.replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = hash;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return parseRoute(hash);
}
