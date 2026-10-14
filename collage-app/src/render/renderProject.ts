import { coverCrop, degToRad } from '../model/geometry';
import type { Background, ImageLayer, ProjectDoc } from '../model/types';
import { downscaleRegion, STEP_DOWNSCALE_THRESHOLD } from './resample';

/**
 * Canvas 2D による描画エンジン（書き出し・サムネイル生成用）。
 * Konva に依存せず、データモデルだけから画像を生成する。
 * 編集画面（Konva）と同じ規則で描画するため、書き出し結果は編集画面と一致する。
 */

export interface SourceImage {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export type ImageResolver = (assetId: string) => Promise<{ source: SourceImage; release?: () => void } | null>;

export interface RenderOptions {
  /** 出力倍率（1 = キャンバス座標どおりのピクセル数） */
  scale?: number;
  /** 透明背景を塗りつぶす色（JPEG 出力時など） */
  opaqueFallback?: string;
  onProgress?: (done: number, total: number) => void;
  /** 中止用。画像 1 枚ごとに確認し、中止されていれば AbortError を投げる */
  signal?: AbortSignal;
}

export function isAbortError(e: unknown): boolean {
  return (e as { name?: string })?.name === 'AbortError';
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('書き出しを中止しました', 'AbortError');
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (rr <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** グラデーションの始点・終点（角度は CSS と同じ: 0° = 下から上、90° = 左から右） */
export function gradientPoints(width: number, height: number, angleDeg: number) {
  const a = degToRad(angleDeg);
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  const cx = width / 2;
  const cy = height / 2;
  return { x0: cx - dx * half, y0: cy - dy * half, x1: cx + dx * half, y1: cy + dy * half };
}

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  width: number,
  height: number,
  bgImage: SourceImage | null,
  pixelScale = 1,
) {
  if (bg.type === 'color') {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, width, height);
  } else if (bg.type === 'gradient') {
    const p = gradientPoints(width, height, bg.angle);
    const g = ctx.createLinearGradient(p.x0, p.y0, p.x1, p.y1);
    g.addColorStop(0, bg.from);
    g.addColorStop(1, bg.to);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  } else if (bg.type === 'image') {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, width, height);
    if (bgImage) {
      const { crop } = coverCrop(bgImage, { width, height }, bg.fit);
      drawCropped(
        ctx,
        bgImage,
        crop.x * bgImage.width,
        crop.y * bgImage.height,
        crop.width * bgImage.width,
        crop.height * bgImage.height,
        0,
        0,
        width,
        height,
        pixelScale,
      );
    }
  }
}

/**
 * 元画像の切り抜き範囲を、描画先の w × h（キャンバス座標）に描く。
 * 大きく縮小する場合は、先に段階縮小してから描画して画質を保つ（回転時のジャギー対策）。
 * pixelScale は出力倍率（キャンバス座標 1 あたりの実ピクセル数）。
 */
function drawCropped(
  ctx: CanvasRenderingContext2D,
  src: SourceImage,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  w: number,
  h: number,
  pixelScale: number,
) {
  const tw = w * pixelScale;
  const th = h * pixelScale;
  if (sw / Math.max(tw, 1) > STEP_DOWNSCALE_THRESHOLD && sh / Math.max(th, 1) > STEP_DOWNSCALE_THRESHOLD) {
    const small = downscaleRegion(src.image, sx, sy, sw, sh, tw, th);
    try {
      ctx.drawImage(small, 0, 0, small.width, small.height, dx, dy, w, h);
    } finally {
      small.width = 0;
      small.height = 0;
    }
    return;
  }
  ctx.drawImage(src.image, sx, sy, sw, sh, dx, dy, w, h);
}

export function drawLayer(ctx: CanvasRenderingContext2D, layer: ImageLayer, src: SourceImage, pixelScale = 1) {
  if (!layer.visible || layer.opacity <= 0) return;
  const { width: w, height: h, crop } = layer;
  ctx.save();
  ctx.translate(layer.x, layer.y);
  ctx.rotate(degToRad(layer.rotation));
  ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
  ctx.globalAlpha = layer.opacity;
  if (layer.borderRadius > 0) {
    roundRectPath(ctx, -w / 2, -h / 2, w, h, layer.borderRadius);
    ctx.clip();
  }
  drawCropped(
    ctx,
    src,
    crop.x * src.width,
    crop.y * src.height,
    crop.width * src.width,
    crop.height * src.height,
    -w / 2,
    -h / 2,
    w,
    h,
    pixelScale,
  );
  ctx.restore();
}

/**
 * プロジェクトを canvas に描画する。
 * 画像は 1 枚ずつ読み込んで描画後すぐに解放し、メモリ使用量を抑える。
 */
export async function renderProject(
  canvas: HTMLCanvasElement,
  doc: ProjectDoc,
  resolve: ImageResolver,
  opts: RenderOptions = {},
): Promise<void> {
  // 高解像度の canvas を確保する前に中止を確認する
  throwIfAborted(opts.signal);
  const scale = opts.scale ?? 1;
  const width = Math.round(doc.canvasWidth * scale);
  const height = Math.round(doc.canvasHeight * scale);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas の初期化に失敗しました');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, width, height);
  if (opts.opaqueFallback) {
    ctx.fillStyle = opts.opaqueFallback;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.scale(scale, scale);

  const layers = [...doc.imageLayers].filter((l) => l.visible).sort((a, b) => a.zIndex - b.zIndex);
  const total = layers.length + 1;

  let bgImage: SourceImage | null = null;
  let bgRelease: (() => void) | undefined;
  if (doc.background.type === 'image') {
    const r = await resolve(doc.background.assetId);
    bgImage = r?.source ?? null;
    bgRelease = r?.release;
  }
  drawBackground(ctx, doc.background, doc.canvasWidth, doc.canvasHeight, bgImage, scale);
  bgRelease?.();
  opts.onProgress?.(1, total);

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    throwIfAborted(opts.signal);
    const r = await resolve(layer.assetId);
    if (r) {
      try {
        drawLayer(ctx, layer, r.source, scale);
      } finally {
        r.release?.();
      }
    }
    opts.onProgress?.(i + 2, total);
  }
}
