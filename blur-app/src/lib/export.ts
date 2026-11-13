/**
 * 書き出し：元解像度で帯（ストリップ）ごとに合成し、画像ファイルに符号化する。
 * - 面積が iOS Safari の canvas 上限以下なら canvas.toBlob（ブラウザー標準のエンコーダー、高速）
 * - 上限を超える（例：48MP / 24MP の写真）か canvas が使えない場合は、自前のエンコーダーを Worker で使う
 * 出力ファイルには加工後の画素だけが入り、編集履歴・元画像・EXIF（位置情報など）は含まれない。
 */
import { JpegEncoder } from '../codec/jpeg';
import { PngEncoder } from '../codec/png';
import type { EncodeRequest, EncodeResponse, ExportFormat } from '../codec/protocol';
import type { Renderer } from '../engine/renderer';
import type { Op } from '../engine/types';

export type { ExportFormat };

/** iOS Safari の canvas の最大面積（4096×4096 相当） */
export const CANVAS_MAX_AREA = 16_777_216;
const CANVAS_MAX_SIDE = 16_384;

export interface ExportOptions {
  format: ExportFormat;
  /** JPEG 品質 0〜1 */
  quality: number;
  /** 元画像に透明部分があるか（PNG のアルファ出力に使う） */
  hasAlpha: boolean;
  /** テスト用：canvas を使わず自前エンコーダーを使う */
  forceEncoder?: boolean;
}

export interface ExportResult {
  blob: Blob;
  width: number;
  height: number;
  method: 'canvas' | 'encoder';
}

interface Sink {
  rows(data: Uint8ClampedArray, rows: number): Promise<void>;
  finish(): Promise<Blob>;
  abort(): void;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function stripRows(width: number): number {
  return Math.max(16, Math.min(1024, Math.floor(4_000_000 / width / 16) * 16));
}

/** JPEG は透明を持てないので白背景に合成する（canvas 経由・自前エンコーダーで同じ結果にする） */
function flattenOnWhite(data: Uint8ClampedArray) {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 255) continue;
    const k = a / 255;
    data[i] = data[i] * k + 255 * (1 - k);
    data[i + 1] = data[i + 1] * k + 255 * (1 - k);
    data[i + 2] = data[i + 2] * k + 255 * (1 - k);
    data[i + 3] = 255;
  }
}

class CanvasSink implements Sink {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private y = 0;
  constructor(
    private width: number,
    height: number,
    private opts: ExportOptions,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    this.ctx = ctx;
  }
  async rows(data: Uint8ClampedArray, rows: number) {
    this.ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, this.width, rows), 0, this.y);
    this.y += rows;
  }
  finish(): Promise<Blob> {
    const type = this.opts.format === 'png' ? 'image/png' : 'image/jpeg';
    return new Promise<Blob>((resolve, reject) => {
      this.canvas.toBlob(
        (b) => {
          this.release();
          if (b && b.size > 0) resolve(b);
          else reject(new Error('canvas.toBlob failed'));
        },
        type,
        this.opts.quality,
      );
    });
  }
  abort() {
    this.release();
  }
  private release() {
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

class WorkerSink implements Sink {
  private worker: Worker;
  private pending = 0;
  private waiters: Array<() => void> = [];
  private done: Promise<Blob>;
  private failed: Error | null = null;
  constructor(width: number, height: number, opts: ExportOptions) {
    this.worker = new Worker(new URL('../codec/encodeWorker.ts', import.meta.url), { type: 'module' });
    this.done = new Promise<Blob>((resolve, reject) => {
      this.worker.onmessage = (e: MessageEvent<EncodeResponse>) => {
        const m = e.data;
        if (m.type === 'ack') {
          this.pending--;
          this.waiters.shift()?.();
        } else if (m.type === 'done') {
          resolve(m.blob);
          this.worker.terminate();
        } else {
          this.failed = new Error(m.message);
          reject(this.failed);
          this.waiters.forEach((w) => w());
          this.worker.terminate();
        }
      };
      this.worker.onerror = (e) => {
        this.failed = new Error(e.message || 'worker error');
        reject(this.failed);
        this.waiters.forEach((w) => w());
      };
    });
    this.done.catch(() => {});
    this.post({ type: 'start', format: opts.format, width, height, quality: Math.round(opts.quality * 100), hasAlpha: opts.hasAlpha });
  }
  private post(m: EncodeRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(m, transfer);
  }
  async rows(data: Uint8ClampedArray, rows: number) {
    if (this.failed) throw this.failed;
    // 未処理の帯は 2 本まで（メモリを使いすぎない）
    while (this.pending >= 2 && !this.failed) await new Promise<void>((r) => this.waiters.push(r));
    if (this.failed) throw this.failed;
    this.pending++;
    const buf = data.buffer as ArrayBuffer;
    this.post({ type: 'rows', data: buf, rows }, [buf]);
  }
  finish() {
    this.post({ type: 'finish' });
    return this.done;
  }
  abort() {
    this.worker.terminate();
  }
}

/** Worker が使えない環境用（メインスレッドで符号化） */
class InlineSink implements Sink {
  private jpeg: JpegEncoder | null;
  private png: PngEncoder | null;
  constructor(width: number, height: number, private opts: ExportOptions) {
    this.jpeg = opts.format === 'jpeg' ? new JpegEncoder(width, height, Math.round(opts.quality * 100)) : null;
    this.png = opts.format === 'png' ? new PngEncoder(width, height, opts.hasAlpha) : null;
  }
  async rows(data: Uint8ClampedArray, rows: number) {
    if (this.jpeg) this.jpeg.addRows(data, rows);
    else await this.png!.addRows(data, rows);
  }
  async finish() {
    const parts = this.jpeg ? this.jpeg.finish() : await this.png!.finish();
    return new Blob(parts as BlobPart[], { type: this.opts.format === 'png' ? 'image/png' : 'image/jpeg' });
  }
  abort() {}
}

function makeEncoderSink(w: number, h: number, opts: ExportOptions): Sink {
  try {
    return new WorkerSink(w, h, opts);
  } catch {
    return new InlineSink(w, h, opts);
  }
}

async function run(renderer: Renderer, ops: Op[], opts: ExportOptions, sink: Sink, onProgress?: (p: number) => void): Promise<Blob> {
  const W = renderer.width;
  const H = renderer.height;
  const step = stripRows(W);
  try {
    for (let y = 0; y < H; y += step) {
      const rows = Math.min(step, H - y);
      const data = renderer.render(ops, 0, { x: 0, y, w: W, h: rows });
      if (opts.format === 'jpeg' && opts.hasAlpha) flattenOnWhite(data);
      await sink.rows(data, rows);
      onProgress?.(Math.min(0.95, ((y + rows) / H) * 0.95));
      await tick();
    }
    const blob = await sink.finish();
    onProgress?.(1);
    return blob;
  } catch (e) {
    sink.abort();
    throw e;
  }
}

export async function exportImage(
  renderer: Renderer,
  ops: Op[],
  opts: ExportOptions,
  onProgress?: (p: number) => void,
): Promise<ExportResult> {
  const W = renderer.width;
  const H = renderer.height;
  const canUseCanvas = !opts.forceEncoder && W * H <= CANVAS_MAX_AREA && W <= CANVAS_MAX_SIDE && H <= CANVAS_MAX_SIDE;
  if (canUseCanvas) {
    try {
      const blob = await run(renderer, ops, opts, new CanvasSink(W, H, opts), onProgress);
      return { blob, width: W, height: H, method: 'canvas' };
    } catch (e) {
      // canvas の確保や toBlob に失敗（メモリ不足など）→ 自前エンコーダーでやり直す
      console.warn('canvas export failed, falling back to encoder', e);
    }
  }
  let blob: Blob;
  try {
    blob = await run(renderer, ops, opts, makeEncoderSink(W, H, opts), onProgress);
  } catch (e) {
    if (e instanceof RangeError) throw e;
    // Worker が動かない環境ではメインスレッドで符号化する
    console.warn('worker encoder failed, retrying inline', e);
    blob = await run(renderer, ops, opts, new InlineSink(W, H, opts), onProgress);
  }
  return { blob, width: W, height: H, method: 'encoder' };
}

/** 保存ファイル名：元の名前 + _edited */
export function editedFileName(original: string, format: ExportFormat): string {
  const base = original.replace(/\.[^./\\]+$/, '') || 'photo';
  return `${base}_edited.${format === 'png' ? 'png' : 'jpg'}`;
}
