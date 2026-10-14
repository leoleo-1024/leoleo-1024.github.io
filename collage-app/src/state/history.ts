/** スナップショット方式の Undo/Redo 履歴（画像本体は参照のみなので軽量） */
export interface History<T> {
  past: T[];
  future: T[];
}

export const HISTORY_LIMIT = 50;

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [] };
}

export function pushHistory<T>(h: History<T>, before: T, limit = HISTORY_LIMIT): History<T> {
  const past = [...h.past, before];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, future: [] };
}

export function undoHistory<T>(h: History<T>, current: T): { history: History<T>; value: T } | null {
  if (!h.past.length) return null;
  const value = h.past[h.past.length - 1];
  return { value, history: { past: h.past.slice(0, -1), future: [current, ...h.future] } };
}

export function redoHistory<T>(h: History<T>, current: T): { history: History<T>; value: T } | null {
  if (!h.future.length) return null;
  const [value, ...future] = h.future;
  return { value, history: { past: [...h.past, current], future } };
}
