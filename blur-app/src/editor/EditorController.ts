/**
 * 編集画面のコントローラー（React 非依存）。
 * - 画像座標と表示座標の変換（ViewTransform）を一元管理
 * - タッチ／マウス操作（ブラシ・範囲選択・消しゴム・移動・ピンチ）
 * - プレビューの描画：縮小画像（プレビューレベル）全体 + 拡大時は表示範囲だけ高解像度で計算（詳細表示）
 * - 編集履歴と書き出し
 *
 * 画像処理はすべて Renderer（engine/）が行い、プレビューと書き出しで同じ処理を使う。
 */
import { History, newOpId } from '../engine/history';
import { shapeBounds } from '../engine/mask';
import { readLevel } from '../engine/pixels';
import { clampToSize, inflate, intersect, isEmpty } from '../engine/rect';
import { Renderer, TILE } from '../engine/renderer';
import { brushDabs } from '../engine/effects/swirl';
import type { EffectOp, EraseOp, IRect, Level, Op, Shape } from '../engine/types';
import { ViewTransform } from '../engine/view';
import { exportImage, type ExportOptions, type ExportResult } from '../lib/export';
import type { LoadedImage } from '../lib/loadImage';
import { store, type AppState } from '../state/store';

/** プレビューに使う縮小画像の長辺の上限 */
const PREVIEW_MAX_SIDE = 3000;
/** 詳細表示に使うレベルの選び方：レベルの1画素が表示上この値（デバイスpx）以下になるもの */
const DETAIL_MAX_DEVICE_PX = 1.25;
const DETAIL_MAX_AREA = 9_000_000;
/** ハンドルの当たり判定の半径（CSS px） */
const HANDLE_HIT = 24;
const MIN_SELECTION_CSS = 6;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Pending {
  type: 'rect' | 'ellipse';
  box: Box;
  op: EffectOp;
}

interface Detail {
  gen: number;
  li: number;
  rect: IRect;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'blocked' }
  | { kind: 'stroke'; pointerId: number }
  | { kind: 'pan'; pointerId: number; lastX: number; lastY: number }
  | { kind: 'pinch'; ix: number; iy: number; startDist: number; startScale: number }
  | { kind: 'select-create'; pointerId: number; sx: number; sy: number; ix: number; iy: number; started: boolean; before: Pending | null }
  | { kind: 'select-move'; pointerId: number; ix: number; iy: number; box: Box; before: Pending }
  | { kind: 'select-resize'; pointerId: number; handle: number; box: Box; before: Pending };

const normBox = (b: Box): Box => ({
  x0: Math.min(b.x0, b.x1),
  y0: Math.min(b.y0, b.y1),
  x1: Math.max(b.x0, b.x1),
  y1: Math.max(b.y0, b.y1),
});

function boxToShape(type: 'rect' | 'ellipse', b: Box): Shape {
  const n = normBox(b);
  if (type === 'rect') return { type: 'rect', x: n.x0, y: n.y0, w: n.x1 - n.x0, h: n.y1 - n.y0 };
  return { type: 'ellipse', cx: (n.x0 + n.x1) / 2, cy: (n.y0 + n.y1) / 2, rx: (n.x1 - n.x0) / 2, ry: (n.y1 - n.y0) / 2 };
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext('2d');
  if (!ctx) throw new RangeError('canvas');
  return [c, ctx];
}

function releaseCanvas(c: HTMLCanvasElement | null | undefined) {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}

function putRegion(ctx: CanvasRenderingContext2D, data: Uint8ClampedArray, w: number, h: number, x: number, y: number) {
  ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, w, h), x, y);
}

export class EditorController {
  readonly renderer: Renderer;
  readonly history = new History();
  readonly view = new ViewTransform();
  readonly name: string;
  readonly hasAlpha: boolean;
  /** プレビューに使うレベル */
  readonly pi: number;

  private previewCanvas: HTMLCanvasElement;
  private previewCtx: CanvasRenderingContext2D;
  private origCanvas: HTMLCanvasElement | null = null;
  private origDetail: { gen: number; canvas: HTMLCanvasElement } | null = null;

  private container: HTMLElement | null = null;
  private display: HTMLCanvasElement | null = null;
  private displayCtx: CanvasRenderingContext2D | null = null;
  private overlay: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private dpr = 1;
  private cleanup: Array<() => void> = [];

  private live: { op: EffectOp | EraseOp; dabs: number } | null = null;
  private pending: Pending | null = null;
  private gesture: Gesture = { kind: 'none' };
  private pointers = new Map<number, { x: number; y: number; type: string }>();
  private cursor: { x: number; y: number } | null = null;

  private detail: Detail | null = null;
  private oldDetail: Detail | null = null;
  private detailGen = 0;
  private detailTimer = 0;

  /** 再計算待ちのタイル（キー → 対象）。urgent はストローク中などすぐ反映したいもの */
  private urgent = new Map<string, { target: number; li: number; tx: number; ty: number }>();
  private background = new Map<string, { target: number; li: number; tx: number; ty: number }>();
  private raf = 0;
  private needDraw = false;
  private needOverlay = false;
  private disposed = false;
  private prevState: AppState;
  private unsub: () => void;

  constructor(img: LoadedImage) {
    this.name = img.name;
    this.hasAlpha = img.hasAlpha;
    this.renderer = new Renderer(img.levels);
    let pi = 0;
    while (pi + 1 < img.levels.length && Math.max(img.levels[pi].w, img.levels[pi].h) > PREVIEW_MAX_SIDE) pi++;
    this.pi = pi;
    const P = img.levels[pi];
    [this.previewCanvas, this.previewCtx] = makeCanvas(P.w, P.h);
    putRegion(this.previewCtx, P.data.slice(), P.w, P.h, 0, 0);
    this.view.setImage(img.width, img.height);
    this.prevState = store.get();
    this.unsub = store.subscribe(() => this.onStore());
  }

  get width() {
    return this.renderer.width;
  }
  get height() {
    return this.renderer.height;
  }
  private get P(): Level {
    return this.renderer.levels[this.pi];
  }

  // ======== DOM への接続 ========

  attach(container: HTMLElement, display: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    this.container = container;
    this.display = display;
    this.overlay = overlay;
    this.displayCtx = display.getContext('2d');
    this.overlayCtx = overlay.getContext('2d');
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on(container, 'pointerdown', (e) => this.onPointerDown(e));
    on(container, 'pointermove', (e) => this.onPointerMove(e));
    on(container, 'pointerup', (e) => this.onPointerUp(e, false));
    on(container, 'pointercancel', (e) => this.onPointerUp(e, true));
    on(container, 'pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.pointers.size) {
        this.cursor = null;
        this.requestOverlay();
      }
    });
    on(container, 'wheel', (e) => this.onWheel(e), { passive: false });
    // iOS Safari：キャンバス上のスクロール・拡大・長押しメニューを止める
    const prevent = (e: TouchEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('button')) e.preventDefault();
    };
    on(container, 'touchstart', prevent, { passive: false });
    on(container, 'touchmove', prevent, { passive: false });
    on(container, 'contextmenu', (e) => e.preventDefault());
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.cleanup.push(() => ro.disconnect());
    this.resize();
  }

  detach() {
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    this.container = this.display = this.overlay = null;
    this.displayCtx = this.overlayCtx = null;
  }

  dispose() {
    this.disposed = true;
    this.detach();
    this.unsub();
    cancelAnimationFrame(this.raf);
    clearTimeout(this.detailTimer);
    releaseCanvas(this.previewCanvas);
    releaseCanvas(this.origCanvas);
    releaseCanvas(this.origDetail?.canvas);
    releaseCanvas(this.detail?.canvas);
    releaseCanvas(this.oldDetail?.canvas);
    this.renderer.dispose();
  }

  private resize() {
    if (!this.container || !this.display || !this.overlay) return;
    const r = this.container.getBoundingClientRect();
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * this.dpr));
    const h = Math.max(1, Math.round(r.height * this.dpr));
    for (const c of [this.display, this.overlay]) {
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
    }
    this.view.setViewport(r.width, r.height);
    this.viewChanged();
  }

  // ======== 状態 ========

  /** 現在表示に使う操作列（履歴 + 描画中のストローク + 未適用の範囲選択） */
  ops(): Op[] {
    const ops: Op[] = [...this.history.ops];
    if (this.live) ops.push(this.live.op);
    if (this.pending) ops.push(this.pending.op);
    return ops;
  }

  private syncHistory() {
    store.set({ canUndo: this.history.canUndo, canRedo: this.history.canRedo, dirty: this.history.dirty });
  }

  private onStore() {
    const s = store.get();
    const p = this.prevState;
    this.prevState = s;
    if (s.comparing !== p.comparing) this.requestDraw();
    if (s.sizePreview !== p.sizePreview || s.brushSize !== p.brushSize || s.eraserSize !== p.eraserSize || s.tool !== p.tool) this.requestOverlay();
    if (!this.pending) return;
    if (s.tool !== p.tool) {
      if (s.tool === 'rect' || s.tool === 'ellipse') {
        this.setPending(s.tool, this.pending.box);
      } else if (s.tool === 'brush' || s.tool === 'eraser') {
        this.cancelPending();
      }
      return;
    }
    if (s.effect !== p.effect || s.params[s.effect] !== p.params[s.effect]) this.setPending(this.pending.type, this.pending.box);
  }

  // ======== 範囲選択 ========

  private makeEffectOp(shape: Shape): EffectOp {
    const s = store.get();
    return { id: newOpId(), kind: 'effect', effect: s.effect, params: { ...s.params[s.effect] }, shape };
  }

  private setPending(type: 'rect' | 'ellipse', box: Box) {
    const old = this.pending;
    const op = this.makeEffectOp(boxToShape(type, box));
    this.pending = { type, box, op };
    if (old) {
      this.markDirty(shapeBounds(old.op.shape), true);
      this.renderer.invalidateOp(old.op);
    }
    this.markDirty(shapeBounds(op.shape), true);
    store.set({ pending: type });
    this.requestOverlay();
  }

  /** 未適用の範囲選択を確定する */
  applyPending() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    // 同じ操作オブジェクトを履歴に入れるので、計算済みのキャッシュがそのまま使える（再計算不要）
    this.history.push(p.op);
    store.set({ pending: null });
    this.syncHistory();
    this.requestOverlay();
  }

  cancelPending() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.markDirty(shapeBounds(p.op.shape), true);
    this.renderer.invalidateOp(p.op);
    store.set({ pending: null });
    this.requestOverlay();
  }

  hasPending() {
    return !!this.pending;
  }

  // ======== 履歴 ========

  undo() {
    if (this.live || this.gesture.kind !== 'none') return;
    const op = this.history.undo();
    if (op) this.markDirty(shapeBounds(op.shape), false);
    this.syncHistory();
  }

  redo() {
    if (this.live || this.gesture.kind !== 'none') return;
    const op = this.history.redo();
    if (op) this.markDirty(shapeBounds(op.shape), false);
    this.syncHistory();
  }

  markSaved() {
    this.history.markSaved();
    this.syncHistory();
  }

  // ======== 表示 ========

  resetView() {
    this.view.reset();
    this.viewChanged();
  }

  /** 拡大率（1 = 全体表示）を指定（テスト・キーボード用） */
  zoomTo(zoom: number, sx = this.view.cw / 2, sy = this.view.ch / 2) {
    this.view.zoomAt(sx, sy, this.view.fitScale * zoom);
    this.viewChanged();
  }

  private viewChanged() {
    store.set({ zoom: Math.round(this.view.zoom * 100) / 100 });
    this.requestDraw();
    this.requestOverlay();
    clearTimeout(this.detailTimer);
    this.detailTimer = window.setTimeout(() => this.updateDetail(), this.gesture.kind === 'pinch' || this.gesture.kind === 'pan' ? 250 : 60);
  }

  /** 拡大表示時に、表示範囲だけを高解像度のレベルで計算する */
  private updateDetail() {
    if (this.disposed || this.gesture.kind === 'pinch' || this.gesture.kind === 'pan') return;
    const levels = this.renderer.levels;
    const need = this.view.scale * this.dpr; // デバイスpx / 元画像px
    const limitF = DETAIL_MAX_DEVICE_PX / need;
    if (levels[this.pi].f <= limitF) {
      this.dropDetail();
      return;
    }
    let li = 0;
    for (let i = this.pi - 1; i >= 0; i--) {
      if (levels[i].f <= limitF) {
        li = i;
        break;
      }
    }
    const vis = this.view.visibleImageRect();
    const levelRect = (l: number, pad: number) => {
      const L = levels[l];
      return clampToSize(
        inflate(
          { x: Math.floor(vis.x0 / L.f), y: Math.floor(vis.y0 / L.f), w: Math.ceil(vis.x1 / L.f) - Math.floor(vis.x0 / L.f), h: Math.ceil(vis.y1 / L.f) - Math.floor(vis.y0 / L.f) },
          pad,
        ),
        L.w,
        L.h,
      );
    };
    let rect = levelRect(li, 8);
    while (rect.w * rect.h > DETAIL_MAX_AREA && li < this.pi - 1) {
      li++;
      rect = levelRect(li, 8);
    }
    if (isEmpty(rect) || rect.w * rect.h > DETAIL_MAX_AREA) {
      this.dropDetail();
      return;
    }
    const d = this.detail;
    if (d && d.li === li && intersect(d.rect, rect).w === rect.w && intersect(d.rect, rect).h === rect.h) return;
    // 少し広めに確保して、小さな移動では作り直さないようにする
    const grow = Math.round(Math.max(rect.w, rect.h) * 0.2);
    let big = clampToSize(inflate(rect, grow), levels[li].w, levels[li].h);
    if (big.w * big.h > DETAIL_MAX_AREA) big = rect;
    let canvas: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D;
    try {
      [canvas, ctx] = makeCanvas(big.w, big.h);
    } catch {
      this.dropDetail();
      return;
    }
    // 古い詳細表示は新しいものが完成するまで下に表示しておく
    releaseCanvas(this.oldDetail?.canvas);
    this.oldDetail = this.detail;
    this.detail = { gen: ++this.detailGen, li, rect: big, canvas, ctx };
    releaseCanvas(this.origDetail?.canvas);
    this.origDetail = null;
    // 画面中央に近いタイルから計算
    const L = levels[li];
    const cx = ((vis.x0 + vis.x1) / 2 / L.f) / TILE;
    const cy = ((vis.y0 + vis.y1) / 2 / L.f) / TILE;
    const tiles: Array<{ tx: number; ty: number; d: number }> = [];
    for (let ty = Math.floor(big.y / TILE); ty <= Math.floor((big.y + big.h - 1) / TILE); ty++)
      for (let tx = Math.floor(big.x / TILE); tx <= Math.floor((big.x + big.w - 1) / TILE); tx++)
        tiles.push({ tx, ty, d: (tx + 0.5 - cx) ** 2 + (ty + 0.5 - cy) ** 2 });
    tiles.sort((a, b) => a.d - b.d);
    for (const t of tiles) this.enqueue(this.detail.gen, li, t.tx, t.ty, false);
    this.schedule();
  }

  private dropDetail() {
    releaseCanvas(this.detail?.canvas);
    releaseCanvas(this.oldDetail?.canvas);
    releaseCanvas(this.origDetail?.canvas);
    this.detail = this.oldDetail = this.origDetail = null;
    this.requestDraw();
  }

  // ======== 再計算の管理 ========

  private enqueue(target: number, li: number, tx: number, ty: number, urgent: boolean) {
    const key = `${target}|${tx}|${ty}`;
    const item = { target, li, tx, ty };
    if (urgent) {
      this.background.delete(key);
      this.urgent.set(key, item);
    } else if (!this.urgent.has(key)) this.background.set(key, item);
  }

  /** 元画像座標の範囲 b の表示を作り直す */
  private markDirty(b: { x0: number; y0: number; x1: number; y1: number }, urgent: boolean) {
    // 編集が入ったら、作り直し待ちの古い詳細表示は使わない
    if (this.oldDetail) {
      releaseCanvas(this.oldDetail.canvas);
      this.oldDetail = null;
    }
    const add = (target: number, li: number, clip: IRect) => {
      const L = this.renderer.levels[li];
      const r = intersect(
        inflate({ x: Math.floor(b.x0 / L.f), y: Math.floor(b.y0 / L.f), w: Math.ceil(b.x1 / L.f) - Math.floor(b.x0 / L.f), h: Math.ceil(b.y1 / L.f) - Math.floor(b.y0 / L.f) }, 2),
        clip,
      );
      if (isEmpty(r)) return;
      for (let ty = Math.floor(r.y / TILE); ty <= Math.floor((r.y + r.h - 1) / TILE); ty++)
        for (let tx = Math.floor(r.x / TILE); tx <= Math.floor((r.x + r.w - 1) / TILE); tx++) this.enqueue(target, li, tx, ty, urgent);
    };
    const P = this.P;
    add(0, this.pi, { x: 0, y: 0, w: P.w, h: P.h });
    if (this.detail) add(this.detail.gen, this.detail.li, this.detail.rect);
    this.schedule();
  }

  private schedule() {
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(() => this.frame());
  }

  private requestDraw() {
    this.needDraw = true;
    this.schedule();
  }

  private requestOverlay() {
    this.needOverlay = true;
    this.schedule();
  }

  private processTile(item: { target: number; li: number; tx: number; ty: number }, ops: Op[]) {
    let ctx: CanvasRenderingContext2D;
    let clip: IRect;
    if (item.target === 0) {
      ctx = this.previewCtx;
      clip = { x: 0, y: 0, w: this.P.w, h: this.P.h };
    } else {
      if (!this.detail || this.detail.gen !== item.target) return;
      ctx = this.detail.ctx;
      clip = this.detail.rect;
    }
    const r = intersect({ x: item.tx * TILE, y: item.ty * TILE, w: TILE, h: TILE }, clip);
    if (isEmpty(r)) return;
    const data = this.renderer.render(ops, item.li, r);
    putRegion(ctx, data, r.w, r.h, r.x - clip.x, r.y - clip.y);
  }

  private frame() {
    this.raf = 0;
    if (this.disposed) return;
    const start = performance.now();
    let ops: Op[] | null = null;
    try {
      if (this.urgent.size) {
        ops = this.ops();
        for (const [k, it] of this.urgent) {
          this.urgent.delete(k);
          this.processTile(it, ops);
          this.needDraw = true;
          if (performance.now() - start > 24) break;
        }
      }
      if (this.background.size && !this.urgent.size) {
        ops ??= this.ops();
        for (const [k, it] of this.background) {
          this.background.delete(k);
          this.processTile(it, ops);
          this.needDraw = true;
          if (performance.now() - start > 12) break;
        }
      }
    } catch (e) {
      console.error(e);
      this.urgent.clear();
      this.background.clear();
      store.set({ toast: { id: Date.now(), kind: 'error', text: 'メモリが不足したため表示を更新できませんでした。拡大を戻すか、アプリを再読み込みしてください。' } });
    }
    const busy = this.background.size > 0;
    if (!busy && this.oldDetail) {
      releaseCanvas(this.oldDetail.canvas);
      this.oldDetail = null;
      this.needDraw = true;
    }
    if (store.get().rendering !== busy) store.set({ rendering: busy });
    if (this.needDraw) this.draw();
    if (this.needOverlay) this.drawOverlay();
    if (busy || this.urgent.size) this.schedule();
  }

  private ensureOrig(): HTMLCanvasElement {
    if (!this.origCanvas) {
      const P = this.P;
      const [c, ctx] = makeCanvas(P.w, P.h);
      putRegion(ctx, P.data.slice(), P.w, P.h, 0, 0);
      this.origCanvas = c;
    }
    return this.origCanvas;
  }

  private draw() {
    this.needDraw = false;
    const ctx = this.displayCtx;
    if (!ctx || !this.display) return;
    const comparing = store.get().comparing;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.display.width, this.display.height);
    const s = this.view.scale * this.dpr;
    ctx.setTransform(s, 0, 0, s, this.view.tx * this.dpr, this.view.ty * this.dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.width, this.height);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const P = this.P;
    const drawLevel = (c: HTMLCanvasElement, f: number, rect: IRect) => ctx.drawImage(c, 0, 0, rect.w, rect.h, rect.x * f, rect.y * f, rect.w * f, rect.h * f);
    // 拡大時は画素がはっきり見えるように補間しない（モザイクのブロックなどを正確に確認できる）
    const sharp = (li: number) => this.renderer.levels[li].f * s > 3;
    if (comparing) {
      ctx.imageSmoothingEnabled = !sharp(this.pi);
      drawLevel(this.ensureOrig(), P.f, { x: 0, y: 0, w: P.w, h: P.h });
      const d = this.detail;
      if (d) {
        if (!this.origDetail || this.origDetail.gen !== d.gen) {
          releaseCanvas(this.origDetail?.canvas);
          const [c, cctx] = makeCanvas(d.rect.w, d.rect.h);
          putRegion(cctx, readLevel(this.renderer.levels[d.li], d.rect), d.rect.w, d.rect.h, 0, 0);
          this.origDetail = { gen: d.gen, canvas: c };
        }
        ctx.imageSmoothingEnabled = !sharp(d.li);
        drawLevel(this.origDetail.canvas, this.renderer.levels[d.li].f, d.rect);
      }
    } else {
      ctx.imageSmoothingEnabled = !sharp(this.pi);
      drawLevel(this.previewCanvas, P.f, { x: 0, y: 0, w: P.w, h: P.h });
      for (const d of [this.oldDetail, this.detail]) {
        if (!d) continue;
        ctx.imageSmoothingEnabled = !sharp(d.li);
        drawLevel(d.canvas, this.renderer.levels[d.li].f, d.rect);
      }
    }
    ctx.restore();
  }

  // ======== オーバーレイ（選択範囲・ブラシの円） ========

  private handlePositions(b: Box): Array<[number, number]> {
    const n = normBox(b);
    const [x0, y0] = this.view.toScreen(n.x0, n.y0);
    const [x1, y1] = this.view.toScreen(n.x1, n.y1);
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    return [
      [x0, y0],
      [mx, y0],
      [x1, y0],
      [x1, my],
      [x1, y1],
      [mx, y1],
      [x0, y1],
      [x0, my],
    ];
  }

  private drawOverlay() {
    this.needOverlay = false;
    const ctx = this.overlayCtx;
    if (!ctx || !this.overlay) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const s = store.get();
    if (this.pending && !s.comparing) {
      const n = normBox(this.pending.box);
      const [x0, y0] = this.view.toScreen(n.x0, n.y0);
      const [x1, y1] = this.view.toScreen(n.x1, n.y1);
      const path = () => {
        ctx.beginPath();
        if (this.pending!.type === 'rect') ctx.rect(x0, y0, x1 - x0, y1 - y0);
        else ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.max(0.5, (x1 - x0) / 2), Math.max(0.5, (y1 - y0) / 2), 0, 0, Math.PI * 2);
      };
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.setLineDash([]);
      path();
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#fff';
      ctx.setLineDash([6, 4]);
      path();
      ctx.stroke();
      ctx.setLineDash([]);
      if (this.pending.type === 'ellipse') {
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      }
      for (const [hx, hy] of this.handlePositions(this.pending.box)) {
        ctx.beginPath();
        ctx.arc(hx, hy, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.stroke();
      }
    }
    const circle = (x: number, y: number, d: number) => {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, d / 2), 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    };
    const sizeOfTool = s.tool === 'eraser' ? s.eraserSize : s.brushSize;
    if (s.sizePreview && (s.tool === 'brush' || s.tool === 'eraser')) circle(this.view.cw / 2, this.view.ch / 2, sizeOfTool);
    if (this.cursor && (s.tool === 'brush' || s.tool === 'eraser') && this.gesture.kind !== 'pinch') {
      // ストローク中はブラシの大きさ（拡大率に関係なく、開始時の大きさ）を表示
      const d = this.live && this.live.op.shape.type === 'brush' ? this.live.op.shape.radius * 2 * this.view.scale : sizeOfTool;
      circle(this.cursor.x, this.cursor.y, d);
    }
  }

  // ======== 入力 ========

  private local(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.container!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const [x, y] = this.local(e);
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
      this.view.zoomAt(x, y, this.view.scale * k);
    } else this.view.pan(-e.deltaX, -e.deltaY);
    this.viewChanged();
  }

  private onPointerDown(e: PointerEvent) {
    if (store.get().comparing || store.get().busy) return;
    // 編集エリア上のボタン（全体表示など）の操作は描画に使わない
    if ((e.target as HTMLElement | null)?.closest?.('button')) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    try {
      this.container?.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    const [x, y] = this.local(e);
    this.pointers.set(e.pointerId, { x, y, type: e.pointerType });
    if (this.pointers.size === 2) {
      this.abortGesture();
      this.startPinch();
      return;
    }
    if (this.pointers.size > 2 || this.gesture.kind !== 'none') return;
    const tool = store.get().tool;
    if (tool === 'move' || e.button === 1) {
      this.gesture = { kind: 'pan', pointerId: e.pointerId, lastX: x, lastY: y };
      return;
    }
    if (tool === 'brush' || tool === 'eraser') {
      this.startStroke(e.pointerId, x, y, tool === 'eraser');
      return;
    }
    this.startSelection(e.pointerId, x, y, tool);
  }

  private onPointerMove(e: PointerEvent) {
    const [x, y] = this.local(e);
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') {
        this.cursor = { x, y };
        this.requestOverlay();
      }
      return;
    }
    p.x = x;
    p.y = y;
    const g = this.gesture;
    switch (g.kind) {
      case 'pinch':
        this.updatePinch();
        break;
      case 'pan':
        if (g.pointerId !== e.pointerId) break;
        this.view.pan(x - g.lastX, y - g.lastY);
        g.lastX = x;
        g.lastY = y;
        this.viewChanged();
        break;
      case 'stroke': {
        if (g.pointerId !== e.pointerId) break;
        const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        const pts = evs.length ? evs.map((ev) => this.local(ev)) : [[x, y] as [number, number]];
        this.extendStroke(pts);
        this.cursor = { x, y };
        this.requestOverlay();
        break;
      }
      case 'select-create':
      case 'select-move':
      case 'select-resize':
        if (g.pointerId === e.pointerId) this.updateSelection(x, y);
        break;
    }
  }

  private onPointerUp(e: PointerEvent, cancelled: boolean) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (g.kind === 'pinch') {
      if (this.pointers.size < 2) {
        // 指が1本残っても、全部離すまでは描画を始めない（ピンチ後の誤描画防止）
        this.gesture = this.pointers.size ? { kind: 'blocked' } : { kind: 'none' };
        this.viewChanged();
      }
      return;
    }
    if (g.kind === 'blocked') {
      if (!this.pointers.size) this.gesture = { kind: 'none' };
      return;
    }
    if ('pointerId' in g && g.pointerId !== e.pointerId) return;
    if (g.kind === 'stroke') {
      if (cancelled) this.cancelStroke();
      else this.commitStroke();
    } else if (g.kind === 'pan') {
      this.gesture = { kind: 'none' };
      this.viewChanged();
    } else if (g.kind === 'select-create' || g.kind === 'select-move' || g.kind === 'select-resize') {
      if (cancelled) this.restoreSelection(g.before);
      this.gesture = { kind: 'none' };
    }
    if (e.pointerType !== 'mouse') this.cursor = null;
    this.gesture = this.pointers.size ? { kind: 'blocked' } : { kind: 'none' };
    this.requestOverlay();
  }

  /** 2本目の指が触れたときなど：進行中の操作を取り消す */
  private abortGesture() {
    const g = this.gesture;
    if (g.kind === 'stroke') this.cancelStroke();
    else if (g.kind === 'select-create' || g.kind === 'select-move' || g.kind === 'select-resize') this.restoreSelection(g.before);
    this.gesture = { kind: 'none' };
    this.cursor = null;
  }

  private startPinch() {
    const [a, b] = [...this.pointers.values()];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const [ix, iy] = this.view.toImage(mx, my);
    this.gesture = { kind: 'pinch', ix, iy, startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), startScale: this.view.scale };
    this.requestOverlay();
  }

  private updatePinch() {
    const g = this.gesture;
    if (g.kind !== 'pinch' || this.pointers.size < 2) return;
    const [a, b] = [...this.pointers.values()];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    this.view.pinch(g.ix, g.iy, mx, my, (g.startScale * dist) / g.startDist);
    this.viewChanged();
  }

  // ---- ブラシ・消しゴム ----

  private startStroke(pointerId: number, sx: number, sy: number, erase: boolean) {
    const s = store.get();
    const size = erase ? s.eraserSize : s.brushSize;
    const radius = Math.max(0.5, size / 2 / this.view.scale);
    const [ix, iy] = this.view.toImage(sx, sy);
    const shape = { type: 'brush' as const, points: [ix, iy], radius };
    const op: EffectOp | EraseOp = erase
      ? { id: newOpId(), kind: 'erase', shape }
      : { id: newOpId(), kind: 'effect', effect: s.effect, params: { ...s.params[s.effect] }, shape };
    this.live = { op, dabs: 1 };
    this.gesture = { kind: 'stroke', pointerId };
    this.cursor = { x: sx, y: sy };
    this.markDirty(shapeBounds(op.shape), true);
    this.requestOverlay();
  }

  private extendStroke(screenPts: Array<[number, number]>) {
    const live = this.live;
    if (!live) return;
    const shape = live.op.shape as Extract<Shape, { type: 'brush' }>;
    const pts = shape.points;
    const minStep = Math.max(0.5, shape.radius * 0.1);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let added = false;
    for (const [sx, sy] of screenPts) {
      const [ix, iy] = this.view.toImage(sx, sy);
      const lx = pts[pts.length - 2];
      const ly = pts[pts.length - 1];
      if (Math.hypot(ix - lx, iy - ly) < minStep) continue;
      x0 = Math.min(x0, lx, ix);
      y0 = Math.min(y0, ly, iy);
      x1 = Math.max(x1, lx, ix);
      y1 = Math.max(y1, ly, iy);
      pts.push(ix, iy);
      added = true;
    }
    if (!added) return;
    const r = shape.radius + 2;
    let dirty = { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r };
    if (live.op.kind === 'effect' && live.op.effect === 'swirl') {
      const n = brushDabs(live.op).xs.length;
      // 打点が1つから複数になると打点あたりの角度が変わるため全体を再計算
      if (live.dabs === 1 && n > 1) dirty = shapeBounds(shape);
      live.dabs = n;
    }
    this.renderer.invalidateOp(live.op, dirty);
    this.markDirty(dirty, true);
  }

  private commitStroke() {
    const live = this.live;
    this.live = null;
    this.gesture = { kind: 'none' };
    if (!live) return;
    this.history.push(live.op);
    this.syncHistory();
  }

  private cancelStroke() {
    const live = this.live;
    this.live = null;
    if (!live) return;
    this.renderer.invalidateOp(live.op);
    this.markDirty(shapeBounds(live.op.shape), true);
  }

  // ---- 範囲選択 ----

  private clampToImage(ix: number, iy: number): [number, number] {
    return [Math.min(this.width, Math.max(0, ix)), Math.min(this.height, Math.max(0, iy))];
  }

  private hitHandle(sx: number, sy: number): number {
    if (!this.pending) return -1;
    const hs = this.handlePositions(this.pending.box);
    let best = -1;
    let bestD = HANDLE_HIT;
    // 角を優先（小さな選択範囲でも角をつかめるように）
    for (const i of [0, 2, 4, 6, 1, 3, 5, 7]) {
      const d = Math.hypot(hs[i][0] - sx, hs[i][1] - sy);
      if (d < bestD - (i % 2 ? 4 : 0)) {
        best = i;
        bestD = d;
      }
    }
    return best;
  }

  private insidePending(sx: number, sy: number): boolean {
    if (!this.pending) return false;
    const n = normBox(this.pending.box);
    const [x0, y0] = this.view.toScreen(n.x0, n.y0);
    const [x1, y1] = this.view.toScreen(n.x1, n.y1);
    const pad = Math.max(0, 22 - Math.min(x1 - x0, y1 - y0) / 2);
    return sx >= x0 - pad && sx <= x1 + pad && sy >= y0 - pad && sy <= y1 + pad;
  }

  private snapshot(): Pending | null {
    return this.pending ? { ...this.pending, box: { ...this.pending.box } } : null;
  }

  private startSelection(pointerId: number, sx: number, sy: number, tool: 'rect' | 'ellipse') {
    if (this.pending) {
      const h = this.hitHandle(sx, sy);
      if (h >= 0) {
        this.gesture = { kind: 'select-resize', pointerId, handle: h, box: normBox(this.pending.box), before: this.snapshot()! };
        return;
      }
      if (this.insidePending(sx, sy)) {
        const [ix, iy] = this.view.toImage(sx, sy);
        this.gesture = { kind: 'select-move', pointerId, ix, iy, box: normBox(this.pending.box), before: this.snapshot()! };
        return;
      }
    }
    const [ix, iy] = this.clampToImage(...this.view.toImage(sx, sy));
    this.gesture = { kind: 'select-create', pointerId, sx, sy, ix, iy, started: false, before: this.snapshot() };
    void tool;
  }

  private updateSelection(sx: number, sy: number) {
    const g = this.gesture;
    const tool = store.get().tool;
    const type = tool === 'ellipse' ? 'ellipse' : tool === 'rect' ? 'rect' : (this.pending?.type ?? 'rect');
    const [ix, iy] = this.view.toImage(sx, sy);
    if (g.kind === 'select-create') {
      if (!g.started && Math.hypot(sx - g.sx, sy - g.sy) < MIN_SELECTION_CSS) return;
      g.started = true;
      const [cx, cy] = this.clampToImage(ix, iy);
      this.setPending(type, { x0: g.ix, y0: g.iy, x1: cx, y1: cy });
    } else if (g.kind === 'select-move') {
      const b = g.box;
      const w = b.x1 - b.x0;
      const h = b.y1 - b.y0;
      // 中心が画像の外に出ないように
      let dx = ix - g.ix;
      let dy = iy - g.iy;
      const cx = Math.min(this.width, Math.max(0, b.x0 + w / 2 + dx));
      const cy = Math.min(this.height, Math.max(0, b.y0 + h / 2 + dy));
      dx = cx - (b.x0 + w / 2);
      dy = cy - (b.y0 + h / 2);
      this.setPending(this.pending!.type, { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });
    } else if (g.kind === 'select-resize') {
      const b = { ...g.box };
      const [cx, cy] = this.clampToImage(ix, iy);
      const hnd = g.handle;
      if (hnd === 0 || hnd === 6 || hnd === 7) b.x0 = cx;
      if (hnd === 2 || hnd === 3 || hnd === 4) b.x1 = cx;
      if (hnd === 0 || hnd === 1 || hnd === 2) b.y0 = cy;
      if (hnd === 4 || hnd === 5 || hnd === 6) b.y1 = cy;
      // 小さくなりすぎないように（画面上で最低 MIN_SELECTION_CSS）
      const minW = MIN_SELECTION_CSS / this.view.scale;
      const n = normBox(b);
      if (n.x1 - n.x0 < minW || n.y1 - n.y0 < minW) return;
      this.setPending(this.pending!.type, n);
    }
  }

  private restoreSelection(before: Pending | null) {
    if (!before) {
      if (this.pending) this.cancelPending();
      return;
    }
    this.setPending(before.type, before.box);
  }

  // ======== 書き出し ========

  async export(opts: ExportOptions, onProgress?: (p: number) => void): Promise<ExportResult> {
    return exportImage(this.renderer, [...this.history.ops], opts, onProgress);
  }

  // ======== テスト用 ========

  /** 画像座標 → 編集エリア内の CSS px */
  imageToClient(ix: number, iy: number): [number, number] {
    const r = this.container!.getBoundingClientRect();
    const [sx, sy] = this.view.toScreen(ix, iy);
    return [sx + r.left, sy + r.top];
  }

  get idle(): boolean {
    return !this.urgent.size && !this.background.size && !this.raf;
  }

  get detailInfo() {
    return this.detail ? { li: this.detail.li, rect: { ...this.detail.rect } } : null;
  }

  /** プレビューキャンバスの画素（テスト用） */
  previewPixels(): { w: number; h: number; data: Uint8ClampedArray } {
    const P = this.P;
    return { w: P.w, h: P.h, data: this.previewCtx.getImageData(0, 0, P.w, P.h).data };
  }
}
