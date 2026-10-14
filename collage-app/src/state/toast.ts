import { create } from 'zustand';

export type ToastKind = 'info' | 'error' | 'success';
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, kind?: ToastKind, ms?: number) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, kind = 'info', ms) => {
    const id = ++seq;
    set({ toasts: [...get().toasts.filter((t) => t.message !== message), { id, kind, message }] });
    const duration = ms ?? (kind === 'error' ? 7000 : 2600);
    setTimeout(() => get().dismiss(id), duration);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  info: (m: string) => useToast.getState().show(m, 'info'),
  success: (m: string) => useToast.getState().show(m, 'success'),
  error: (m: string) => useToast.getState().show(m, 'error'),
};
