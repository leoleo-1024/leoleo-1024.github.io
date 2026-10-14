import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useToast } from '../state/toast';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' };

export function Button({ variant = 'secondary', className, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition active:scale-[0.98] disabled:opacity-40',
        variant === 'primary' && 'bg-accent text-white',
        variant === 'secondary' && 'bg-surface-2 text-white',
        variant === 'danger' && 'bg-surface-2 text-danger',
        variant === 'ghost' && 'bg-transparent text-accent',
        className,
      )}
    />
  );
}

export function IconButton({
  label,
  children,
  className,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'inline-flex h-11 min-w-11 items-center justify-center rounded-full px-2 text-white transition active:opacity-60 disabled:opacity-30',
        active && 'text-accent',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** 下部ツールバーのボタン（アイコン＋ラベル） */
export function ToolButton({
  icon,
  label,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode; label: string; active?: boolean }) {
  return (
    <button
      {...rest}
      className={cx(
        'flex min-h-14 min-w-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11px] transition active:opacity-60 disabled:opacity-30',
        active ? 'text-accent' : 'text-white/90',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
  onStart,
  onEnd,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
}) {
  return (
    <label className="flex items-center gap-3 py-1">
      <span className="w-20 shrink-0 text-[13px] text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onPointerDown={onStart}
        onPointerUp={onEnd}
        onKeyDown={onStart}
        onKeyUp={onEnd}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="w-12 shrink-0 text-right text-[13px] tabular-nums text-white/80">{format ? format(value) : value}</span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-xl bg-surface-2 p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'min-h-9 flex-1 rounded-lg px-2 text-[13px] font-medium transition',
            value === o.value ? 'bg-surface-3 text-white shadow' : 'text-white/70',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toasts() {
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--sat)+48px)] z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cx(
            'pointer-events-auto mt-2 max-w-md animate-fade rounded-2xl px-4 py-3 text-left text-[14px] shadow-xl backdrop-blur-xl',
            t.kind === 'error' ? 'bg-[#3a1512]/95 text-[#ffb4ab]' : t.kind === 'success' ? 'bg-[#13301c]/95 text-[#a6f4b6]' : 'bg-surface-2/95 text-white',
          )}
          role={t.kind === 'error' ? 'alert' : 'status'}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex animate-fade items-center justify-center bg-black/60 p-6" onClick={onCancel}>
      <div role="dialog" aria-modal="true" className="w-full max-w-xs rounded-2xl bg-surface-2 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-4">
          <h2 className="text-[17px] font-semibold">{title}</h2>
          {message && <p className="mt-1 text-[13px] text-white/70">{message}</p>}
        </div>
        <div className="flex border-t border-white/10">
          <button className="min-h-12 flex-1 text-[17px] text-accent" onClick={onCancel}>
            キャンセル
          </button>
          <button
            className={cx('min-h-12 flex-1 border-l border-white/10 text-[17px] font-semibold', danger ? 'text-danger' : 'text-accent')}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProgressOverlay({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60" role="progressbar" aria-valuenow={pct} aria-label={label}>
      <div className="w-64 rounded-2xl bg-surface-2 p-5 text-center">
        <p className="text-[15px]">{label}</p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-[12px] text-muted tabular-nums">
          {done} / {total}
        </p>
      </div>
    </div>
  );
}

export function Header({ left, title, right }: { left?: ReactNode; title?: ReactNode; right?: ReactNode }) {
  return (
    <header className="pt-safe shrink-0 bg-black/80 backdrop-blur-xl">
      <div className="flex h-12 items-center gap-1 px-1">
        <div className="flex min-w-0 flex-1 items-center">{left}</div>
        <div className="min-w-0 truncate px-2 text-center text-[17px] font-semibold">{title}</div>
        <div className="flex min-w-0 flex-1 items-center justify-end">{right}</div>
      </div>
    </header>
  );
}
