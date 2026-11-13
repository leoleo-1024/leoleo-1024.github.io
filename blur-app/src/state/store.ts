/** 小さな外部ストア（React の useSyncExternalStore で購読） */
import { useSyncExternalStore } from 'react';
import { DEFAULT_STRENGTH } from '../engine/params';
import type { EffectParams, EffectType } from '../engine/types';

export type Tool = 'brush' | 'rect' | 'ellipse' | 'eraser' | 'move';

export interface ImageInfo {
  name: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  /** 縮小して開いた場合の元のサイズ */
  reducedFrom?: { width: number; height: number };
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export interface DialogAction {
  label: string;
  kind?: 'primary' | 'danger' | 'cancel';
  onSelect?: () => void;
}

export interface Dialog {
  title: string;
  message: string;
  actions: DialogAction[];
}

export interface AppState {
  image: ImageInfo | null;
  busy: { message: string; progress?: number } | null;
  effect: EffectType;
  tool: Tool;
  /** ブラシの直径（CSS px） */
  brushSize: number;
  eraserSize: number;
  params: Record<EffectType, EffectParams>;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  pending: 'rect' | 'ellipse' | null;
  zoom: number;
  comparing: boolean;
  /** スライダー操作中（ブラシの大きさを画面中央に表示） */
  sizePreview: boolean;
  toast: Toast | null;
  /** プレビューの再計算中（大きな範囲） */
  rendering: boolean;
  dialog: Dialog | null;
}

const defaultParams = (): EffectParams => ({ strength: DEFAULT_STRENGTH, swirlDirection: 'cw', angle: 0 });

export const initialState = (): AppState => ({
  image: null,
  busy: null,
  effect: 'gaussianBlur',
  tool: 'brush',
  brushSize: 32,
  eraserSize: 32,
  params: {
    gaussianBlur: defaultParams(),
    pixelate: defaultParams(),
    blackout: defaultParams(),
    swirl: defaultParams(),
    motionBlur: defaultParams(),
  },
  canUndo: false,
  canRedo: false,
  dirty: false,
  pending: null,
  zoom: 1,
  comparing: false,
  sizePreview: false,
  toast: null,
  rendering: false,
  dialog: null,
});

type Listener = () => void;

export class Store<T extends object> {
  private state: T;
  private listeners = new Set<Listener>();
  constructor(init: T) {
    this.state = init;
  }
  get = (): T => this.state;
  set = (patch: Partial<T> | ((s: T) => Partial<T>)): void => {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    let changed = false;
    for (const k in p) if (!Object.is(p[k], this.state[k])) changed = true;
    if (!changed) return;
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  };
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export const store = new Store<AppState>(initialState());

export function useStore<R>(sel: (s: AppState) => R): R {
  return useSyncExternalStore(store.subscribe, () => sel(store.get()));
}

let toastId = 0;
export function showToast(text: string, kind: Toast['kind'] = 'info') {
  store.set({ toast: { id: ++toastId, text, kind } });
}

export function setParams(effect: EffectType, patch: Partial<EffectParams>) {
  store.set((s) => ({ params: { ...s.params, [effect]: { ...s.params[effect], ...patch } } }));
}
