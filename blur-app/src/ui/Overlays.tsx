/** 共通の重ね表示：処理中・確認ダイアログ・トースト */
import { useEffect } from 'react';
import { store, useStore } from '../state/store';

export function BusyOverlay() {
  const busy = useStore((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="busy" role="status" aria-live="polite" data-testid="busy">
      <div className="busy-box">
        <div className="spinner" />
        <div>{busy.message}</div>
        {busy.progress !== undefined && (
          <div className="progress">
            <div style={{ width: `${Math.round(busy.progress * 100)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

export function DialogHost() {
  const d = useStore((s) => s.dialog);
  if (!d) return null;
  return (
    <div className="modal-bg" data-testid="dialog">
      <div className="modal" role="alertdialog" aria-labelledby="dlg-title">
        <h2 id="dlg-title">{d.title}</h2>
        <p>{d.message}</p>
        <div className="modal-actions">
          {d.actions.map((a) => (
            <button
              key={a.label}
              className={`btn ${a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : ''}`}
              onClick={() => {
                store.set({ dialog: null });
                a.onSelect?.();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ToastHost() {
  const t = useStore((s) => s.toast);
  useEffect(() => {
    if (!t) return;
    const ms = Math.min(9000, 2500 + t.text.length * 60);
    const id = setTimeout(() => {
      if (store.get().toast?.id === t.id) store.set({ toast: null });
    }, ms);
    return () => clearTimeout(id);
  }, [t]);
  if (!t) return null;
  return (
    <div className={`toast ${t.kind === 'error' ? 'toast-error' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'} data-testid="toast" onClick={() => store.set({ toast: null })}>
      {t.text}
    </div>
  );
}
